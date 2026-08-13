/**
 * Sonda: ¿está la plataforma construyendo `api/` siquiera?
 *
 * Cuando `/haapi/…` devuelve 404 hay dos causas indistinguibles desde fuera -
 * que el directorio no se esté construyendo (Root Directory mal puesto, o
 * `vercel.json` sin leer) o que falle la función concreta. Esto separa las dos
 * en un curl: si `/api/ping` responde, `api/` se construye y el problema está
 * en el proxy; si también da 404, no se construye nada y hay que mirar los
 * ajustes del proyecto.
 *
 * Se puede borrar en cuanto el despliegue esté sano.
 */
export const config = { runtime: 'edge' }

export default async () =>
  new Response(JSON.stringify({ ok: true }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  })
