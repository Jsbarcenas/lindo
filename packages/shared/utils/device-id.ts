/**
 * El identificador de aparato que acaba viendo Ankama.
 *
 * El cliente lo lee del `uuid` de Cordova y deriva de él dos hashes - los llama
 * `hm1` y `hm2` - que **no son solo un identificador: son la clave con la que
 * cifra el certificado de Ankama Shield**. Su propio aviso lo dice: el
 * certificado deja de descifrarse "cuando la huella ha cambiado".
 *
 * De ahí salen las dos exigencias, y tiran en direcciones opuestas:
 *
 *   estable  · si cambia, el certificado se cae y Ankama vuelve a pedir el
 *              código por correo. El escritorio lo derivaba del hash de su
 *              propio ejecutable, así que cambiaba en **cada actualización**,
 *              y ese era el motivo real de las reverificaciones.
 *   distinto · si es el mismo para todo el mundo, todos los jugadores parecen
 *              un solo aparato. La web mandaba la cadena `web`, literalmente
 *              idéntica en todas las instalaciones - que para cualquier
 *              heurística de multicuenta es una señal mucho más ruidosa que
 *              un user-agent raro.
 *
 * Un valor aleatorio guardado una vez cumple las dos. El formato imita al
 * `ANDROID_ID` que devolvería Cordova en un Android de verdad -dieciséis
 * dígitos hexadecimales en minúscula- porque el cliente dice ser Android y un
 * identificador con otra forma es en sí mismo algo que mirar.
 */
const LENGTH = 16

/** el nombre bajo el que se guarda, igual en todas las versiones */
export const DEVICE_ID_KEY = 'lindo:device-id'

export const isDeviceId = (value: unknown): value is string =>
  typeof value === 'string' && new RegExp(`^[0-9a-f]{${LENGTH}}$`).test(value)

export const newDeviceId = (): string => {
  const bytes = new Uint8Array(LENGTH / 2)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
