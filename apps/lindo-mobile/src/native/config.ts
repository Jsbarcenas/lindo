/**
 * Dónde vive el cliente y con qué identidad se presenta.
 */

/**
 * El build web, servido a la app.
 *
 * Por defecto apunta al servidor de desarrollo del anfitrión a través de
 * `adb reverse tcp:5173 tcp:5173`, y eso no es un atajo: `localhost` es un
 * origen seguro y `10.0.2.2` no lo es. Sin contexto seguro no hay service
 * worker que sirva el shell, ni `crypto.subtle` para la multicuenta, ni
 * `navigator.userAgentData`. El despliegue real se pasa por entorno.
 */
export const CLIENT_URL = process.env.EXPO_PUBLIC_LINDO_URL ?? 'http://localhost:5173'

/** el origen del cliente: lo único que su WebView tiene permitido navegar */
export const CLIENT_ORIGIN = new URL(CLIENT_URL).origin

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
