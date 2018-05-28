'use strict'

const natUpnp = require('nat-upnp')
const waterfall = require('async/waterfall')
const network = require('network')

const Mapper = require('./mapper')

class NatPMP extends Mapper {
  constructor () {
    super('unpn')
  }

  /**
   * Create a port mapping
   *
   * @param {number} intPort
   * @param {number} extPort
   * @param {number} ttl
   * @param {Function} callback
   * @returns {undefined}
   */
  createMapping (intPort, extPort, ttl, callback) {
    network.get_active_interface((err, activeIf) => {
      if (err) {
        return callback(err)
      }

      const client = natUpnp.createClient()
      waterfall([
        (cb) => client.externalIp((err, ip) => {
          if (err) {
            return callback(err)
          }
          const mapping = this.newMapping(intPort)
          mapping.externalIp = ip
          cb(null, mapping)
        }),
        (mapping, cb) => {
          client.portMapping({
            private: intPort,
            public: extPort,
            ttl
          }, (err) => {
            if (err) {
              this.log.err(err)
              return cb(err)
            }

            mapping.externalPort = extPort
            mapping.internalPort = intPort
            mapping.ttl = ttl
            mapping.internalIp = activeIf.ip_address
            cb(null, mapping)
          })
        }
      ], (err, mapping) => {
        client.close() // should be closed immediately
        if (err) {
          return callback(err)
        }
        callback(null, mapping)
      })
    })
  }

  _internalDeleteMapping (intPort, extPort, callback) {
    const client = natUpnp.createClient()
    client.portUnmapping({
      public: extPort
    }, (err) => {
      client.close() // should be closed immediately
      if (err) {
        this.log.err(err) // don't crash on error
      }

      return callback(null)
    })
  }
}

module.exports = NatPMP
