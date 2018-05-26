/* eslint-env mocha */
'use strict'

const chai = require('chai')
const dirtyChai = require('dirty-chai')
const NatUpnp = require('../src/mappers/upnp')

chai.use(dirtyChai)
const expect = chai.expect

describe('Nat UpNP tests', () => {
  let natUpnp
  before(() => {
    natUpnp = new NatUpnp()
  })

  it('should add mapping', (done) => {
    natUpnp.addMapping(50567, 50567, 0, {}, [], (error, mapping) => {
      expect(error).to.not.exist()
      expect(mapping.internalPort).to.be.eql(50567)
      done()
    })
  }).timeout(5 * 10000)

  it('should delete a mapping', (done) => {
    const mapping = {
      errInfo: null,
      externalIp: '186.4.10.102',
      externalPort: 50567,
      internalIp: '10.0.0.107',
      internalPort: 50567,
      nonce: null,
      protocol: 'natPmp',
      routerIp: '10.0.0.1',
      ttl: 86400
    }
    natUpnp.mappings[50567] = mapping
    natUpnp.deleteMapping(50567, {}, (error) => {
      expect(error).to.not.exist()
      done()
    })
  }).timeout(5 * 10000)
})
