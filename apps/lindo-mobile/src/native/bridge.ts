import * as Application from 'expo-application'
import * as Device from 'expo-device'

/**
 * Lo que el lado nativo le cuenta a la página, y cómo se lo cuenta.
 *
 * El puerto a web ya dejó el hueco: `game-base/index.html` monta la superficie
 * de Cordova a partir de un perfil, y hasta ahora ese perfil era inventado.
 * Dentro de la app hay una fuente real, así que el mismo camino de código se
 * alimenta de `expo-device` y describe el aparato en el que corre de verdad.
 */

export interface NativeDevice {
  /** exactamente la forma que el bundle espera en `window.device` */
  cordova: string
  platform: string
  version: string
  model: string
  manufacturer: string
  isVirtual: boolean
  serial: string
  uuid: string
}

export interface NativeInfo {
  device: NativeDevice
  appVersion: string
  /** un emulador miente sobre su GPU; un teléfono no. Ver `platform.js`. */
  isEmulator: boolean
}

/**
 * La versión de Cordova que declara el cliente real.
 *
 * No hay Cordova aquí, y por eso mismo el número tiene que venir de algún sitio
 * defendible en vez de inventarse: es el que ya usaba el shim del build de
 * escritorio, que se sacó del cliente oficial.
 */
const CORDOVA_VERSION = '14.0.1'

export const collectNativeInfo = (): NativeInfo => {
  const isEmulator = Device.isDevice === false
  return {
    device: {
      cordova: CORDOVA_VERSION,
      platform: 'Android',
      version: Device.osVersion ?? '14',
      model: Device.modelName ?? 'Android',
      manufacturer: (Device.brand ?? Device.manufacturer ?? 'android').toLowerCase(),
      isVirtual: isEmulator,
      // el cliente real no puede leer el serial desde Android 10; el suyo
      // también responde "unknown"
      serial: 'unknown',
      uuid: (Application.getAndroidId?.() ?? 'lindo').slice(0, 16)
    },
    appVersion: Application.nativeApplicationVersion ?? '0.0.0',
    isEmulator
  }
}

/**
 * El preludio que corre antes que nada del documento.
 *
 * Tiene que ser antes: `platform.js` se instala en el primer script de la
 * página, así que cualquier cosa que quiera consultar tiene que existir ya.
 * `injectedJavaScriptBeforeContentLoaded` es la única ventana que cumple eso.
 */
export const nativePrelude = (info: NativeInfo): string => `
  window.lindoNative = ${JSON.stringify(info)};
  window.lindoNative.postMessage = function (message) {
    window.ReactNativeWebView.postMessage(JSON.stringify(message));
  };
  true;
`

/** lo que la página manda hacia aquí */
export type WebMessage = { type: 'auth:open'; url: string }

export const parseWebMessage = (raw: string): WebMessage | undefined => {
  try {
    const value = JSON.parse(raw) as WebMessage
    return value && value.type === 'auth:open' && typeof value.url === 'string' ? value : undefined
  } catch {
    return undefined
  }
}

/** lo que se devuelve, por el mismo nombre que la página dejó esperando */
export const resolveAuth = (result: { code?: string; error?: string; cancelled?: boolean }): string => `
  window.lindoNativeAuthResolve && window.lindoNativeAuthResolve(${JSON.stringify(result)});
  true;
`
