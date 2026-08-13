/**
 * Sonda de diagnóstico del despliegue.
 *
 * Responde qué cabeceras **llegan** a la función. Solo los nombres, nunca los
 * valores: por aquí pasa la `apikey` de quien llame, y un eco completo sería
 * publicar la sesión de cualquiera que toque la URL.
 *
 * Existe porque `/haapi/…` devolvía 403 con una clave que directamente daba
 * 200, y desde fuera eso tiene dos causas indistinguibles: que la cabecera no
 * llegue hasta aquí, o que llegue y Ankama rechace la petición por venir de una
 * IP de datacenter. Esto contesta la primera; si `apikey` aparece en la lista,
 * la cabecera viaja y el problema es de salida, no de entrada.
 *
 * Se borra en cuanto el proxy esté sano.
 */
export const config = { runtime: 'edge' }

export default async (request) =>
  new Response(
    JSON.stringify(
      {
        runtime: 'edge',
        method: request.method,
        recibidas: [...request.headers.keys()].sort(),
        apikey: request.headers.has('apikey')
      },
      null,
      1
    ),
    { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
  )
