# Plan: llevar el cliente completo a `lindo-mobile` (Expo)

Mismo ejercicio que `apps/lindo-web`, con una inversión en el centro:

> En escritorio y en web el trabajo es **fingir** que somos Android.
> Dentro de un WebView de Android ya lo somos. El trabajo pasa a ser
> **completar** un Android real hasta que sea el cliente de Dofus Touch.

No es menos trabajo. Es otro trabajo, y esta vez sí se puede ganar del todo,
porque las cabeceras HTTP —lo único que la versión web no puede tocar— aquí las
emite un Android de verdad.

Estado de partida: `apps/lindo-mobile` es un andamio de Expo SDK 57 con
expo-router y una pantalla que dice "Lindo Mobile". Nada más.

---

## La costura que ya existe

El puerto a web dejó tres enganches que sirven igual aquí, sin tocarlos:

| Enganche | Dónde | Para qué sirve en Expo |
|---|---|---|
| `window.lindoOpenWebAuth` | `GameScreen.tsx`, parche 15 de `regex.json` | El puente de login. En Expo lo atiende el lado nativo. |
| `window.lindoBrowserAuth` | `game-base/index.html` | Elige rama del login. En Expo va a **`false`** → `deepLink`, como el cliente real. |
| `packages/host-web` | 39 miembros de `LindoAPI` | Corre **tal cual** dentro del WebView. No se reescribe nada. |

Y una pieza que aquí deja de hacer falta como estaba: `game-base/platform.js`.
Ver **Fase 3**.

---

## Fase 0 · Reconocimiento — **ejecutada el 2026-08-13**

Antes de diseñar nada, medí dos cosas en el emulador que ya tienes encendido: qué
reporta un WebView de Android pelado, y qué hace realmente el APK de Dofus Touch.

### 0.1 · El WebView pelado, con nuestro propio probe

`tools/android-probe/webview-capture.sh` construye un APK mínimo con un WebView y
le mete la URL que le pases. Apuntado a `http://10.0.2.2:8420/probe`:

```
runs/010-bare-android-webview.json   PASS 15 · FAIL 12 · MISSING 12
```

**Un WebView de Android no pasa gratis.** Es Android de verdad, pero no es el
cliente de Dofus Touch. Lo que falla, y por qué:

| Señal | Observado | Causa |
|---|---|---|
| `js.cordova.globals` | 2/20 presentes | No hay Cordova. Hay que proveerlo. |
| `js.webgl` | `Android Emulator OpenGL ES Translator (Apple M4 Max)` | **El emulador filtra la GPU del anfitrión.** En un móvil real sería una Mali/Adreno de verdad. |
| `js.platform` | `Linux aarch64` | El evaluador espera `Linux armv8l`. Hay que decidir cuál es el correcto, no cuál es el nuestro. |
| `m.iframe.escape`, `m.worker.escape` | `Linux aarch64` | Arrastran lo anterior; no son manipulación. |
| `http.header.order` | lleva `x-requested-with` | **El WebView añade `X-Requested-With: <paquete>`.** Es el delator clásico de WebView. |

Dos ajustes que necesitó el instrumento y ya están hechos:

- `probe.js` deriva su `ORIGIN` de su propio `src` en vez de `127.0.0.1`
  cableado; desde el emulador, `127.0.0.1` es el emulador.
- El APK de captura declara `usesCleartextTraffic`.

> **Provisional, no concluyas de aquí:** esa corrida fue sobre `http://` en claro,
> y `navigator.userAgentData`, los client hints y parte de `Sec-Fetch-*` **no se
> emiten fuera de contexto seguro**. Por eso salen 12 `MISSING`. Antes de sacar
> ninguna conclusión sobre client hints hay que repetirla sobre `https://`
> (`tls-probe.mjs` ya levanta un listener en 8443 con certificado).

### 0.2 · El APK real, leído de verdad

Sacado de `com.ankama.dofustouch` en el emulador, `res/xml/config.xml` y
`AndroidManifest.xml`:

**a) El User-Agent del cliente real no es el que mandamos.**

```xml
<preference name="AppendUserAgent" value="DofusTouch Client 3.14.0" />
```

Cordova **añade**, no sustituye. El cliente real manda el UA del WebView del
sistema *más* ese sufijo. En este emulador eso es, literalmente:

```
Mozilla/5.0 (Linux; Android 15; sdk_gphone64_arm64 Build/AE3A.240806.036; wv) \
AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/150.0.7871.124 \
Mobile Safari/537.36 DofusTouch Client 3.14.0
```

Fíjate en `Build/…`, en **`; wv`** y en **`Version/4.0`**. Los tres son marcas de
WebView, y **ninguno aparece en el UA que fabrican hoy el escritorio y la web**,
que tiene forma de Chrome-en-Android.

Y el probe lo confirmó por accidente de la peor manera posible: `http.ua` **marcó
FAIL sobre el UA genuino**, porque `CHROME_ANDROID_UA` en
[signals/http.mjs](../../tools/android-probe/signals/http.mjs) exige Chrome
inmediatamente después de `(KHTML, like Gecko)` y el real trae `Version/4.0` en
medio. El catálogo codifica *mi suposición* de qué es un Android creíble, no lo
que emite el cliente al que queremos parecernos.

→ **Decisión pendiente para escritorio y web, fuera del alcance de este plan:**
adoptar la forma WebView (`; wv`, `Version/4.0`, `Build/<id>`) en
`android-profile.ts` y en `host-web/profile.ts`, y arreglar el evaluador. Es un
cambio a la identidad de dos builds que ya funcionan; no lo toco de tapadillo.

**b) La lista de plugins del cliente real**, que es la referencia exacta para
`js.cordova.plugins` y para lo que hay que proveer:

```
Keyboard(io.ionic.keyboard)  StatusBar  File  NetworkStatus  Notification
NavigationBar  AppAvailability  Media  WizAssetsPlugin  PowerManagement
Device  Yanap  InAppBrowser  PushNotification  Adjust  AppSettings
AppInfo  InAppBillingPlugin
```

**c) El esquema `dofustouch://` lo registra el APK real**, junto con app links
verificados de `https://dofus-touch.com/`. Si el juego oficial está instalado en
el mismo dispositivo, reclamar ese esquema provoca un diálogo de elección.

---

## La restricción dura que decide la arquitectura

Encadena tres cosas y no tiene vuelta:

1. `packages/host-web/crypto.ts` usa `crypto.subtle` → **exige contexto seguro**.
2. El shell del juego lo sirve un **service worker** desde IndexedDB → exige
   contexto seguro, y en WebView de Android **no funciona sobre `file://`**.
3. `navigator.userAgentData` y los client hints → contexto seguro.

> **El WebView tiene que cargar de `https://` o de `http://localhost`. Nunca de
> `file://`.** Todo lo demás del diseño sale de aquí.

---

## Arquitectura: tres opciones, una recomendada

| | Qué es | Coste | Veredicto |
|---|---|---|---|
| **A. WebView sobre `lindo-web`** | La app Expo es una cáscara; dentro corre el build web que ya funciona | Bajo | **Recomendada** |
| **B. UI nativa RN + WebView por cuenta** | Reescribir pestañas/opciones/multicuenta en React Native | Alto | Más tarde, y solo para el cromo |
| **C. `expo/dom` (`'use dom'`)** | SDK 57 sabe montar componentes React DOM en un WebView | Medio | **No** |

**Por qué A.** Todo lo que costó construir —host-web, el updater en el navegador,
el service worker, las iframes por cuenta, `@lindo/ui` entero— es código de
navegador que ya funciona. Meterlo en un WebView no lo cambia.

**Por qué C no.** Los componentes DOM de Expo empaquetan *tu* árbol React con
Metro y lo montan en un WebView generado. Aquí no queremos montar un componente:
queremos cargar una app entera que crea `<iframe src="/game/index.html">`, registra
un service worker y escribe en IndexedDB. Esa combinación pelea con cómo Expo
sirve los assets de un componente DOM. Es la opción idiomática para otro problema.

Dentro de A, de dónde sale la web:

- **A1 · URL remota** (tu despliegue de Railway/Vercel). Origen `https://` →
  contexto seguro gratis. Sin red no arranca. **Empieza por aquí.**
- **A2 · Empaquetada y servida en `http://localhost`** desde la app. Offline y más
  rápida, pero exige un servidor HTTP nativo (`expo-file-system` + un módulo
  como `@dr.pogodin/react-native-static-server`, con config plugin y dev build).
  Fase posterior.

---

## Fase 1 · La cáscara

```bash
npx expo install react-native-webview expo-screen-orientation expo-keep-awake
```

SDK 57 fija **`react-native-webview@13.16.1`** (no la 14; `expo install` resuelve
la correcta). Con `newArchEnabled: true` la 13.16 va por la capa de interop:
**verificar en el primer arranque**, es el riesgo técnico nº1 del plan.

Sustituir `src/app/index.tsx` por un WebView a pantalla completa. Props que no son
opcionales, y por qué:

| Prop | Valor | Motivo |
|---|---|---|
| `applicationNameForUserAgent` | `"DofusTouch Client 3.14.0"` | **El equivalente exacto de `AppendUserAgent`.** Con esta prop el UA sale idéntico byte a byte al del cliente real. Una prop, la señal más importante. |
| `setSupportMultipleWindows` | `false` | Sin esto `window.open` no llega a `onShouldStartLoadWithRequest` y el login no se puede interceptar. |
| `onShouldStartLoadWithRequest` | ver Fase 4 | Es donde se ve la URL del redirect. |
| `javaScriptEnabled`, `domStorageEnabled` | `true` | IndexedDB y localStorage. |
| `mediaPlaybackRequiresUserAction` | `false` | El audio del juego arranca solo. |
| `allowsInlineMediaPlayback` | `true` | iOS. |
| `androidLayerType` | `"hardware"` | Canvas/WebGL del juego. |
| `originWhitelist` | `['https://*', 'http://localhost*']` | La restricción dura, escrita. |

Más: `expo-keep-awake` mientras haya sesión, `expo-screen-orientation` a
landscape, y botón atrás de Android → `goBack()` del WebView en vez de cerrar.

**Aceptación:** el juego carga en el emulador, el updater baja y parchea el bundle,
y se ve la pantalla de login. Sin entrar todavía.

---

## Fase 2 · La superficie Cordova, esta vez verdadera

Hoy `game-base/index.html` inventa `window.device` desde un perfil sintético.
Dentro de la app eso es innecesario y peor: hay una fuente real.

```bash
npx expo install expo-device expo-application
```

`Device.modelName`, `Device.brand`, `Device.osVersion`, `Device.isDevice` y
`Application.nativeApplicationVersion` se inyectan con `injectedJavaScriptBeforeContentLoaded`
—se ejecuta antes que nada del documento, que es justo la ventana que necesita
`platform.js`— dejando `window.lindoNativeDevice = {…}`.

`index.html` usa ese objeto si existe y su perfil sintético si no. Un solo camino
de código, dos orígenes de datos.

La lista de plugins a exponer es la de la Fase 0.2b, **no la que tenemos**. Sigue
en pie la regla que ya nos mordió dos veces: cada global que instalemos debe tener
**cero apariciones** en el bundle desplegado, y `check-game-base.mjs` lo verifica.

**Aceptación:** `js.device`, `js.device.identifier` y `js.cordova.*` en PASS con
valores del hardware real, y `window.device.model` coincidiendo con el UA.

---

## Fase 3 · Identidad: qué apagar y qué encender

Aquí es donde el plan se invierte. Sobre Android real, `platform.js` **estorba**:
reemplazaría valores auténticos por los de un SM-A546B inventado, y ese perfil
contradiría las cabeceras reales del dispositivo. Es exactamente la incoherencia
que acabamos de quitar de la versión web.

Añadir a `install(win, profile, options)` un modo `nativeAndroid`:

| Bloque | En Expo |
|---|---|
| `userAgent`, `appVersion` | **fuera** — la guarda `/Android/` ya lo hace sola |
| `platform`, `vendor`, `hardwareConcurrency`, `deviceMemory` | **fuera** — el hardware ya responde |
| `userAgentData` y alta entropía | **fuera** — el WebView emite los suyos |
| `maxTouchPoints`, media queries | **fuera** — es una pantalla táctil de verdad |
| Superficie Cordova (`window.device`, plugins) | **dentro**, con datos reales (Fase 2) |
| Antimanipulación (`toString`, iframe, worker) | **dentro** — sigue habiendo overrides que ocultar, aunque sean menos |
| WebGL `UNMASKED_RENDERER` | **solo en emulador** — ver abajo |

El WebGL es el único matiz: en un móvil real la GPU es auténtica y no hay que
tocarla; en tu emulador filtra `Apple M4 Max`, que es peor que cualquier cosa que
pudiéramos inventar. Atarlo a `Device.isDevice`: dispositivo real → no tocar;
emulador → sustituir por la GPU que corresponda al modelo declarado.

**Aceptación:** el probe dentro del frame del juego no reporta ningún `m.*` en
FAIL y ninguna señal `D` inventada donde había una real.

---

## Fase 4 · El login, que aquí sí se puede cerrar

El premio gordo. En web el `code` aterriza en un dominio de Ankama que no podemos
leer, y por eso hay que copiar la URL. **En la app no.** Dos rutas, en este orden:

**4.1 · Deep link, como el cliente real.** Poner `lindoBrowserAuth = false` para
que el parche use `$3.deepLink`, registrar el esquema en `app.json`
(`"scheme": ["lindo", "dofustouch"]`) y abrir el login con
`WebBrowser.openAuthSessionAsync(url, 'dofustouch://authorized')`. Al volver, el
puente inyecta:

```js
window.lindoWebAuth.connectThroughIonicDeepLink({ code })
```

Es literalmente el flujo del escritorio, con `openAuthSessionAsync` donde Electron
pone su ventana.

- **Riesgo medido:** el APK oficial registra ese mismo esquema (Fase 0.2c). Con el
  juego instalado al lado, Android muestra un selector. En un dispositivo limpio,
  no.

**4.2 · Si 4.1 estorba: WebView de login propio.** Abrir el login en un segundo
WebView nuestro en vez de en Custom Tabs. `onNavigationStateChange` **ve la URL de
cada navegación**, incluida `dt-proxy-…/?code=`. Sin esquema, sin conflicto, sin
portapapeles. A verificar: que el `challenge.js` de Ankama no rechace un WebView —
ya sabemos que rechaza una iframe.

En ambos casos el pegado del portapapeles de `web-auth.ts` **no se usa**, y no hay
que borrarlo: es la ruta del navegador y sigue siendo correcta allí.

**Aceptación:** entrar con la cuenta de Google sin copiar nada.

---

## Fase 5 · Verificación, con el instrumento que ya existe

Todo lo anterior se mide, no se supone. `injectedJavaScript` mete el probe en el
frame del juego dentro del WebView, igual que lo inyectamos en el frame de web:

```js
var f = document.querySelector('iframe[id^="iframe-game-"]')
var s = f.contentDocument.createElement('script')
s.src = 'http://10.0.2.2:8420/probe.js'
f.contentDocument.head.appendChild(s)
```

`10.0.2.2` es el anfitrión desde el emulador, y `probe.js` ya deriva de ahí a dónde
reportar (Fase 0.1).

Objetivo, y es alcanzable de verdad porque las cabeceras ya son de Android:
**la capa HTTP en PASS**, que es exactamente lo que la versión web no puede lograr.

Corridas a guardar en `tools/android-probe/runs/`:

- `0NN-expo-webview-baseline` — antes de las fases 2 y 3
- `0NN-expo-webview-final` — después
- y repetir **sobre https** la de la Fase 0.1, para cerrar lo provisional

Antes hay que resolver dos cosas del catálogo, o los números mentirán:
`http.ua` rechaza el UA genuino, y `js.platform` exige `armv8l` donde Android
moderno de 64 bits dice `aarch64`. **Arreglarlas contra el cliente real, no contra
lo que nos convenga.**

---

## Fase 6 · Empaquetado

**Expo Go no sirve**: esquema propio y `react-native-webview` piden build de
desarrollo. `npx expo run:android` sobre el emulador para iterar; EAS o APK local
para instalar en el móvil.

El paquete es `com.lindo.mobile`, y eso viaja en `X-Requested-With` en cada
petición del WebView (Fase 0.1). Tres salidas, por orden de honestidad:

1. Asumirlo. Es un delator de "esto es un WebView de una app que no es Dofus
   Touch", pero solo lo ve quien mire esa cabecera.
2. Quitarlo o reescribirlo en nuestro proxy, para las peticiones que pasen por él.
3. Llamar al paquete `com.ankama.dofustouch`. **No**: choca con el juego oficial
   —no pueden coexistir— y suplantar el identificador de otra app es otra cosa
   distinta de hacer que tu cliente se vea como el suyo.

---

## Lo que no sobrevive

| | Por qué |
|---|---|
| **Atajos de teclado** | `packages/host-web/hotkeys.ts` sigue vivo, pero no hay teclado. Hace falta UI táctil para lo que hoy es una tecla. |
| **Multicuenta de verdad** | Cada cuenta es una instancia entera del juego en una iframe. En un móvil, una o dos. No es un límite de diseño: es RAM. |
| **La maquetación de `@lindo/ui`** | Está pensada para una ventana de escritorio. Funciona, pero apretada. Es lo que arregla la opción B. |
| **Barra de título y ventanas** | Ya se perdieron en web. |

---

## Orden recomendado y esfuerzo

| # | Fase | Esfuerzo | Desbloquea |
|---|---|---|---|
| 1 | Cáscara WebView contra la URL desplegada (A1) | **S** | Ver el juego correr |
| 2 | Login (4.1, con 4.2 de reserva) | **M** | Jugar |
| 3 | Superficie Cordova real | **M** | Fase 5 |
| 4 | Modo `nativeAndroid` en `platform.js` | **S** | Fase 5 |
| 5 | Verificación con el probe | **S** | La respuesta |
| 6 | Servir en local (A2) | **L** | Offline |
| 7 | Cromo nativo (B) | **XL** | Que se use cómodo |

Los pasos 1 y 2 ya dan una app jugable. Del 3 al 5 es donde se gana lo que en web
era imposible.

---

## Decisiones abiertas — tuyas, no mías

1. **¿Adoptamos la forma WebView del UA (`; wv`, `Version/4.0`) también en
   escritorio y web?** Es lo que manda el cliente real. Cambia la identidad de dos
   builds que ya funcionan.
2. **¿`X-Requested-With`: asumir, o reescribir en el proxy?**
3. **¿A1 (remoto) para siempre, o A2 (local) más adelante?** A2 quita la
   dependencia de red y de tu hosting, y cuesta un módulo nativo.
4. **¿Móvil real o solo emulador?** Cambia la Fase 3: en un móvil real la GPU no
   se toca; en el emulador hay que taparla.
