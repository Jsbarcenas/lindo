/**
 * Haapi, alcanzado desde este mismo origen.
 *
 * Lo mismo que hacen `apps/lindo-web/server.mjs` y el servidor del APK, y por
 * el mismo motivo: el preflight de haapi contesta con
 * `access-control-request-headers` donde debería ir `Access-Control-Allow-
 * Headers`, así que el navegador nunca ve permitida la cabecera `apikey` y
 * bloquea la llamada de cuenta que sigue al login. Servidor contra servidor no
 * hay CORS que fallar.
 *
 * Esto lo hacía un rewrite de la plataforma apuntando directamente a
 * haapi.ankama.com. No servía: con la misma clave y en el mismo minuto,
 * directo devolvía 200 y por el rewrite 403 `Unauthorized service` - idéntico
 * a no mandar clave ninguna. La `apikey` no llegaba al otro lado.
 *
 * La ruta llega en el parámetro `upstream` en vez de por un fichero
 * `[...path]`. Un comodín de ese estilo es la forma idiomática, pero exige que
 * la plataforma reconozca esa sintaxis fuera de Next.js, y eso es justo lo que
 * no se puede comprobar sin desplegar. Un fichero plano no depende de nada.
 */
export const config = { runtime: 'edge' }

const UPSTREAM = 'https://haapi.ankama.com'

/**
 * Hop-by-hop, más lo que añade la propia plataforma. `accept-encoding` se cae
 * porque `fetch` ya descomprime la respuesta: reenviarlo llevaría a anunciar
 * una codificación que el cuerpo devuelto ya no tiene.
 */
const DROP = new Set([
  'host',
  'connection',
  'content-length',
  'transfer-encoding',
  'keep-alive',
  'upgrade',
  'accept-encoding'
])

const forwardable = (name) => !DROP.has(name) && !name.startsWith('x-vercel-') && !name.startsWith('x-forwarded-')

export default async function handler(request) {
  const url = new URL(request.url)

  // el rewrite mete la ruta aquí; el resto de la query es la que traía la
  // petición original, y esa viaja tal cual
  const path = url.searchParams.get('upstream') ?? ''
  url.searchParams.delete('upstream')
  const query = url.searchParams.toString()

  const headers = new Headers()
  for (const [name, value] of request.headers) {
    if (forwardable(name)) headers.set(name, value)
  }

  const hasBody = !['GET', 'HEAD'].includes(request.method)
  const target = `${UPSTREAM}/${path.replace(/^\/+/, '')}${query ? `?${query}` : ''}`

  try {
    const upstream = await fetch(target, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      redirect: 'manual'
    })
    const body = await upstream.arrayBuffer()
    return new Response(body, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
        // una respuesta de cuenta cacheada es la sesión de otro
        'Cache-Control': 'no-store'
      }
    })
  } catch (error) {
    return new Response(`no se pudo alcanzar haapi: ${error.message}`, {
      status: 502,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
    })
  }
}
