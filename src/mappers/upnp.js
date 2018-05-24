'use strict'

const utils = require('./utils')
const dgram = require('dgram')
const URL = require('url')
const request = require('superagent')

const UPNP_PROBE_PORT = 55557

/**
 * Probe if UPnP AddPortMapping is supported by the router
 *
 * @param {object} activeMappings Table of active Mappings
 * @param {Array<string>} routerIpCache Router IPs that have previously worked
 * @return {Promise<boolean>} A promise for a boolean
 */
const probeSupport = function (activeMappings) {
  return addMapping(utils.UPNP_PROBE_PORT, utils.UPNP_PROBE_PORT, 120,
    activeMappings).then(function (mapping) {
    if (mapping.errInfo &&
      mapping.errInfo.indexOf('ConflictInMappingEntry') !== -1) {
      // This error response suggests that UPnP is enabled
      return true
    }
    return mapping.externalPort !== -1
  })
}

/**
 * Makes a port mapping in the NAT with UPnP AddPortMapping
 *
 * @param {number} intPort The internal port on the computer to map to
 * @param {number} extPort The external port on the router to map to
 * @param {number} lifetime Seconds that the mapping will last
 *                          0 is infinity; a static AddPortMapping request
 * @param {object} activeMappings Table of active Mappings
 * @param {string=} controlUrl Optional: a control URL for the router
 * @return {Promise<Mapping>} A promise for the port mapping object
 *                               mapping.externalPort is -1 on failure
 */
const addMapping = function (intPort,
  extPort,
  lifetime,
  activeMappings,
  controlUrl) {
  let internalIp // Internal IP of the user's computer
  const mapping = new utils.Mapping()
  mapping.internalPort = intPort
  mapping.protocol = 'upnp'
  // Does the UPnP flow to send a AddPortMapping request
  // (1. SSDP, 2. GET location URL, 3. POST to control URL)
  // If we pass in a control URL, we don't need to do the SSDP step
  function _handleUpnpFlow () {
    if (controlUrl !== undefined) {
      return _handleControlUrl(controlUrl)
    }
    return _getUpnpControlUrl().then(function (url) {
      controlUrl = url
      return _handleControlUrl(url)
    }).catch(_handleError)
  }
  // Process and send an AddPortMapping request to the control URL
  function _handleControlUrl (controlUrl) {
    return new Promise(function (resolve, reject) {
      // Get the correct internal IP (if there are multiple network interfaces)
      // for this UPnP router, by doing a longest prefix match, and use it to
      // send an AddPortMapping request
      const routerIp = (new URL(controlUrl)).hostname
      utils.getPrivateIps().then(function (privateIps) {
        internalIp = utils.longestPrefixMatch(privateIps, routerIp)
        sendAddPortMapping(controlUrl, internalIp, intPort, extPort, lifetime)
          .then(function (response) {
            resolve(response)
          })
          .catch(function (err) {
            resolve(err)
          })
      })
    }).then(function (response) {
      // Success response to AddPortMapping (the internal IP of the mapping)
      // The requested external port will always be mapped on success, and the
      // lifetime will always be the requested lifetime; errors otherwise
      mapping.externalPort = extPort
      mapping.internalIp = internalIp
      mapping.lifetime = lifetime
      return mapping
    }).catch(_handleError)
  }
  // Save the Mapping object in activeMappings on success, and set a timeout
  // to delete the mapping on expiration
  // Note: We never refresh for UPnP since 0 is infinity per the protocol and
  // there is no maximum lifetime
  function _saveMapping (mapping) {
    // Delete the entry from activeMapping at expiration
    if (mapping.externalPort !== -1 && lifetime !== 0) {
      setTimeout(function () {
        delete activeMappings[mapping.externalPort]
      }, mapping.lifetime * 1000)
    }
    // If mapping succeeded, attach a deleter function and add to activeMappings
    if (mapping.externalPort !== -1) {
      mapping.deleter = deleteMapping.bind({}, mapping.externalPort,
        activeMappings, controlUrl)
      activeMappings[mapping.externalPort] = mapping
    }
    return mapping
  }
  // If we catch an error, add it to the mapping object and console.log()
  function _handleError (err) {
    // console.log('UPnP failed at: ' + err.message)
    mapping.errInfo = err.message
    return mapping
  }
  // After receiving an AddPortMapping response, set a timeout to delete the
  // mapping, and add it to activeMappings
  return _handleUpnpFlow().then(_saveMapping)
}

/**
 * Deletes a port mapping in the NAT with UPnP DeletePortMapping
 *
 * @param {number} extPort The external port of the mapping to delete
 * @param {object} activeMappings Table of active Mappings
 * @param {string} controlUrl A control URL for the router (not optional!)
 * @return {Promise<boolean>} True on success, false on failure
 */
const deleteMapping = function (extPort, activeMappings, controlUrl) {
  // Do the UPnP flow to delete a mapping, and if successful, remove it from
  // activeMappings and return true
  return sendDeletePortMapping(controlUrl, extPort).then(function () {
    delete activeMappings[extPort]
    return true
  }).catch(function (err) {
    return false
  })
}

/**
 * Return the UPnP control URL of a router on the network that supports UPnP IGD
 * This wraps sendSsdpRequest() and fetchControlUrl() together
 *
 * @return {Promise<string>} A promise for the URL, rejects if not supported
 */
const _getUpnpControlUrl = function () {
  // After collecting all the SSDP responses, try to get the
  // control URL field for each response, and return an array
  return sendSsdpRequest()
    .then(function (ssdpResponses) {
      return Promise.all(ssdpResponses.map(function (ssdpResponse) {
        return fetchControlUrl(ssdpResponse)
          .then(function (controlUrl) {
            return controlUrl
          })
          .catch(function (err) {
            return null
          })
      }))
    }).then(function (controlUrls) {
    // We return the first control URL we found
    // there should always be at least one if we reached this block
      for (let i = 0; i < controlUrls.length; i++) {
        if (controlUrls[i] !== null) {
          return controlUrls[i]
        }
      }
    }).catch(function (err) {
      return Promise.reject(err)
    })
}

/**
 * A public version of _getUpnpControlUrl that suppresses the Promise rejection,
 * and replaces it with undefined. This is useful outside this module in a
 * Promise.all(), while inside we want to propagate the errors upwards
 *
 * @return {Promise<string>} A promise for the URL, undefined if not supported
 */
const getUpnpControlUrl = function () {
  return _getUpnpControlUrl().catch(function (err) {})
}

/**
 * Send a UPnP SSDP request on the network and collects responses
 *
 * @return {Promise<Array>} A promise that fulfills with an array of SSDP response,
 *                          or rejects on timeout
 */
const sendSsdpRequest = function () {
  const ssdpResponses = []
  const socket = dgram.createSocket('udp4')
  // Fulfill when we get any reply (failure is on timeout or invalid parsing)
  socket.on('onData', function (ssdpResponse) {
    ssdpResponses.push(ssdpResponse.data)
  })
  // Bind a socket and send the SSDP request
  socket.bind('0.0.0.0', 0, err => {
    if (err) return
    // Construct and send a UPnP SSDP message
    const ssdpStr = 'M-SEARCH * HTTP/1.1\r\n' +
      'HOST: 239.255.255.250:1900\r\n' +
      'MAN: "ssdp:discover"\r\n' +
      'MX: 3\r\n' +
      'ST: urn:schemas-upnp-org:device:InternetGatewayDevice:1\r\n\r\n'
    const ssdpBuffer = utils.stringToArrayBuffer(ssdpStr)
    socket.send(ssdpBuffer, 1900, '239.255.255.250')
  })
  // Collect SSDP responses for 3 seconds before timing out
  return new Promise(function (resolve, reject) {
    setTimeout(function () {
      if (ssdpResponses.length > 0) {
        resolve(ssdpResponses)
      } else {
        resolve(new Error('SSDP timeout'))
      }
    }, 3000)
  })
}

/**
 * Fetch the control URL from the information provided in the SSDP response
 *
 * @param {ArrayBuffer} ssdpResponse The ArrayBuffer response to the SSDP message
 * @return {string} The string of the control URL for the router
 */
const fetchControlUrl = function (ssdpResponse) {
  // Promise to parse the location URL from the SSDP response, then send a POST
  // xhr to the location URL to find the router's UPNP control URL
  const _fetchControlUrl = new Promise(function (resolve, reject) {
    const ssdpStr = utils.arrayBufferToString(ssdpResponse)
    const startIndex = ssdpStr.indexOf('LOCATION:') + 9
    const endIndex = ssdpStr.indexOf('\n', startIndex)
    const locationUrl = ssdpStr.substring(startIndex, endIndex).trim()
    // Reject if there is no LOCATION header
    if (startIndex === 8) {
      resolve(new Error('No LOCATION header for UPnP device'))
      return
    }

    // Get the XML device description at location URL
    request
      .get(locationUrl)
      .type('xml')
      .end((err, res) => {
        if (err) {
          return reject(err)
        }

        if (!res.body.controlUrl) {
          resolve(new Error('Could not parse control URL'))
          return
        }

        // Combine the controlUrl path with the locationUrl
        const lcUrl = new URL(locationUrl).host
        resolve(`http://${lcUrl}/${res.body.controlUrl}`)
      })
  })
  // Give _fetchControlUrl 1 second before timing out
  return Promise.race([
    utils.countdownReject(1000, 'Time out when retrieving description XML'),
    _fetchControlUrl
  ])
}

/**
 * Send an AddPortMapping request to the router's control URL
 *
 * @param {string} controlUrl The control URL of the router
 * @param {string} privateIp The private IP address of the user's computer
 * @param {number} intPort The internal port on the computer to map to
 * @param {number} extPort The external port on the router to map to
 * @param {number} lifetime Seconds that the mapping will last
 * @return {string} The response string to the AddPortMapping request
 */
const sendAddPortMapping = function (controlUrl, privateIp, intPort, extPort, lifetime) {
  // Promise to send an AddPortMapping request to the control URL of the router
  const _sendAddPortMapping = new Promise(function (resolve, reject) {
    // The AddPortMapping SOAP request string
    const apm = '<?xml version="1.0"?>' +
      '<s:Envelope s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/" xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">' +
      '<s:Body>' +
      '<u:AddPortMapping xmlns:u="urn:schemas-upnp-org:service:WANIPConnection:1">' +
      '<NewExternalPort>' + extPort + '</NewExternalPort>' +
      '<NewProtocol>UDP</NewProtocol>' +
      '<NewInternalPort>' + intPort + '</NewInternalPort>' +
      '<NewInternalClient>' + privateIp + '</NewInternalClient>' +
      '<NewEnabled>1</NewEnabled>' +
      '<NewPortMappingDescription>uProxy UPnP</NewPortMappingDescription>' +
      '<NewLeaseDuration>' + lifetime + '</NewLeaseDuration>' +
      '</u:AddPortMapping>' +
      '</s:Body>' +
      '</s:Envelope>'
    // Create an XMLHttpRequest that encapsulates the SOAP string
    request.post(controlUrl)
      .type('xml')
      .set('Content-Type', 'text/xml')
      .set('SOAPAction', '"urn:schemas-upnp-org:service:WANIPConnection:1#AddPortMapping"')
      .send(apm, (err, res) => {
        if (err) { return reject(err) }
        resolve(res.body)
      })

    // Give _sendAddPortMapping 1 second to run before timing out
    return Promise.race([
      utils.countdownReject(1000, 'AddPortMapping time out'),
      _sendAddPortMapping
    ])
  })
}

/**
 * Send a DeletePortMapping request to the router's control URL
 *
 * @param {string} controlUrl The control URL of the router
 * @param {number} extPort The external port of the mapping to delete
 * @return {string} The response string to the AddPortMapping request
 */
const sendDeletePortMapping = function (controlUrl, extPort) {
  // Promise to send an AddPortMapping request to the control URL of the router
  const _sendDeletePortMapping = new Promise(function (resolve, reject) {
    // The DeletePortMapping SOAP request string
    const apm = '<?xml version="1.0"?>' +
      '<s:Envelope s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/" xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">' +
      '<s:Body>' +
      '<u:DeletePortMapping xmlns:u="urn:schemas-upnp-org:service:WANIPConnection:1">' +
      '<NewRemoteHost></NewRemoteHost>' +
      '<NewExternalPort>' + extPort + '</NewExternalPort>' +
      '<NewProtocol>UDP</NewProtocol>' +
      '</u:DeletePortMapping>' +
      '</s:Body>' +
      '</s:Envelope>'
    // Create an XMLHttpRequest that encapsulates the SOAP string
    request.post(controlUrl)
      .type('xml')
      .set('Content-Type', 'text/xml')
      .set('SOAPAction', '"urn:schemas-upnp-org:service:WANIPConnection:1#DeletePortMapping"')
      .send(apm, (err, res) => {
        if (err) {
          return reject(err)
        }
        resolve(res.body)
      })
  })

  // Give _sendDeletePortMapping 1 second to run before timing out
  return Promise.race([
    utils.countdownReject(1000, 'DeletePortMapping time out'),
    _sendDeletePortMapping
  ])
}
module.exports = {
  probeSupport: probeSupport,
  addMapping: addMapping,
  deleteMapping: deleteMapping,
  getUpnpControlUrl: getUpnpControlUrl
}
