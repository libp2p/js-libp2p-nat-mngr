'use strict'
const debug = require('debug')
const tryEach = require('async/tryEach')

const utils = require('../utils')

class Mapper {
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
      externalPort: -1, // The actual external port of the mapping, -1 on failure
      ttl: null, // The actual (response) lifetime of the mapping
      protocol: this.name, // The protocol used to make the mapping ('natPmp', 'pcp', 'upnp')
      nonce: null, // Only for PCP; the nonce field for deletion
      errInfo: null // Error message if failure; currently used only for UPnP
    }
  }

  addMapping (intPort, extPort, ttl, activeMappings, routerIpCache, callback) {
    // If lifetime is zero, we want to refresh every 24 hours
    ttl = !ttl ? 24 * 60 * 60 : ttl

    // Try matchedRouterIps first (routerIpCache + router IPs that match the
    // user's IPs), then otherRouterIps if it doesn't work. This avoids flooding
    // the local network with requests
    const matchedRouterIps = new Set([
      ...routerIpCache,
      ...utils.filterRouterIps(utils.getPrivateIps())
    ])

    tryEach([
      // try a routers that match our ip first
      (cb) => this._sendRequests(intPort,
        extPort,
        [...matchedRouterIps],
        routerIpCache,
        ttl,
        cb),
      // fallback to trying all known router addrs
      (cb) => this._sendRequests(intPort,
        extPort,
        utils.ROUTER_IPS.filter((ip) => !matchedRouterIps.has(ip)),
        routerIpCache,
        ttl,
        cb)
    ], (err, mapping) => {
      if (err) {
        return callback(err)
      }

      // If the actual ttl is less than the requested ttl,
      // setTimeout to refresh the mapping when it expires
      const realTtl = ttl - (mapping ? mapping.ttl : 0)
      if (mapping && realTtl > 0) {
        setTimeout(this.addMapping.bind(this,
          intPort,
          mapping.externalPort,
          realTtl,
          activeMappings),
        mapping.ttl * 1000)
      } else if (mapping && ttl <= 0) {
        // If the original ttl is 0, refresh every 24 hrs indefinitely
        setTimeout(this.addMapping.bind(this,
          intPort,
          mapping.externalPort,
          0,
          activeMappings),
        24 * 60 * 60 * 1000)
      }

      activeMappings[mapping.externalPort] = this
      this.mappings[extPort] = mapping
      callback(null, mapping)
    })
  }

  createMapping (routerIp, intPort, extPort, lifetime, cb) {
    cb(new Error('Not implemented!'))
  }

  _sendRequests (intPort, extPort, routerIps, routerIpCache, reqLifetime, callback) {
    tryEach(routerIps.map((ip) => {
      return (cb) => {
        this.createMapping(ip,
          intPort,
          extPort,
          reqLifetime,
          (err, mapping) => {
            if (err) {
              this.log.err(err)
              return cb(err)
            }
            routerIpCache.push(ip)
            cb(null, mapping)
          })
      }
    }), callback)
  }

  deleteMapping (port, activeMappings, callback) {
    const mapping = this.mappings[port]
    this._internalDeleteMapping(mapping.internalPort,
      mapping.routerIp,
      mapping.externalPort,
      (err) => {
        if (err) {
          return callback(err)
        }

        // delete the mappings
        delete this.mappings[port]
        delete activeMappings[port]
        callback()
      })
  }

  _internalDeleteMapping (intPort, routerIp, extPort, callback) {
    callback(new Error('Not implemented!'))
  }
}

module.exports = Mapper
