'use strict'

const NatPmp = require('./mappers/pmp')
const UPnP = require('./mappers/upnp')
const EE = require('events')
const tryEach = require('async/tryEach')
const parallel = require('async/parallel')
const waterfall = require('async/waterfall')
const network = require('network')

class NatManager extends EE {
  constructor (mappers) {
    super()

    this.mappers = mappers || [
      new NatPmp(),
      new UPnP()
    ]

    this.activeMappings = {}
  }

  addMapping (intPort, extPort, lifetime, callback) {
    tryEach(this.mappers.map((mapper) => {
      return (cb) => {
        return mapper.addMapping(intPort,
          extPort,
          lifetime,
          (err, mapping) => {
            if (err) {
              return callback(err)
            }

            const mapKey = `${mapping.externalIp}:${mapping.externalPort}`
            this.activeMappings[mapKey] = mapper
            callback(null, mapping)
          })
      }
    }))
  }

  deleteMapping (extPort, extIp, callback) {
    if (typeof extIp === 'function') {
      callback = extIp
      extIp = undefined
    }

    waterfall([
      (cb) => extIp
        ? cb(null, extIp)
        : network.get_public_ip(cb),
      (ip, cb) => {
        const mapper = this.activeMappings[`${ip}:${extPort}`]
        if (mapper) {
          mapper.deleteMapping(extPort, callback)
        }
      }
    ], callback)
  }

  close (callback) {
    parallel(Object.keys(this.activeMappings).map((key) => {
      const [ip, port] = key.split(':')
      return (cb) => this.activeMappings[key].deleteMapping(port, ip, cb)
    }), callback)
  }
}

module.exports = NatManager
