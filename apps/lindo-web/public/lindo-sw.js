/* eslint-disable */
/**
 * Serves out of IndexedDB the two things that have no file behind them.
 *
 * `/game/build/*` is the Dofus shell, downloaded and patched in the page rather
 * than baked into the image, so the client updates itself the way the desktop
 * one does. `/character-images/*` are the portraits the game renders to a canvas.
 *
 * Both keep the URL shapes the rest of the code already builds - `<img src>` in
 * CharacterCard, `<script src="build/script.js">` inside the game's own
 * index.html - which is what lets @lindo/ui and game-base stay untouched.
 *
 * Everything else is passed through. This is not a caching worker and must not
 * start behaving like one: the game talks to Ankama constantly and those
 * responses have no business being intercepted.
 */
const IMAGES = '/character-images/'
const GAME_BUILD = '/game/build/'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

const read = (key) =>
  new Promise((resolve) => {
    const request = indexedDB.open('lindo', 1)
    request.onsuccess = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('kv')) return resolve(undefined)
      const get = db.transaction('kv', 'readonly').objectStore('kv').get(key)
      get.onsuccess = () => resolve(get.result)
      get.onerror = () => resolve(undefined)
    }
    request.onerror = () => resolve(undefined)
  })

const missing = (what) => new Response(`${what} no está almacenado todavía`, { status: 404 })

const servePortrait = async (pathname) => {
  const name = decodeURIComponent(pathname.slice(IMAGES.length))
  const dataUrl = await read(`character-image:${name}`)
  if (typeof dataUrl !== 'string') return missing(name)

  // stored as the data URL the game produced with canvas.toDataURL
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Response(bytes, { headers: { 'Content-Type': 'image/png' } })
}

const serveShell = async (pathname) => {
  const name = pathname.slice('/game/'.length)
  const source = await read(`game:${name}`)
  if (typeof source !== 'string') return missing(name)

  return new Response(source, {
    headers: {
      'Content-Type': name.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8',
      // the page decides when this changes, by comparing manifests
      'Cache-Control': 'no-cache'
    }
  })
}

/**
 * Las imágenes de noticias, pedidas sin referer.
 *
 * `static.ankama.com` las sirve detrás de una lista blanca de referers: sin
 * referer responde 200, con uno suyo responde 200, y con cualquier otro
 * responde 403 con `content-type: text/html` - que el navegador entonces
 * bloquea por ORB, y el carrusel queda en recuadros vacíos. El cliente real
 * corre sobre `file://` y no manda ninguno.
 *
 * Declarar la política en el documento no basta, y esto costó encontrarlo:
 * Chrome **no aplica la política del documento a las peticiones que nacen de
 * CSS**, y el carrusel las pide con `background-image`. Medido dentro del
 * WebView, misma URL y mismo documento:
 *
 *   new Image()        política=same-origin                    referer=(ninguno)
 *   background-image   política=strict-origin-when-cross-origin referer=http://…
 *
 * Aquí sí se puede: la petición se reemite desde el worker con
 * `referrerPolicy: 'no-referrer'`, y eso vale venga de donde venga. La
 * respuesta es opaca, que es todo lo que un fondo CSS necesita.
 *
 * Electron no pasa por aquí -no registra worker- y no lo necesita: allí se
 * quita el referer en la capa de red, en `game-window.ts`.
 */
const CMS = 'static.ankama.com'

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)

  if (url.hostname === CMS) {
    return event.respondWith(
      fetch(url.href, { mode: 'no-cors', credentials: 'omit', referrerPolicy: 'no-referrer' })
    )
  }

  if (url.origin !== self.location.origin) return

  if (url.pathname.startsWith(IMAGES)) return event.respondWith(servePortrait(url.pathname))
  if (url.pathname.startsWith(GAME_BUILD)) return event.respondWith(serveShell(url.pathname))
})
