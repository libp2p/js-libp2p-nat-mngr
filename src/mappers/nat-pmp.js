'use strict'

const natPmp = require('nat-pmp')
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
  createMapping (routerIp, intPort, extPort, ttl, callback) {
    const client = natPmp.connect(routerIp)
    waterfall([
      (cb) => client.externalIp((err, info) => {
        if (err) {
          return callback(err)
        }
        const mapping = this.newMapping(intPort)
        mapping.externalIp = info.ip.join('.')
        cb(null, mapping)
      }),
      (mapping, cb) => {
        client.portMapping({ private: intPort, public: extPort, ttl }, (err, info) => {
          if (err) {
            this.log.err(err)
            return cb(err)
          }

          mapping.externalPort = info.public
          mapping.internalPort = info.private
          mapping.ttl = info.ttl
          // get the internal ip of the interface
          // we're using to make the request
          const internalIp = utils.longestPrefixMatch(utils.getPrivateIps(), routerIp)
          mapping.internalIp = internalIp
          cb(null, mapping)
        })
      }
    ], (err, mapping) => {
      if (err) {
        return callback(err)
      }
      callback(null, mapping)
    })
  }

  deleteMapping (intPort, routerIp, extPort, callback) {
    const client = natPmp.connect(routerIp)
    client.portUnmapping({private: intPort, public: extPort}, (err, info) => {
      if (err) {
        return callback(err)
      }
      return callback(null, err)
    })
  }
}

module.exports = NatPMP
