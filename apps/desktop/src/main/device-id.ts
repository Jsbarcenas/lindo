import { DEVICE_ID_KEY, isDeviceId, newDeviceId } from '@lindo/shared'
import ElectronStore from 'electron-store'
import { logger } from './logger'

/**
 * El identificador de aparato de esta instalación, guardado de una vez.
 *
 * Antes se derivaba del hash del propio ejecutable empaquetado, y eso tenía dos
 * consecuencias que nadie había atado con su síntoma. Que fuese **el mismo para
 * todos** los que corriesen la misma versión, y que **cambiase en cada
 * actualización**: por eso Ankama volvía a pedir el código de seguridad por
 * correo después de actualizar. No era el login fallando, era el certificado de
 * Ankama Shield, que se cifra con este valor y dejaba de descifrarse en cuanto
 * cambiaba el binario. Ver `packages/shared/utils/device-id.ts`.
 *
 * Vive en `electron-store`, que escribe en el directorio de datos del usuario y
 * por tanto sobrevive a las actualizaciones - que es justo lo que el ejecutable
 * no hacía.
 */
interface DeviceStore {
  [DEVICE_ID_KEY]?: string
}

let cached: string | undefined

export const deviceId = (): string => {
  if (cached) return cached

  const store = new ElectronStore<DeviceStore>()
  const stored = store.get(DEVICE_ID_KEY)
  if (isDeviceId(stored)) {
    cached = stored
    return stored
  }

  const created = newDeviceId()
  store.set(DEVICE_ID_KEY, created)
  // se dice una vez y en claro: la primera vez que corre esto, el certificado
  // guardado se queda sin poder descifrarse y Ankama pide el código una última
  // vez. Es el mismo precio que ya se pagaba en cada actualización.
  logger.info('lindo: identificador de aparato creado; Ankama pedirá el código de seguridad una vez más')
  return created
}
