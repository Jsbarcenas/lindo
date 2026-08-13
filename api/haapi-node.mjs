/**
 * El mismo proxy de `haapi.mjs`, pero en el runtime de Node en vez de Edge.
 *
 * Temporal, para una pregunta concreta: la versión Edge reenvía la `apikey` y
 * aun así Ankama contesta 403 con una clave que directamente da 200. Los dos
 * runtimes salen a internet por sitios distintos y tratan las cabeceras por
 * caminos distintos, así que tenerlos a la vez dice cuál de las dos cosas
 * importa. En cuanto se sepa, sobra uno de los dos ficheros.
 *
 * Sin `upstream` responde qué cabeceras le llegaron - solo los nombres, que
 * los valores incluyen la clave de quien llame.
 */
const UPSTREAM = 'https://haapi.ankama.com'

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

const readBody = (request) =>
  new Promise((resolve, reject) => {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => resolve(Buffer.concat(chunks)))
    request.on('error', reject)
  })

export default async function handler(request, response) {
  const url = new URL(request.url, 'http://localhost')
  const path = url.searchParams.get('upstream')

  if (!path) {
    response.setHeader('Content-Type', 'application/json')
    response.setHeader('Cache-Control', 'no-store')
    return response.status(200).end(
      JSON.stringify(
        {
          runtime: 'node',
          method: request.method,
          recibidas: Object.keys(request.headers).sort(),
          apikey: 'apikey' in request.headers
        },
        null,
        1
      )
    )
  }

  url.searchParams.delete('upstream')
  const query = url.searchParams.toString()

  const headers = {}
  for (const [name, value] of Object.entries(request.headers)) {
    if (forwardable(name) && typeof value === 'string') headers[name] = value
  }

  const hasBody = !['GET', 'HEAD'].includes(request.method)
  try {
    const upstream = await fetch(`${UPSTREAM}/${path.replace(/^\/+/, '')}${query ? `?${query}` : ''}`, {
      method: request.method,
      headers,
      body: hasBody ? await readBody(request) : undefined,
      redirect: 'manual'
    })
    const body = Buffer.from(await upstream.arrayBuffer())
    response.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/json')
    // una respuesta de cuenta cacheada es la sesión de otro
    response.setHeader('Cache-Control', 'no-store')
    response.status(upstream.status).end(body)
  } catch (error) {
    response.setHeader('Content-Type', 'text/plain; charset=utf-8')
    response.status(502).end(`no se pudo alcanzar haapi: ${error.message}`)
  }
}
