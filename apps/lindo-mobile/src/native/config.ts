/**
 * Dónde vive el cliente y con qué identidad se presenta.
 */

/**
 * El cliente, cuando viene de fuera.
 *
 * Si no está definido, el shell va empaquetado dentro del APK y lo sirve
 * `modules/shell-assets` en loopback: así el APK funciona en cualquier teléfono
 * sin depender de ningún servidor nuestro. El juego sigue necesitando internet
 * para lo suyo - el bundle de Ankama se descarga en cada arranque desde su CDN.
 *
 * `build:android --local` lo apunta al servidor de desarrollo del anfitrión.
 */
export const REMOTE_CLIENT_URL = process.env.EXPO_PUBLIC_LINDO_URL

/**
 * Lo que Cordova llama `AppendUserAgent`, que es lo que hace el cliente real.
 *
 * Leído de `res/xml/config.xml` del APK oficial. Cordova *añade* al User-Agent
 * del WebView del sistema en vez de sustituirlo, así que con esta cadena el UA
 * que sale de aquí es el mismo que sale del cliente de Ankama, marcas de WebView
 * incluidas - `; wv`, `Version/4.0` y el `Build/<id>` del dispositivo.
 */
export const CLIENT_UA_SUFFIX = 'DofusTouch Client 3.14.0'

/**
 * El User-Agent con el que se abre el login, y por qué es un iPhone.
 *
 * Google rechaza OAuth dentro de un WebView embebido (`disallowed_useragent`),
 * y el login de Ankama ofrece Google. El cliente oficial resuelve esto con
 * `InAppBrowserOverrideUserAgent` en su config.xml, apuntando a Safari de iOS;
 * esta cadena es la suya, copiada tal cual. No es un disfraz que inventemos:
 * es el que usa el cliente al que imitamos, para el mismo problema.
 */
export const AUTH_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 10_2 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/16.2 Mobile/15E148 Safari/604.1'
