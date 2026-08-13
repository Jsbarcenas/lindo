/* eslint-disable */
/**
 * Serves character portraits out of IndexedDB.
 *
 * `CharacterCard` builds its `<img src>` as `characterImagesSrc + name + '.png'`,
 * which on the desktop is a path Express serves off disk. Keeping that shape is
 * what lets `@lindo/ui` stay untouched, and a worker is the only way a page can
 * answer a request for a URL that has no file behind it.
 *
 * Anything outside /character-images/ is left alone: this is not a caching
 * worker and must not start behaving like one.
 */
const PREFIX = '/character-images/'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

const readImage = (key) =>
  new Promise((resolve) => {
    const request = indexedDB.open('lindo', 1)
    request.onsuccess = () => {
      const db = request.result
      if (!db.objectStoreNames.contains('kv')) return resolve(undefined)
      const read = db.transaction('kv', 'readonly').objectStore('kv').get(key)
      read.onsuccess = () => resolve(read.result)
      read.onerror = () => resolve(undefined)
    }
    request.onerror = () => resolve(undefined)
  })

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin || !url.pathname.startsWith(PREFIX)) return

  event.respondWith(
    (async () => {
      const name = decodeURIComponent(url.pathname.slice(PREFIX.length))
      const dataUrl = await readImage(`character-image:${name}`)
      if (typeof dataUrl !== 'string') return new Response('', { status: 404 })

      // stored as the data URL the game produced with canvas.toDataURL
      const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
      const binary = atob(base64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      return new Response(bytes, { headers: { 'Content-Type': 'image/png' } })
    })()
  )
})
