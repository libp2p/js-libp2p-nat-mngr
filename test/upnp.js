/* eslint-env mocha */
'use strict'

const chai = require('chai')
const dirtyChai = require('dirty-chai')
const NatUpnp = require('../src/mappers/upnp')

chai.use(dirtyChai)
const expect = chai.expect

// TODO: provisional tests
// need to figure out a more
// robust way of testing this
describe('Nat UpNP tests', () => {
  let natUpnp
  let natmapping
  before(() => {
    natUpnp = new NatUpnp()
  })

  it('should add mapping', (done) => {
    let port = ~~(Math.random() * 65536)
    natUpnp.addMapping(port, port, 0, {}, [], (error, mapping) => {
      expect(error).to.not.exist()
      expect(mapping.internalPort).to.be.eql(port)
      natmapping = mapping
      done()
    })
  }).timeout(5 * 10000)

  it('should delete a mapping', (done) => {
    natUpnp.mappings[natmapping.externalPort] = natmapping
    natUpnp.deleteMapping(natmapping.externalPort, {}, (error) => {
      expect(error).to.not.exist()
      done()
    })
  }).timeout(5 * 10000)
})
