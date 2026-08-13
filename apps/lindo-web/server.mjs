/**
 * Static server for the built app.
 *
 * A dependency-free server rather than a package, because what is being served
 * needs two different caching rules and a SPA fallback, and expressing that is
 * about as much code as configuring someone else's server would be.
 */
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'dist')
const PORT = Number(process.env.PORT ?? 8080)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm'
}

/**
 * Vite fingerprints what it emits into /assets, so those can be cached forever.
 * Nothing else can: the game shell keeps the same paths across deploys and its
 * contents change whenever Ankama ships a build, so a long max-age there would
 * pin players to a client that no longer matches the servers.
 */
const cacheFor = (pathname) =>
  pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'

const send = (response, status, headers, body) => {
  response.writeHead(status, headers)
  response.end(body)
}

/**
 * Ankama's account API, reached through this origin.
 *
 * Its preflight answers with `access-control-request-headers` where
 * `Access-Control-Allow-Headers` belongs, so a browser never sees the `apikey`
 * header allowed and blocks the account call that follows a successful login.
 * Server to server there is no CORS to fail, so the request just goes through.
 * The dev server does the same via vite's proxy.
 */
const HAAPI = 'https://haapi.ankama.com'

const proxyHaapi = async (request, response, url) => {
  const target = HAAPI + url.pathname.slice('/haapi'.length) + url.search
  const headers = { ...request.headers }
  // the upstream must see its own host, and hop-by-hop headers do not travel
  delete headers.host
  delete headers.connection

  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : request,
      duplex: 'half'
    })
    const body = Buffer.from(await upstream.arrayBuffer())
    response.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
      'Content-Length': body.length,
      'Cache-Control': 'no-store'
    })
    response.end(body)
  } catch (error) {
    response.writeHead(502, { 'Content-Type': 'text/plain' })
    response.end(`no se pudo alcanzar haapi: ${error.message}`)
  }
}

http
  .createServer((request, response) => {
    const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`)

    if (url.pathname.startsWith('/haapi/')) return proxyHaapi(request, response, url)
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    let file = path.join(ROOT, relative)

    // never let a crafted path climb out of dist
    if (!file.startsWith(ROOT)) return send(response, 403, { 'Content-Type': 'text/plain' }, 'forbidden')

    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      const index = path.join(file, 'index.html')
      // the SPA fallback: unknown paths are routes, and HashRouter resolves them
      file = fs.existsSync(index) ? index : path.join(ROOT, 'index.html')
    }

    if (!fs.existsSync(file)) return send(response, 404, { 'Content-Type': 'text/plain' }, 'not found')

    const body = fs.readFileSync(file)
    send(response, 200, {
      'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': cacheFor(url.pathname),
      // the service worker that serves character portraits needs this scope
      ...(file.endsWith('character-images-sw.js') ? { 'Service-Worker-Allowed': '/' } : {})
    }, body)
  })
  .listen(PORT, '0.0.0.0', () => console.log(`lindo-web escuchando en :${PORT}`))
