'use strict'

const utils = require('./utils')
const NatPmp = require('./mappers/pmp')
// const PCP = require('./pcp')
const UPnP = require('./mappers/upnp')
const EE = require('events')
const tryEach = require('async/tryEach')

class NatManager extends EE {
  constructor () {
    super()

    this.mappers = [
      new NatPmp(),
      new UPnP()
    ]

    this.activeMappings = {}
    this.routerIpCache = new Set()
  }

  addMapping (intPort, extPort, lifetime) {
    tryEach(this.mappers.map((mapper) => {
      return (cb) => {
        return mapper.addMapping(intPort,
          extPort,
          lifetime,
          this.activeMappings,
          this.routerIpCache)
      }
    }))
  }

  deleteMapping (extPort, callback) {
    const mapper = this.activeMappings[extPort]
    if (mapper) {
      mapper.deleteMapping(extPort,
        this.routerIpCache,
        callback)
    }
  }

  getActiveMappings () {
    return this.activeMappings
  }

  getRouterIpCache () {
    return [...this.routerIpCache]
  }

  getPrivateIps () {
    return utils.getPrivateIps()
  }

  close () {
    return new Promise((resolve, reject) => {
      for (let [extPort, mapper] of this.activeMappings) {
        mapper.deleteMapping(extPort,
          this.activeMappings,
          this.routerIpCache)
      }
    })
  }
}

module.exports = NatManager
