'use strict'

const utils = require('./utils')
const ipaddr = require('ipaddr.js')
const dgram = require('dgram')

const PCP_PROBE_PORT = 55556

class PCP {
  /**
   * Probe if PCP is supported by the router
   *
   * @param {object} activeMappings Table of active Mappings
   * @param {Array<string>} routerIpCache Router IPs that have previously worked
   * @return {Promise<boolean>} A promise for a boolean
   */
  probeSupport (activeMappings, routerIpCache) {
    const mapping = this.addMapping(utils.PCP_PROBE_PORT,
      utils.PCP_PROBE_PORT,
      120,
      activeMappings,
      routerIpCache)
    return mapping.externalPort !== -1
  }

  /**
   * Makes a port mapping in the NAT with PCP,
   * and automatically refresh the mapping every two minutes
   *
   * @param {number} intPort The internal port on the computer to map to
   * @param {number} extPort The external port on the router to map to
   * @param {number} lifetime Seconds that the mapping will last
   *                          0 is infinity, i.e. a refresh every 24 hours
   * @param {object} activeMappings Table of active Mappings
   * @param {Array<string>} routerIpCache Router IPs that have previously worked
   * @return {Promise<Mapping>} A promise for the port mapping object
   *                            mapping.externalPort is -1 on failure
   */
  addMapping (intPort, extPort, lifetime, activeMappings, routerIpCache) {
    const mapping = new utils.Mapping()
    mapping.internalPort = intPort
    mapping.protocol = 'pcp'

    // If lifetime is zero, we want to refresh every 24 hours
    const reqLifetime = (lifetime === 0) ? 24 * 60 * 60 : lifetime

    // Send PCP requests to a list of router IPs and parse the first response
    function _sendPcpRequests (routerIps) {
      // Construct an array of ArrayBuffers, which are the responses of
      // sendPcpRequest() calls on all the router IPs. An error result
      // is caught and re-passed as null.
      const privateIps = Promise.all(routerIps.map((routerIp) => {
        // Choose a privateIp based on the currently selected routerIp,
        // using a longest prefix match, and send a PCP request with that IP
        const privateIp = utils.longestPrefixMatch(privateIps, routerIp)
        return this.sendPcpRequest(routerIp, privateIp, intPort, extPort,
          reqLifetime)
          .then(function (pcpResponse) {
            return {
              'pcpResponse': pcpResponse,
              'privateIp': privateIp
            }
          })
      }))

      utils.getPrivateIps().then(function (privateIps) {
        // Construct an array of ArrayBuffers, which are the responses of
        // sendPcpRequest() calls on all the router IPs. An error result
        // is caught and re-passed as null.
        return Promise.all(routerIps.map(function (routerIp) {
          // Choose a privateIp based on the currently selected routerIp,
          // using a longest prefix match, and send a PCP request with that IP
          const privateIp = utils.longestPrefixMatch(privateIps, routerIp)
          return this.sendPcpRequest(routerIp, privateIp, intPort, extPort,
            reqLifetime)
            .then(function (pcpResponse) {
              return {
                'pcpResponse': pcpResponse,
                'privateIp': privateIp
              }
            })
            .catch(function (err) {
              return null
            })
        }))
      }).then(function (responses) {
        // Check if any of the responses are successful (not null), and return
        // it as a Mapping object
        for (let i = 0; i < responses.length; i++) {
          if (responses[i] !== null) {
            const responseView = new DataView(responses[i].pcpResponse)
            const ipOctets = [responseView.getUint8(56), responseView.getUint8(57),
              responseView.getUint8(58), responseView.getUint8(59)
            ]
            const extIp = ipOctets.join('.')
            mapping.externalPort = responseView.getUint16(42)
            mapping.externalIp = extIp
            mapping.internalIp = responses[i].privateIp
            mapping.lifetime = responseView.getUint32(4)
            mapping.nonce = [responseView.getUint32(24),
              responseView.getUint32(28),
              responseView.getUint32(32)
            ]
            if (routerIpCache.indexOf(routerIps[i]) === -1) {
              routerIpCache.push(routerIps[i])
            }
          }
        }
        return mapping
      }).catch(function (err) {
        return mapping
      })
    }
    // Basically calls _sendPcpRequests on matchedRouterIps first, and if that
    // doesn't work, calls it on otherRouterIps
    function _sendPcpRequestsInWaves () {
      return utils.getPrivateIps().then(function (privateIps) {
        // Try matchedRouterIps first (routerIpCache + router IPs that match the
        // user's IPs), then otherRouterIps if it doesn't work. This avoids flooding
        // the local network with PCP requests
        const matchedRouterIps = utils.arrAdd(routerIpCache, utils.filterRouterIps(privateIps))
        const otherRouterIps = utils.arrDiff(utils.ROUTER_IPS, matchedRouterIps)
        return _sendPcpRequests(matchedRouterIps).then(function (mapping) {
          if (mapping.externalPort !== -1) {
            return mapping
          }
          return _sendPcpRequests(otherRouterIps)
        })
      })
    }
    // Compare our requested parameters for the mapping with the response,
    // setting a refresh if necessary, and a timeout for deletion, and saving the
    // mapping object to activeMappings if the mapping succeeded
    function _saveAndRefreshMapping (mapping) {
      // If the actual lifetime is less than the requested lifetime,
      // setTimeout to refresh the mapping when it expires
      const dLifetime = reqLifetime - mapping.lifetime
      if (mapping.externalPort !== -1 && dLifetime > 0) {
        mapping.timeoutId = setTimeout(this.addMapping.bind(this, intPort,
          mapping.externalPort, dLifetime, activeMappings), mapping.lifetime * 1000)
      } else if (mapping.externalPort !== -1 && lifetime === 0) {
        // If the original lifetime is 0, refresh every 24 hrs indefinitely
        mapping.timeoutId = setTimeout(this.addMapping.bind(this, intPort,
          mapping.externalPort, 0, activeMappings), 24 * 60 * 60 * 1000)
      } else if (mapping.externalPort !== -1) {
        // If we're not refreshing, delete the entry in activeMapping at expiration
        setTimeout(function () {
          delete activeMappings[mapping.externalPort]
        },
        mapping.lifetime * 1000)
      }
      // If mapping succeeded, attach a deleter function and add to activeMappings
      if (mapping.externalPort !== -1) {
        mapping.deleter = deleteMapping.bind({}, mapping.externalPort,
          activeMappings, routerIpCache)
        activeMappings[mapping.externalPort] = mapping
      }
      return mapping
    }
    // Try PCP requests to matchedRouterIps, then otherRouterIps.
    // After receiving a PCP response, set timeouts to delete/refresh the
    // mapping, add it to activeMappings, and return the mapping object
    return _sendPcpRequestsInWaves().then(_saveAndRefreshMapping)
  }

  /**
   * Deletes a port mapping in the NAT with PCP
   *
   * @param {number} extPort The external port of the mapping to delete
   * @param {object} activeMappings Table of active Mappings
   * @param {Array<string>} routerIpCache Router IPs that have previously worked
   * @return {Promise<boolean>} True on success, false on failure
   */
  deleteMapping (extPort, activeMappings, routerIpCache) {
    // Send PCP requests to a list of router IPs and parse the first response
    function _sendDeletionRequests (routerIps) {
      return utils.getPrivateIps().then(function (privateIps) {
        // Get the internal port and nonce for this mapping; this may error
        const intPort = activeMappings[extPort].internalPort
        const nonce = activeMappings[extPort].nonce
        // Construct an array of ArrayBuffers, which are the responses of
        // sendPmpRequest() calls on all the router IPs. An error result
        // is caught and re-passed as null.
        return Promise.all(routerIps.map(function (routerIp) {
          // Choose a privateIp based on the currently selected routerIp,
          // using a longest prefix match, and send a PCP request with that IP
          const privateIp = utils.longestPrefixMatch(privateIps, routerIp)
          return sendPcpRequest(routerIp, privateIp, intPort, 0, 0, nonce)
            .then(function (pcpResponse) {
              return pcpResponse
            })
            .catch(function (err) {
              return null
            })
        }))
      })
    }
    // Basically calls _sendDeletionRequests on matchedRouterIps first, and if that
    // doesn't work, calls it on otherRouterIps
    function _sendDeletionRequestsInWaves () {
      return utils.getPrivateIps().then(function (privateIps) {
        // Try matchedRouterIps first (routerIpCache + router IPs that match the
        // user's IPs), then otherRouterIps if it doesn't work. This avoids flooding
        // the local network with PCP requests
        const matchedRouterIps = utils.arrAdd(routerIpCache, utils.filterRouterIps(privateIps))
        const otherRouterIps = utils.arrDiff(utils.ROUTER_IPS, matchedRouterIps)
        return _sendDeletionRequests(matchedRouterIps).then(function (mapping) {
          if (mapping.externalPort !== -1) {
            return mapping
          }
          return _sendDeletionRequests(otherRouterIps)
        })
      })
    }
    // If any of the PCP responses were successful, delete the entry from
    // activeMappings and return true
    function _deleteFromActiveMappings (responses) {
      for (let i = 0; i < responses.length; i++) {
        if (responses[i] !== null) {
          // Success code 8 (NO_RESOURCES) may denote that the mapping does not
          // exist on the router, so we accept it as well
          const responseView = new DataView(responses[i])
          const successCode = responseView.getUint8(3)
          if (successCode === 0 || successCode === 8) {
            clearTimeout(activeMappings[extPort].timeoutId)
            delete activeMappings[extPort]
            return true
          }
        }
      }
      return false
    }
    // Send PCP deletion requests to matchedRouterIps, then otherRouterIps
    // if that succeeds, delete the corresponding Mapping from activeMappings
    return _sendDeletionRequestsInWaves()
      .then(_deleteFromActiveMappings)
      .catch(function (err) {
        return false
      })
  }

  /**
   * Send a PCP request to the router to map a port
   *
   * @param {string} routerIp The IP address that the router can be reached at
   * @param {string} privateIp The private IP address of the user's computer
   * @param {number} intPort The internal port on the computer to map to
   * @param {number} extPort The external port on the router to map to
   * @param {number} lifetime Seconds that the mapping will last
   * @param {array} nonce (Optional) A specified nonce for the PCP request
   * @return {Promise<ArrayBuffer>} A promise that fulfills with the PCP response
   *                                or rejects on timeout
   */
  sendPcpRequest (routerIp,
    privateIp,
    intPort,
    extPort,
    lifetime,
    nonce) {
    let socket
    // Pre-process nonce and privateIp arguments
    if (nonce === undefined) {
      nonce = [utils.randInt(0, 0xffffffff),
        utils.randInt(0, 0xffffffff),
        utils.randInt(0, 0xffffffff)
      ]
    }
    const ipOctets = ipaddr.IPv4.parse(privateIp).octets
    // Bind a socket and send the PCP request from that socket to routerIp
    const _sendPcpRequest = new Promise(function (resolve, reject) {
      socket = dgram.createSocket('udp4')
      // Fulfill when we get any reply (failure is on timeout in wrapper function)
      socket.on('onData', function (pcpResponse) {
        utils.closeSocket(socket)
        F(pcpResponse.data)
      })
      // Bind a UDP port and send a PCP request
      socket.bind('0.0.0.0', 0, err => {
        if (err) return
        // PCP packet structure: https://tools.ietf.org/html/rfc6887#section-11.1
        const pcpBuffer = utils.createArrayBuffer(60, [
          [32, 0, 0x2010000],
          [32, 4, lifetime],
          [16, 18, 0xffff],
          [8, 20, ipOctets[0]],
          [8, 21, ipOctets[1]],
          [8, 22, ipOctets[2]],
          [8, 23, ipOctets[3]],
          [32, 24, nonce[0]],
          [32, 28, nonce[1]],
          [32, 32, nonce[2]],
          [8, 36, 17],
          [16, 40, intPort],
          [16, 42, extPort],
          [16, 54, 0xffff]
        ])
        socket.send(pcpBuffer, 5351, routerIp)
      })
    })
    // Give _sendPcpRequest 2 seconds before timing out
    return Promise.race([
      utils.countdownReject(2000, 'No PCP response', function () {
        utils.closeSocket(socket)
      }),
      _sendPcpRequest
    ])
  }
}

module.exports = PCP
