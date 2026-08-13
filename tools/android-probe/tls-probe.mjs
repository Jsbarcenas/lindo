/**
 * Captures TLS ClientHellos and fingerprints them.
 *
 *   node tools/android-probe/tls-probe.mjs
 *
 * This is the layer nothing else here could see. Every signal the rest of the
 * harness grades is chosen by the client and can be set to anything; the
 * ClientHello is emitted by the TLS stack before a byte of HTTP exists, and
 * says which stack that is regardless of what the headers claim afterwards.
 *
 * It listens as a raw TCP socket rather than a TLS server on purpose: the
 * ClientHello is the first thing the client sends, so it can be read and the
 * connection dropped without a certificate. The client sees a failed
 * handshake - which is fine, the request was only ever a way to make it speak.
 *
 * Point things at it with:
 *   host      curl -sk https://127.0.0.1:8443/ ; echo
 *   emulator  adb shell am start -a android.intent.action.VIEW -d https://10.0.2.2:8443/
 *   Lindo     fetch('https://127.0.0.1:8443/').catch(() => {}) in the game frame
 */
import net from 'node:net'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, 'runs', 'tls.json')
const PORT = 8443

/**
 * GREASE values, which Chrome inserts at random to keep servers from ossifying
 * on a fixed list. They are excluded from every fingerprint, or the same client
 * would hash differently on each connection.
 */
const isGrease = (value) => (value & 0x0f0f) === 0x0a0a && (value >> 8) === (value & 0xff)

const parseClientHello = (buffer) => {
  if (buffer.length < 45 || buffer[0] !== 0x16) return null
  let offset = 5
  if (buffer[offset] !== 0x01) return null

  offset += 4 // handshake type + length
  const clientVersion = buffer.readUInt16BE(offset)
  offset += 2 + 32 // version + random

  const sessionIdLength = buffer[offset]
  offset += 1 + sessionIdLength

  const cipherBytes = buffer.readUInt16BE(offset)
  offset += 2
  const ciphers = []
  for (let i = 0; i < cipherBytes; i += 2) ciphers.push(buffer.readUInt16BE(offset + i))
  offset += cipherBytes

  const compressionLength = buffer[offset]
  offset += 1 + compressionLength

  const extensions = []
  const curves = []
  const pointFormats = []
  const alpn = []
  const sigAlgs = []
  let sni = false
  let supportedVersionMax = clientVersion

  if (offset + 2 <= buffer.length) {
    const extensionsEnd = offset + 2 + buffer.readUInt16BE(offset)
    offset += 2
    while (offset + 4 <= extensionsEnd && offset + 4 <= buffer.length) {
      const type = buffer.readUInt16BE(offset)
      const length = buffer.readUInt16BE(offset + 2)
      const body = buffer.subarray(offset + 4, offset + 4 + length)
      extensions.push(type)

      if (type === 0x0000) sni = true
      if (type === 0x000a && body.length >= 2) {
        for (let i = 2; i + 1 < body.length; i += 2) curves.push(body.readUInt16BE(i))
      }
      if (type === 0x000b && body.length >= 1) {
        for (let i = 1; i < body.length; i++) pointFormats.push(body[i])
      }
      if (type === 0x000d && body.length >= 2) {
        for (let i = 2; i + 1 < body.length; i += 2) sigAlgs.push(body.readUInt16BE(i))
      }
      if (type === 0x0010 && body.length >= 3) {
        let cursor = 2
        while (cursor < body.length) {
          const size = body[cursor]
          alpn.push(body.subarray(cursor + 1, cursor + 1 + size).toString())
          cursor += 1 + size
        }
      }
      if (type === 0x002b && body.length >= 1) {
        for (let i = 1; i + 1 < body.length; i += 2) {
          const version = body.readUInt16BE(i)
          if (!isGrease(version) && version > supportedVersionMax) supportedVersionMax = version
        }
      }
      offset += 4 + length
    }
  }

  return { clientVersion, ciphers, extensions, curves, pointFormats, alpn, sigAlgs, sni, supportedVersionMax }
}

const ja3 = (hello) => {
  const clean = (values) => values.filter((value) => !isGrease(value))
  const parts = [
    hello.supportedVersionMax,
    clean(hello.ciphers).join('-'),
    clean(hello.extensions).join('-'),
    clean(hello.curves).join('-'),
    hello.pointFormats.join('-')
  ].join(',')
  return { string: parts, hash: crypto.createHash('md5').update(parts).digest('hex') }
}

/** https://github.com/FoxIO-LLC/ja4 - the TLS variant, TCP transport */
const ja4 = (hello) => {
  const versionLabel = { 0x0304: '13', 0x0303: '12', 0x0302: '11', 0x0301: '10' }[hello.supportedVersionMax] ?? '00'
  const ciphers = hello.ciphers.filter((value) => !isGrease(value))
  // SNI and ALPN extensions are counted but not listed in the hashed part
  const extensions = hello.extensions.filter((value) => !isGrease(value) && value !== 0x0000 && value !== 0x0010)
  const alpnLabel = hello.alpn.length ? hello.alpn[0].slice(0, 1) + hello.alpn[0].slice(-1) : '00'

  const pad = (n) => String(Math.min(n, 99)).padStart(2, '0')
  const hex = (values) => values.map((value) => value.toString(16).padStart(4, '0'))
  const truncate = (input) => crypto.createHash('sha256').update(input).digest('hex').slice(0, 12)

  const a = `t${versionLabel}${hello.sni ? 'd' : 'i'}${pad(ciphers.length)}${pad(
    hello.extensions.filter((value) => !isGrease(value)).length
  )}${alpnLabel}`
  const b = truncate(hex(ciphers).sort().join(','))
  const c = truncate(`${hex(extensions).sort().join(',')}_${hex(hello.sigAlgs.filter((v) => !isGrease(v))).join(',')}`)
  return `${a}_${b}_${c}`
}

const captures = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : []

const server = net.createServer((socket) => {
  socket.once('data', (buffer) => {
    const hello = parseClientHello(buffer)
    if (!hello) {
      console.log(`  not a ClientHello from ${socket.remoteAddress} (${buffer.length} bytes)`)
      socket.destroy()
      return
    }

    const label = process.argv[2] ?? socket.remoteAddress
    const fingerprint = ja3(hello)
    const record = {
      label,
      from: socket.remoteAddress,
      ja3: fingerprint.hash,
      ja3String: fingerprint.string,
      ja4: ja4(hello),
      cipherCount: hello.ciphers.filter((value) => !isGrease(value)).length,
      extensionCount: hello.extensions.filter((value) => !isGrease(value)).length,
      alpn: hello.alpn,
      curves: hello.curves.filter((value) => !isGrease(value)),
      // kept in order, not sorted: JA4 hashes these as sent, and a stack can
      // differ from another by the order alone
      sigAlgs: hello.sigAlgs.filter((value) => !isGrease(value)),
      extensionList: hello.extensions.filter((value) => !isGrease(value)),
      greasePresent: hello.ciphers.some(isGrease)
    }
    captures.push(record)
    fs.writeFileSync(OUT, JSON.stringify(captures, null, 2))

    console.log(`\n[${label}] from ${socket.remoteAddress}`)
    console.log(`  JA3  ${record.ja3}`)
    console.log(`  JA4  ${record.ja4}`)
    console.log(`  ciphers ${record.cipherCount} · extensions ${record.extensionCount} · alpn ${record.alpn.join(',') || '-'}`)
    console.log(`  grease ${record.greasePresent ? 'yes' : 'no'}`)
    socket.destroy()
  })
  socket.on('error', () => {})
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`tls-probe listening on 0.0.0.0:${PORT} - writing to runs/tls.json`)
  console.log('  host      curl -sk https://127.0.0.1:8443/')
  console.log('  emulator  adb shell am start -a android.intent.action.VIEW -d https://10.0.2.2:8443/')
})
