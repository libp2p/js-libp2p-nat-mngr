'use strict'

const natUpnp = require('nat-upnp')
const waterfall = require('async/waterfall')

const Mapper = require('./mapper')
const utils = require('../utils')

const NAT_PMP_PROBE_PORT = 55555

class NatPMP extends Mapper {
  constructor () {
    super('natPmp', NAT_PMP_PROBE_PORT)
  }

  /**
   * Create a port mapping
   *
   * @param {String} routerIp
   * @param {Number} intPort
   * @param {Number} extPort
   * @param {Number} ttl
   * @param {Function} callback
   */
  createMapping (routerIp = undefined, intPort, extPort, ttl, callback) {
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
          // get the internal ip of the interface
          // we're using to make the request
          const internalIp = utils.longestPrefixMatch(utils.getPrivateIps(), routerIp)
          mapping.internalIp = internalIp
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
  }

  _internalDeleteMapping (intPort, routerIp, extPort, callback) {
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
