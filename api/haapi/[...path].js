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
 * Esto lo hacía un rewrite de la plataforma en `vercel.json`, apuntando
 * directamente a `haapi.ankama.com`. No servía: con la misma clave y en el
 * mismo minuto, directo devolvía 200 y por el rewrite 403 `Unauthorized
 * service` - exactamente la misma respuesta que sin mandar clave ninguna. La
 * `apikey` no llegaba al otro lado. Aquí las cabeceras se reenvían a mano, que
 * es lo que ya hacían las otras dos versiones.
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
  // el rewrite entra como /api/haapi/…, pero la función también responde en su
  // propia ruta; quitar los dos prefijos deja la misma URL en ambos casos
  const path = url.pathname.replace(/^\/api\/haapi/, '').replace(/^\/haapi/, '')

  const headers = new Headers()
  for (const [name, value] of request.headers) {
    if (forwardable(name)) headers.set(name, value)
  }

  const hasBody = !['GET', 'HEAD'].includes(request.method)
  try {
    const upstream = await fetch(UPSTREAM + path + url.search, {
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
