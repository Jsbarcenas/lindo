import { DEVICE_ID_KEY, isDeviceId, newDeviceId } from '@lindo/shared'

/**
 * El identificador de aparato de este navegador, guardado de una vez.
 *
 * Antes aquí iba la cadena `web`, literalmente la misma en todas las
 * instalaciones. El cliente deriva de este valor los hashes con los que cifra
 * el certificado de Ankama Shield, así que eso significaba que todos los
 * jugadores de la versión web se presentaban como el mismo aparato - que para
 * cualquier heurística de multicuenta es una señal bastante más llamativa que
 * un user-agent que no cuadra. Ver `packages/shared/utils/device-id.ts`.
 *
 * Va en `localStorage` y no en el almacén de IndexedDB que usa el resto del
 * host, a propósito: «reiniciar los datos del juego» vacía ese almacén, y
 * llevarse por delante la identidad del aparato haría que Ankama pidiera el
 * código de seguridad cada vez que alguien limpia su caché. Son dos cosas
 * distintas y conviene que se borren por separado.
 */
export const deviceId = (): string => {
  try {
    const stored = window.localStorage.getItem(DEVICE_ID_KEY)
    if (isDeviceId(stored)) return stored

    const created = newDeviceId()
    window.localStorage.setItem(DEVICE_ID_KEY, created)
    return created
  } catch (error) {
    // modo privado, o almacenamiento bloqueado por el navegador. Uno de sesión
    // es peor que uno persistente, pero sigue siendo mejor que el mismo para
    // todo el mundo - y aquí no hay dónde guardarlo.
    console.warn('lindo: no se pudo guardar el identificador de aparato', error)
    return newDeviceId()
  }
}
