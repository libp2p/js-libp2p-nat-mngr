'use strict'
const debug = require('debug')

class BaseMapper {
  constructor (name, port) {
    this.name = name
    this.port = port
    this.mappings = {}

    this.log = debug(`nat-puncher:${name}`)
    this.log.err = debug(`nat-puncher:${name}:error`)
  }

  newMapping (port) {
    return {
      routerIp: null,
      internalIp: null,
      internalPort: port,
      externalIp: null, // Only provided by PCP, undefined for other protocols
      externalPort: null, // The actual external port of the mapping, -1 on failure
      ttl: null, // The actual (response) lifetime of the mapping
      protocol: this.name, // The protocol used to make the mapping ('natPmp', 'pcp', 'upnp')
      nonce: null, // Only for PCP; the nonce field for deletion
      errInfo: null // Error message if failure; currently used only for UPnP
    }
  }

  addMapping (intPort, extPort, ttl, callback) {
    // If lifetime is zero, we want to refresh every 24 hours
    ttl = !ttl ? 24 * 60 * 60 : ttl

    this.createMapping(intPort,
      extPort,
      ttl,
      (err, mapping) => {
        if (err) {
          this.log.err(err)
          return callback(err)
        }
        this.mappings[`${mapping.externalIp}:${mapping.externalPort}`] = mapping
        callback(null, mapping)
      })
  }

  createMapping (intPort, extPort, lifetime, cb) {
    cb(new Error('Not implemented!'))
  }

  deleteMapping (mapping, callback) {
    this._internalDeleteMapping(mapping.internalPort,
      mapping.externalPort,
      (err) => {
        if (err) {
          return callback(err)
        }

        // delete the mappings
        delete this.mappings[`${mapping.externalIp}:${mapping.externalPort}`]
        callback()
      })
  }

  _internalDeleteMapping (intPort, extPort, callback) {
    callback(new Error('Not implemented!'))
  }
}

module.exports = BaseMapper
