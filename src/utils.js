'use strict'
const ipaddr = require('ipaddr.js')
const os = require('os')

/**
 * List of popular router default IPs
 * Used as destination addresses for NAT-PMP and PCP requests
 * http://www.techspot.com/guides/287-default-router-ip-addresses/
 */
const ROUTER_IPS = ['192.168.1.1', '192.168.2.1', '192.168.11.1',
  '192.168.0.1', '192.168.0.30', '192.168.0.50', '192.168.20.1',
  '192.168.30.1', '192.168.62.1', '192.168.100.1', '192.168.102.1',
  '192.168.1.254', '192.168.10.1', '192.168.123.254', '192.168.4.1',
  '10.0.0.1', '10.0.1.1', '10.1.1.1', '10.0.0.13', '10.0.0.2',
  '10.0.0.138'
]

/**
  * Return the private IP addresses of the computer
  */
function getPrivateIps () {
  const ifs = os.networkInterfaces()
  return Object.keys(ifs)
    .map(k => ifs[k])
    .reduce((a, b) => a.concat(b), [])
    .filter(i => !i.internal)
    .map(i => i.address)
    .filter(a => ipaddr.IPv4.isValid(a))
}

/**
* Filters routerIps for only those that match any of the user's IPs in privateIps
* i.e. The longest prefix matches of the router IPs with each user IP*
*
* @param  {Array<string>} privateIps Private IPs to match router IPs to
* @return {Array<string>} Router IPs that matched (one per private IP)
*/
function filterRouterIps (privateIps) {
  let routerIps = []
  privateIps.forEach(function (privateIp) {
    routerIps.push(longestPrefixMatch(ROUTER_IPS, privateIp))
  })
  return routerIps
}

/**
 * Creates an ArrayBuffer with a compact matrix notation, i.e.
 * [[bits, byteOffset, value],
 *  [8, 0, 1], //=> DataView.setInt8(0, 1)
 *  ... ]
 *
 * @param  {number} bytes Size of the ArrayBuffer in bytes
 * @param  {Array<Array<number>>} matrix Matrix of values for the ArrayBuffer
 * @return {ArrayBuffer} An ArrayBuffer constructed from matrix
 */
const createArrayBuffer = function (bytes, matrix) {
  const buffer = new ArrayBuffer(bytes)
  const view = new DataView(buffer)
  for (let i = 0; i < matrix.length; i++) {
    const row = matrix[i]
    if (row[0] === 8) {
      view.setInt8(row[1], row[2])
    } else if (row[0] === 16) {
      view.setInt16(row[1], row[2], false)
    } else if (row[0] === 32) {
      view.setInt32(row[1], row[2], false)
    } else {
      console.error('Invalid parameters to createArrayBuffer')
    }
  }
  return Buffer.from(buffer)
}

/**
 * Return a promise that rejects in a given time with an Error message,
 * and can call a callback function before rejecting
 *
 * @param {number} time Time in seconds
 * @param {number} msg Message to encapsulate in the rejected Error
 * @param {function} callback Function to call before rejecting
 * @return {Promise} A promise that will reject in the given time
 */
const countdownReject = function (time, msg, callback) {
  return new Promise(function (resolve, reject) {
    setTimeout(function () {
      if (callback !== undefined) {
        callback()
      }
      reject(new Error(msg))
    }, time)
  })
}

/**
 * Close the OS-level sockets and discard its Freedom object
 *
 * @param {freedom_UdpSocket.Socket} socket The socket object to close
 */
const closeSocket = function (socket) {
  socket.close()
}

/**
 * Takes a list of IP addresses and an IP address, and returns the longest prefix
 * match in the IP list with the IP
 *
 * @param {Array} ipList List of IP addresses to find the longest prefix match in
 * @param {string} matchIp The router's IP address as a string
 * @return {string} The IP from the given list with the longest prefix match
 */
const longestPrefixMatch = function (ipList, matchIp) {
  const prefixMatches = []
  matchIp = ipaddr.IPv4.parse(matchIp)
  for (let i = 0; i < ipList.length; i++) {
    const ip = ipaddr.IPv4.parse(ipList[i])
    // Use ipaddr.js to find the longest prefix length (mask length)
    for (let mask = 1; mask < 32; mask++) {
      if (!ip.match(matchIp, mask)) {
        prefixMatches.push(mask - 1)
        break
      }
    }
  }
  // Find the argmax for prefixMatches, i.e. the index of the correct private IP
  const maxIndex = prefixMatches.indexOf(Math.max.apply(null, prefixMatches))
  const correctIp = ipList[maxIndex]
  return correctIp
}

/**
 * Return a random integer in a specified range
 *
 * @param {number} min Lower bound for the random integer
 * @param {number} max Upper bound for the random integer
 * @return {number} A random number between min and max
 */
const randInt = function (min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

/**
 * Convert an ArrayBuffer to a UTF-8 string
 * @public
 * @method arrayBufferToString
 * @param {ArrayBuffer} buffer ArrayBuffer to convert
 * @return {string} A string converted from the ArrayBuffer
 */
const arrayBufferToString = function (buffer) {
  const bytes = new Uint8Array(buffer)
  const a = []
  for (let i = 0; i < bytes.length; ++i) {
    a.push(String.fromCharCode(bytes[i]))
  }
  return a.join('')
}

/**
 * Convert a UTF-8 string to an ArrayBuffer
 *
 * @param {string} s String to convert
 * @return {ArrayBuffer} An ArrayBuffer containing the string data
 */
const stringToArrayBuffer = function (s) {
  const buffer = new ArrayBuffer(s.length)
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < s.length; ++i) {
    bytes[i] = s.charCodeAt(i)
  }
  return Buffer.from(buffer)
}

/**
 * Returns the difference between two arrays
 *
 * @param  {Array} listA
 * @param  {Array} listB
 * @return {Array} The difference array
 */
const arrDiff = function (listA, listB) {
  const diff = []
  listA.forEach(function (a) {
    if (listB.indexOf(a) === -1) {
      diff.push(a)
    }
  })
  return diff
}

/**
 * Adds two arrays, but doesn't include repeated elements
 *
 * @param  {Array} listA
 * @param  {Array} listB
 * @return {Array} The sum of the two arrays with no duplicates
 */
const arrAdd = function (listA, listB) {
  const sum = []
  listA.forEach(function (a) {
    if (sum.indexOf(a) === -1) {
      sum.push(a)
    }
  })
  listB.forEach(function (b) {
    if (sum.indexOf(b) === -1) {
      sum.push(b)
    }
  })
  return sum
}
module.exports = {
  ROUTER_IPS,
  createArrayBuffer,
  countdownReject,
  closeSocket,
  longestPrefixMatch,
  randInt,
  arrayBufferToString,
  stringToArrayBuffer,
  arrAdd,
  arrDiff,
  getPrivateIps,
  filterRouterIps
}
