/**
 * The probe server. Stands in for the validation server, on loopback only.
 *
 *   node tools/android-probe/server.mjs
 *
 * It plays two roles at once: it is the thing being lied to (so it records the
 * request headers exactly as they arrive, in order) and the thing doing the
 * grading (so it runs every evaluator over the pair of captures).
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluateAll, summarize } from './signals/index.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const RUNS = path.join(HERE, 'runs')
const PLATFORM_JS = path.join(HERE, '..', '..', 'apps', 'desktop', 'game-base', 'platform.js')
const PORT = 8420
const HOST = '127.0.0.1'

/**
 * High-entropy client hints are not sent until the server asks for them, and the
 * ask only takes effect from the *next* request to the origin. Every response
 * carries these so that by the time the probe posts its payload, the request
 * carrying it has the full set.
 */
const HINT_HEADERS = {
  'Accept-CH': 'Sec-CH-UA-Model, Sec-CH-UA-Platform-Version, Sec-CH-UA-Arch, Sec-CH-UA-Bitness, Sec-CH-UA-Full-Version-List',
  'Critical-CH': 'Sec-CH-UA-Model, Sec-CH-UA-Platform-Version, Sec-CH-UA-Arch, Sec-CH-UA-Bitness',
  // the probe is injected into a page served from another origin
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
}

/** rawHeaders is a flat [k, v, k, v] list and is the only view that keeps order */
const pairsOf = (req) => {
  const pairs = []
  for (let i = 0; i < req.rawHeaders.length; i += 2) pairs.push([req.rawHeaders[i], req.rawHeaders[i + 1]])
  return pairs
}

/** last capture seen per session, so the POST can be graded against the warm-up */
const captures = new Map()

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > 4_000_000) reject(new Error('payload too large'))
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })

const nextRunFile = (label) => {
  fs.mkdirSync(RUNS, { recursive: true })
  const index = String(fs.readdirSync(RUNS).filter((name) => name.endsWith('.json')).length).padStart(3, '0')
  return path.join(RUNS, `${index}-${label}.json`)
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`)
  const send = (status, type, body) => {
    res.writeHead(status, { 'Content-Type': type, ...HINT_HEADERS })
    res.end(body)
  }

  if (req.method === 'OPTIONS') return send(204, 'text/plain', '')

  if (url.pathname === '/probe.js') {
    return send(200, 'application/javascript', fs.readFileSync(path.join(HERE, 'probe.js')))
  }

  if (url.pathname === '/platform.js') {
    return send(200, 'application/javascript', fs.readFileSync(PLATFORM_JS))
  }

  /**
   * The installer applied to a blank page, then measured by the probe.
   *
   * This is not a substitute for the real capture: it runs in whatever browser
   * opens it rather than in the game frame, so the HTTP signals describe that
   * browser and mean nothing here. What it does check, and what needs no game
   * running, is whether the JS-layer overrides hold up - including the tamper
   * checks, which are about how the values were installed rather than where.
   */
  if (url.pathname === '/selftest') {
    return send(
      200,
      'text/html',
      `<!doctype html><meta charset="utf-8"><title>platform.js selftest</title>
<body><p>installing, then probing - see the console and runs/</p>
<script src="/platform.js"></script>
<script>
  window.top.androidProfile = null
  window.installLindoPlatform(window, {
    androidVersion: '15', chromeVersion: '139.0.7258.123', chromeMajor: '139',
    model: 'Pixel 8', manufacturer: 'Google', navigatorPlatform: 'Linux armv8l',
    glVendor: 'ARM', glRenderer: 'Mali-G715-Immortalis MC11', cores: 9, memory: 8,
    uuid: 'aaaaaaaaaaaaaaaa'
  })
</script>
<script src="/probe.js"></script></body>`
    )
  }

  // a standalone page, only useful to check the server is up - it measures a
  // clean document, not the game frame
  if (url.pathname === '/probe') {
    return send(
      200,
      'text/html',
      `<!doctype html><meta charset="utf-8"><title>android-probe</title>
<p>Inject <code>probe.js</code> into the game frame instead of loading this page:</p>
<pre>var s=document.createElement('script');s.src='http://${HOST}:${PORT}/probe.js';document.head.appendChild(s)</pre>
<script src="/probe.js"></script>`
    )
  }

  // the warm-up request: its only job is to be a second request to this origin
  if (url.pathname === '/echo') {
    captures.set(url.searchParams.get('sid'), { headers: pairsOf(req), httpVersion: req.httpVersion })
    return send(200, 'application/json', JSON.stringify({ ok: true }))
  }

  if (url.pathname === '/collect' && req.method === 'POST') {
    const sid = url.searchParams.get('sid')
    let js
    try {
      js = JSON.parse(await readBody(req))
    } catch (error) {
      return send(400, 'application/json', JSON.stringify({ error: error.message }))
    }

    // grade against the POST's own headers: it is the later request, so it is
    // the one carrying the high-entropy hints
    const ctx = { http: { headers: pairsOf(req), httpVersion: req.httpVersion }, js }
    const warmUp = captures.get(sid)
    const results = evaluateAll(ctx)
    const totals = summarize(results)

    // A capture taken anywhere but the game frame describes a document the
    // overrides were never applied to, and reads as a clean result. Recording
    // that judgement with the run keeps a bad capture from being mistaken for a
    // good one later, when nobody remembers where it was taken.
    const context = js.context ?? {}
    const trusted = Boolean(context.isGameFrame && context.hasInstaller)

    const file = nextRunFile(url.searchParams.get('label') ?? 'run')
    fs.writeFileSync(
      file,
      JSON.stringify(
        { at: new Date().toISOString(), trusted, context, totals, results, capture: { http: ctx.http, warmUp, js } },
        null,
        2
      )
    )

    if (!trusted) {
      console.log(`\n  !! this capture did not come from the game frame (${context.href ?? 'unknown'})`)
      console.log('     isGameFrame=%s hasInstaller=%s', context.isGameFrame, context.hasInstaller)
      console.log('     inject probe.js into the game document, not the renderer or a new tab')
    }

    const failed = results
      .filter((result) => result.verdict === 'FAIL')
      .map(({ id, family, observed, expected }) => ({ id, family, observed, expected }))

    console.log(`\n[${path.basename(file)}] PASS ${totals.pass} · FAIL ${totals.fail} · MISSING ${totals.missing}`)
    for (const result of failed) console.log(`  FAIL ${result.family} ${result.id}: ${result.observed}`)

    return send(200, 'application/json', JSON.stringify({ file: path.basename(file), ...totals, failed }))
  }

  send(404, 'text/plain', 'not found')
})

server.listen(PORT, HOST, () => {
  console.log(`android-probe listening on http://${HOST}:${PORT}`)
  console.log('inject into the game frame console:')
  console.log(`  var s=document.createElement('script');s.src='http://${HOST}:${PORT}/probe.js';document.head.appendChild(s)`)
})
