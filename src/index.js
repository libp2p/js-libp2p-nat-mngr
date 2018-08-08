'use strict'

const NatPmp = require('./mappers/pmp')
const UPnP = require('./mappers/upnp')
const EE = require('events')
const tryEach = require('async/tryEach')
const eachSeries = require('async/eachSeries')
const parallel = require('async/parallel')
const waterfall = require('async/waterfall')
const network = require('network')

const log = require('debug')('libp2p-nat-mngr')

class NatManager extends EE {
  constructor (mappers, options) {
    super()

    options = options || {
      autorenew: true,
      every: 60 * 10 * 1000
    }

    this.mappers = mappers || [
      new NatPmp(),
      new UPnP()
    ]

    this.activeMappings = {}

    if (options.autorenew) {
      setInterval(() => {
        this.renewMappings()
      }, options.every)
    }
  }

  renewMappings (callback) {
    callback = callback || (() => {})
    this.getPublicIp((err, ip) => {
      if (err) {
        return log(err)
      }

      eachSeries(Object.keys(this.activeMappings), (key, cb) => {
        const mapping = this.activeMappings[key].mappings[key]
        if (mapping.externalIp !== ip) {
          delete this.activeMappings[key]
          this.addMapping(mapping.internalPort,
            mapping.externalPort,
            mapping.ttl,
            (err) => {
              if (err) {
                return log(err)
              }
              return cb()
            })
        }
      }, callback)
    })
  }

  addMapping (intPort, extPort, ttl, callback) {
    tryEach(this.mappers.map((mapper) => {
      return (cb) => {
        return mapper.addMapping(intPort,
          extPort,
          ttl,
          (err, mapping) => {
            if (err) {
              return cb(err)
            }

            const mapKey = `${mapping.externalIp}:${mapping.externalPort}`
            this.activeMappings[mapKey] = mapper
            this.emit('mapping', mapping)
            cb(null, mapping)
          })
      }
    }), callback)
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
          mapper.deleteMapping(extPort, cb)
        }
      }
    ], callback)
  }

  getPublicIp (callback) {
    network.get_public_ip(callback)
  }

  getGwIp (callback) {
    network.get_gateway_ip(callback)
  }

  close (callback) {
    parallel(Object.keys(this.activeMappings).map((key) => {
      const [ip, port] = key.split(':')
      return (cb) => this.activeMappings[key].deleteMapping(port, ip, cb)
    }), callback)
  }
}

module.exports = NatManager
