/* eslint-env mocha */
'use strict'

const chai = require('chai')
const dirtyChai = require('dirty-chai')
const NatPMP = require('../src/mappers/pmp')

chai.use(dirtyChai)
const expect = chai.expect

describe('NAT-PMP tests', () => {
  let natPMP
  before(() => {
    natPMP = new NatPMP()
  })

  it('should add mapping', (done) => {
    natPMP.addMapping(50566, 50566, 0, {}, [], (error, mapping) => {
      expect(error).to.not.exist()
      expect(mapping.internalPort).to.be.eql(50566)
      done()
    })
  }).timeout(5 * 10000)

  it('should delete a mapping', (done) => {
    let mapping = {
      errInfo: null,
      externalIp: '186.4.10.102',
      externalPort: 50566,
      internalIp: '10.0.0.107',
      internalPort: 50566,
      protocol: 'natPmp',
      routerIp: '10.0.0.1',
      ttl: 86400
    }
    natPMP.mappings[50566] = mapping
    natPMP.deleteMapping(50566, {}, (error) => {
      expect(error).to.not.exist()
      done()
    })
  }).timeout(5 * 10000)
})
