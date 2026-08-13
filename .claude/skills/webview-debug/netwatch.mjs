/**
 * Graba lo que falla en el WebView: red, WebSockets y consola.
 *
 *   node .claude/skills/webview-debug/netwatch.mjs [segundos]
 *
 * Se engancha a **todos** los contextos, no solo a la página: el service worker
 * es un target aparte y es quien sirve `/game/build/*` desde IndexedDB, así que
 * mirar solo la página deja fuera la mitad de las peticiones.
 *
 * De cada respuesta 4xx/5xx imprime también qué cabeceras llevaba la petición.
 * Esa línea es la que resolvió el "todos los servidores están en mantenimiento":
 * un POST a `RefreshApiKey` con `Content-Type` y sin cuerpo, contestado con 422.
 *
 * Requiere `attach.sh` corriendo antes, y otra vez después de cada reinicio de
 * la app.
 */
const SECONDS = Number(process.argv[2] ?? 60)
const ENDPOINT = 'http://localhost:9222/json'

const targets = await fetch(ENDPOINT)
  .then((response) => response.json())
  .catch(() => {
    console.error(`No hay DevTools en ${ENDPOINT}. Lanza antes attach.sh`)
    process.exit(2)
  })

const debuggable = targets.filter((target) => target.webSocketDebuggerUrl)
if (debuggable.length === 0) {
  console.error('DevTools responde pero no expone ningún contexto depurable')
  process.exit(2)
}

console.log(`grabando ${SECONDS}s sobre ${debuggable.length} contexto(s): ${debuggable.map((t) => t.type).join(', ')}`)

for (const target of debuggable) {
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  const requests = new Map()
  let closing = false
  let id = 0
  const send = (method) => socket.send(JSON.stringify({ id: ++id, method }))

  socket.addEventListener('open', () => {
    send('Network.enable')
    send('Log.enable')
    send('Runtime.enable')
  })

  socket.addEventListener('message', (event) => {
    const { method, params } = JSON.parse(event.data)
    if (!method) return

    if (method === 'Network.requestWillBeSent') {
      requests.set(params.requestId, params.request)
      return
    }

    const label = `[${target.type}]`
    if (method === 'Network.responseReceived' && params.response.status >= 400) {
      console.log(`${label} HTTP ${params.response.status} ${params.response.url.slice(0, 160)}`)
      const request = requests.get(params.requestId)
      if (request) {
        console.log(`         método: ${request.method}  cabeceras: ${Object.keys(request.headers).join(', ')}`)
        if (request.postData) console.log(`         cuerpo: ${String(request.postData).slice(0, 200)}`)
      }
      return
    }

    if (method === 'Network.loadingFailed') {
      const request = requests.get(params.requestId)
      console.log(`${label} FALLO ${params.errorText} ${request?.url?.slice(0, 160) ?? ''}`)
      return
    }

    if (method === 'Network.webSocketCreated') console.log(`${label} WS abierto ${params.url}`)
    if (method === 'Network.webSocketFrameError') console.log(`${label} WS error ${params.errorMessage}`)
    if (method === 'Log.entryAdded' && params.entry.level === 'error') {
      console.log(`${label} CONSOLA ${params.entry.text.slice(0, 240)}`)
    }
    if (method === 'Runtime.exceptionThrown') {
      const details = params.exceptionDetails
      console.log(`${label} EXCEPCIÓN ${details.exception?.description?.slice(0, 240) ?? details.text}`)
    }
  })

  // al cerrar a propósito también salta 'error', y decir que se perdió la
  // conexión justo cuando termina la grabación solo confunde
  socket.addEventListener('error', () => {
    if (!closing) console.error(`${target.type}: se perdió la conexión con DevTools`)
  })
  setTimeout(() => {
    closing = true
    socket.close()
  }, SECONDS * 1000)
}

setTimeout(() => process.exit(0), SECONDS * 1000 + 500)
