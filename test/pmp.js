/* eslint-env mocha */
'use strict'

const chai = require('chai')
const dirtyChai = require('dirty-chai')
const NatPMP = require('../src/mappers/pmp')

chai.use(dirtyChai)
const expect = chai.expect

// TODO: provisional tests
// need to figure out a more
// robust way of testing this
describe('NAT-PMP tests', () => {
  let natPMP
  let natmapping
  before(() => {
    natPMP = new NatPMP()
  })

  it('should add mapping', (done) => {
    let port = ~~(Math.random() * 65536)
    natPMP.addMapping(port, port, 0, {}, [], (error, mapping) => {
      expect(error).to.not.exist()
      expect(mapping.internalPort).to.be.eql(port)
      natmapping = mapping
      done()
    })
  }).timeout(5 * 10000)

  it('should delete a mapping', (done) => {
    natPMP.mappings[natmapping.externalPort] = natmapping
    natPMP.deleteMapping(natmapping.externalPort, {}, (error) => {
      expect(error).to.not.exist()
      done()
    })
  }).timeout(5 * 10000)
})
