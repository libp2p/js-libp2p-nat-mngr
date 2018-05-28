'use strict'

const natPmp = require('nat-pmp')
const waterfall = require('async/waterfall')
const network = require('network')

const Mapper = require('./mapper')

class NatPMP extends Mapper {
  constructor () {
    super('nat-pmp')
  }

  /**
   * Create port mapping
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

      const client = natPmp.connect(activeIf.gateway_ip)
      const mapping = this.newMapping(intPort)
      mapping.routerIp = activeIf.gateway_ip
      waterfall([
        (cb) => client.externalIp((err, info) => {
          if (err) {
            return callback(err)
          }
          mapping.externalIp = info.ip.join('.')
          cb(null, mapping)
        }),
        (mapping, cb) => {
          client.portMapping({
            private: intPort,
            public: extPort,
            ttl
          }, (err, info) => {
            if (err) {
              this.log.err(err)
              return cb(err)
            }

            mapping.externalPort = info.public
            mapping.internalPort = info.private
            mapping.internalIp = activeIf.ip_address
            mapping.ttl = info.ttl
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
    network.get_gateway_ip((err, routerIp) => {
      if (err) {
        return callback(err)
      }

      const client = natPmp.connect(routerIp)
      client.portUnmapping({
        private: intPort,
        public: extPort
      }, (err, info) => {
        client.close() // should be closed immediately
        if (err) {
          return callback(err)
        }
        return callback(null, err)
      })
    })
  }
}

module.exports = NatPMP
