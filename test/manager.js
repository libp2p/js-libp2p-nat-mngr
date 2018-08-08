/* eslint-env mocha */
'use strict'

const chai = require('chai')
chai.use(require('dirty-chai'))
chai.use(require('chai-checkmark'))

const Manager = require('../src')
const Mapper = require('../src/mappers')

const expect = chai.expect

describe('NAT manager', () => {
  it('should create mappings', (done) => {
    class Mapper1 extends Mapper {
      constructor () {
        super('mapper1')
      }

      _addPortMapping (intPort, extPort, ttl, cb) {
        cb(null, this.newMapping(intPort))
      }
    }

    const manager = new Manager([
      new Mapper1()
    ])

    manager.addMapping(55555, 55555, 0, (err, mapping) => {
      expect(err).to.not.exist()
      expect(mapping).to.exist()
      expect(mapping.internalPort).to.eql(55555)
      done()
    })
  })

  it('should try mappings in order', (done) => {
    let fail = true

    class Mapper1 extends Mapper {
      _addPortMapping (intPort, extPort, ttl, cb) {
        cb(fail ? new Error('fail') : null, this.newMapping(intPort))
        fail = false
      }
    }

    const manager = new Manager([
      new Mapper1('1'),
      new Mapper1('2')
    ])

    manager.addMapping(55555, 55555, 0, (err, mapping) => {
      expect(err).to.not.exist()
      expect(mapping).to.exist()
      expect(mapping.protocol).to.eql('2')
      expect(mapping.internalPort).to.eql(55555)
      done()
    })
  })

  it('should renew mapping', (done) => {
    class Mapper1 extends Mapper {
      _addPortMapping (intPort, extPort, ttl, cb) {
        const mapping = this.newMapping(intPort)
        mapping.externalIp = '127.0.0.1'
        mapping.externalPort = intPort
        cb(null, mapping)
      }
    }

    const manager = new Manager([
      new Mapper1('1')
    ])

    manager.addMapping(55555, 55555, 0, (err, mapping) => {
      manager.renewMappings(() => {
        expect(err).to.not.exist()
        expect(mapping).to.exist()
        expect(mapping.protocol).to.eql('1')
        expect(mapping.internalPort).to.eql(55555)
        done()
      })
    })
  })
})
