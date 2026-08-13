# Plan: probe de plataforma local + ciclo de corrección

Objetivo: sustituir el servidor de validación del VPS por un probe local, usarlo
para encontrar por dónde se delata el cliente como no-Android, corregirlo del
lado del cliente y volver a medir, hasta que no queden fallos corregibles.

Este documento está escrito para ejecutarse de principio a fin sin más contexto
que el repositorio. Cada fase tiene criterio de aceptación explícito.

---

## Principio rector

> Un validador no comprueba una señal. Comprueba que **concuerden**, y comprueba
> si alguna **parece manipulada**.

De ahí que haya tres familias de fallo, y hay que medirlas por separado porque se
arreglan de formas distintas:

| Familia | Qué es | Ejemplo |
|---|---|---|
| **D — Delación directa** | Una señal dice macOS/desktop | `navigator.userAgentData.platform === "macOS"` |
| **C — Incoherencia** | Dos señales falseadas no cuadran entre sí | UA dice `Pixel 8`, WebGL dice `Adreno 740` (el Pixel 8 lleva Mali) |
| **M — Manipulación visible** | La señal es correcta pero se nota parcheada | `getParameter.toString()` no devuelve `[native code]` |

La familia **M** es la que hoy está sin cubrir por completo, y es la más fácil de
comprobar para un validador. Priorizar en consecuencia.

---

## Fase 0 · Andamiaje

Crear `tools/android-probe/` con:

```
tools/android-probe/
├── PLAN.md            este documento
├── server.mjs         probe server (Node, sin dependencias externas)
├── probe.js           el payload que se ejecuta en el contexto a auditar
├── signals/
│   ├── http.mjs       evaluadores de capa HTTP (lado servidor)
│   ├── js.mjs         evaluadores de capa JS (lado servidor, sobre lo recogido)
│   └── coherence.mjs  cruces entre señales
├── runs/              un JSON por ejecución, commiteado para poder diferenciar
└── report.mjs         imprime un run y diffea contra el anterior
```

`server.mjs` debe:

1. Escuchar en `127.0.0.1:8420`.
2. Servir `GET /probe` → HTML que carga `probe.js`.
3. Responder con `Accept-CH: Sec-CH-UA-Model, Sec-CH-UA-Platform-Version,
   Sec-CH-UA-Arch, Sec-CH-UA-Bitness, Sec-CH-UA-Full-Version-List` y
   `Critical-CH` con lo mismo — **esto es esencial**: los client hints de alta
   entropía no se mandan hasta que el servidor los pide, y la segunda petición
   es la que hay que auditar.
4. Registrar de cada petición: cabeceras **en orden de llegada** (no como objeto,
   el orden importa), versión HTTP, y ALPN.
5. `POST /collect` → recibe el JSON de `probe.js`, lo une a la evidencia HTTP,
   lo evalúa y escribe `runs/<timestamp>.json`.

**Aceptación fase 0:** `node tools/android-probe/server.mjs` levanta y
`curl -s localhost:8420/probe` devuelve el HTML.

---

## Fase 1 · Catálogo de señales

Implementar los evaluadores. Cada uno devuelve
`{ id, layer, family, verdict: 'PASS'|'FAIL'|'MISSING', observed, expected, fixable }`.

`fixable` es `'client'`, `'network'` o `'no'` — determina si entra en el ciclo de
corrección o va directo al informe final.

### L1 · HTTP (se miden sin ejecutar JS)

| id | Qué comprueba |
|---|---|
| `http.ua` | El UA parsea como Chrome sobre Android (usar la misma lógica que UAParser 0.7.20, que es la que corre en el bundle) |
| `http.ch.platform` | `Sec-CH-UA-Platform: "Android"` presente |
| `http.ch.mobile` | `Sec-CH-UA-Mobile: ?1` |
| `http.ch.brands` | La lista de marcas incluye una entrada GREASE y su versión concuerda con el Chrome del UA |
| `http.ch.highentropy` | Tras `Accept-CH`, llegan `Sec-CH-UA-Model` / `-Platform-Version` / `-Arch` / `-Bitness` |
| `http.ch.arch` | `Sec-CH-UA-Arch: "arm"` (un Mac reporta `"arm"` también — comprobar `-Bitness: "64"` y modelo juntos) |
| `http.header.order` | El orden de cabeceras coincide con el de Chrome Android, no con el de Chrome desktop |
| `http.accept.lang` | `Accept-Language` coherente con el idioma del cliente |
| `http.sec.fetch` | `Sec-Fetch-*` presentes (borrarlas es en sí mismo anómalo) |

### L2 · JS — delación directa (familia D)

| id | Qué comprueba |
|---|---|
| `js.uad.platform` | `navigator.userAgentData.platform` |
| `js.uad.highentropy` | `getHighEntropyValues()` devuelve platform/model/platformVersion coherentes |
| `js.platform` | `navigator.platform === "Linux armv8l"` |
| `js.vendor` | `navigator.vendor === "Google Inc."` |
| `js.touch` | `maxTouchPoints >= 1`, `'ontouchstart' in window`, `TouchEvent` definido |
| `js.plugins` | `navigator.plugins.length === 0` (desktop trae el visor de PDF) |
| `js.webdriver` | `navigator.webdriver === false` |
| `js.device` | `window.device.platform === "Android"` y el resto del objeto Cordova completo |
| `js.webgl` | `UNMASKED_VENDOR/RENDERER` en **WebGL1 y WebGL2** |
| `js.webgpu` | `navigator.gpu.requestAdapter()` → `info.vendor` (delata Apple; probablemente sin cubrir hoy) |
| `js.voices` | `speechSynthesis.getVoices()` — las voces de macOS (Alex, Samantha) son delación inmediata |
| `js.fonts` | Presencia de fuentes solo-macOS (SF Pro, Helvetica Neue) vs Android (Roboto, Noto) |
| `js.media` | `MediaSource.isTypeSupported` para códecs que difieren entre Android y macOS |
| `js.mq` | Media queries `(pointer: coarse)`, `(hover: none)` |
| `js.battery` | `navigator.getBattery` presente |
| `js.perfmemory` | `performance.memory` — existe en Chrome desktop, no en todos los Android |
| `js.tz` | `Intl.DateTimeFormat().resolvedOptions().timeZone` vs lo esperable |

### L3 · JS — manipulación visible (familia M) — **prioridad alta**

| id | Qué comprueba |
|---|---|
| `m.descriptor.navigator` | `Object.getOwnPropertyDescriptor(navigator, 'platform')` — en un Chrome real **no hay propiedad propia**, el getter vive en `Navigator.prototype` |
| `m.tostring.getparameter` | `WebGLRenderingContext.prototype.getParameter.toString()` debe ser `function getParameter() { [native code] }` |
| `m.tostring.generic` | Igual para todo lo que se haya envuelto |
| `m.uad.proto` | `navigator.userAgentData instanceof NavigatorUAData` y `Object.getPrototypeOf` correcto |
| `m.uad.class` | `Object.prototype.toString.call(navigator.userAgentData)` → `[object NavigatorUAData]` |
| `m.device.shape` | `window.device` con las propiedades exactas del plugin real, no un objeto literal suelto |
| `m.iframe.escape` | Crear un `<iframe>` limpio y leer `iframe.contentWindow.navigator.platform` — **si los overrides se aplicaron solo al window actual, el iframe nuevo devuelve el valor real** |
| `m.worker.escape` | Igual con un `Worker` / `OffscreenCanvas`: los workers tienen su propio scope y no ven los parches del hilo principal |
| `m.stack` | Formato de stack de errores y rutas de fichero (`file://`, `app.asar`) |

> `m.iframe.escape` y `m.worker.escape` son las dos comprobaciones que más
> probablemente rompan la implementación actual. Diseñar el arreglo contando con
> ellas desde el principio, no como parche posterior.

### L4 · Red (medir, no necesariamente corregir)

| id | Qué comprueba |
|---|---|
| `net.tls.ja4` | Huella del ClientHello: orden de cipher suites, extensiones, curvas |
| `net.h2.settings` | Frame SETTINGS de HTTP/2 y orden de pseudo-cabeceras |
| `net.tcp` | Ventana inicial y TTL |

Estas **no** son corregibles desde JS ni desde Electron. Marcar `fixable: 'network'`
y dejarlas fuera del ciclo; van al informe final como limitación estructural.
Corregirlas exigiría enrutar el tráfico por un proxy con `utls` o similar, que es
un proyecto aparte.

#### Medido (2026-08-13) con `tls-probe.mjs`

Servidor TCP crudo que lee el ClientHello y lo huella sin necesitar certificado.

**JA3 no sirve.** Dos conexiones del mismo Chrome dieron dos JA3 distintos:
Chrome baraja el orden de extensiones desde la v110, y JA3 lo incluye sin
ordenar. JA4 sí es estable — idéntico en las 20+ capturas del mismo cliente.

| Cliente | JA4 |
|---|---|
| Chrome **149** / Android | `t13i1515h2_8daaf6152771_d8a2da3f94cd` |
| **WebView 150** / Android | `t13i1515h2_8daaf6152771_806a8c22fdea` |
| Chromium **150** / Electron (Lindo) | `t13i1515h2_8daaf6152771_806a8c22fdea` |

**El WebView de Android y el Electron de Lindo dan la misma huella, exacta.**

La diferencia que aparecía contra Chrome 149 —tres algoritmos de firma extra al
principio, `0x0904`, `0x0905`, `0x0906`— era **de versión, no de plataforma**:
Chromium 150 los manda en las dos, y Chrome 149 en ninguna. Importa que sea el
WebView y no Chrome porque el cliente real de Dofus Touch es una app Cordova, o
sea un WebView.

Conclusión: **en la capa TLS este cliente es indistinguible del oficial** cuando
corren la misma línea de Chromium. No hay nada que arreglar aquí, y sería inútil
intentarlo — no se puede parecer más que "idéntico".

Lo que sí hay que vigilar es la **deriva de versión**. Si Electron se queda atrás
o se adelanta respecto al WebView que Google despliega, la huella se separa sola.
Eso ya no es una incoherencia interna que se pueda corregir en el cliente, es una
consecuencia de qué Chromium empaqueta Electron.

Reproducir la captura del WebView: `tools/android-probe/webview-capture.sh`,
que construye e instala un APK mínimo (una sola actividad con un WebView) usando
solo el SDK de Android.

#### Nota sobre JA3

31 capturas del mismo Chrome dieron **31 JA3 distintos** y **un solo JA4**. No
usar JA3 para nada aquí: Chrome baraja el orden de extensiones desde la v110 y
JA3 las hashea sin ordenar, así que cambia en cada conexión.

**Aceptación fase 1:** cada evaluador tiene un test unitario con una entrada
sintética de Android real (PASS) y una de Chrome/macOS (FAIL).

---

## Fase 2 · Captura base

1. `node tools/android-probe/server.mjs` en segundo plano.
2. Arrancar Lindo (`pnpm dev`) y entrar hasta tener el juego cargado.
3. Abrir DevTools de la ventana del juego y pegar esto **en el contexto por
   defecto (`top`)** — el snippet localiza la iframe él solo, así que no hay que
   tocar el selector de contexto:

   ```js
   (function(){var f=document.querySelector('iframe[id^="iframe-game-"]');
   if(!f){return console.error('no hay iframe de juego: abre una pestana y entra a un personaje');}
   var d=f.contentDocument||(f.contentWindow&&f.contentWindow.document);
   if(!d){return console.error('iframe inaccesible: webSecurity ya no esta desactivado en game-window.ts');}
   var s=d.createElement('script');s.src='http://127.0.0.1:8420/probe.js';
   d.head.appendChild(s);console.log('probe inyectado en',f.id);})()
   ```

   El renderer y la iframe están en orígenes distintos (`127.0.0.1:7777` y
   `localhost:3000`); esto solo funciona porque `game-window.ts` arranca con
   `webSecurity: false`.

   Inyectar, no navegar. Cargar `http://127.0.0.1:8420/probe` como página abre un
   documento nuevo donde los overrides de `game-base/index.html` nunca se
   aplicaron: el informe sale limpio y no significa nada.

   El probe registra dónde se ejecutó, y el servidor marca el run como
   `trusted: false` si no vino del documento del juego. Un run no fiable no se
   usa para nada: se repite.
4. El resultado se imprime en la consola y queda en `runs/`. Renombrarlo a
   `000-baseline.json`.

**Aceptación fase 2:** existe `runs/000-baseline.json` con veredicto para las
señales del catálogo y ningún `MISSING` por fallo del arnés (un `MISSING`
legítimo, porque la API no existe, sí vale).

---

## Fase 3 · Ciclo de corrección

Repetir hasta el criterio de salida:

1. **Ordenar** los `FAIL` con `fixable: 'client'` por familia: primero **M**,
   luego **D**, luego **C**. Dentro de cada familia, primero lo que rompa más
   señales a la vez.
2. **Corregir uno** (o un grupo que comparta causa raíz).
3. `pnpm lint && pnpm smoke` — **si smoke falla, revertir**. Ninguna corrección
   vale romper el arranque del juego.
4. **Volver a medir** → `runs/NNN-<que-se-arreglo>.json`.
5. `node tools/android-probe/report.mjs --diff` — confirmar que el fallo pasó a
   PASS y que **no ha caído ninguna señal que antes pasaba**. Las regresiones
   aquí son fáciles: casi toda corrección de la familia M toca cómo se aplican
   las de la familia D.
6. Commit por corrección, con el id de la señal en el mensaje.

### Correcciones ya previstas

Estas salen del análisis hecho antes de escribir el plan; confirmarlas contra el
baseline antes de aplicarlas.

- **`m.descriptor.*` y `m.tostring.*`** → dejar de usar
  `Object.defineProperty(navigator, ...)` sobre la instancia. Definir sobre
  `Navigator.prototype` / `Object.getPrototypeOf(navigator)`, y envolver todo lo
  que se parchee con un `Proxy` cuyo `get` de `toString` devuelva la cadena
  nativa. Un helper único, `nativeDefine(target, prop, value)`, en vez del
  `defineGetter` actual de `game-base/index.html`.
- **`m.iframe.escape`** → los overrides tienen que reaplicarse a cada `iframe`
  que cree el juego. Interceptar `HTMLIFrameElement` / observar el DOM y
  reinyectar, o aplicarlos desde el preload de Electron con
  `webFrame.executeJavaScript` en cada frame nuevo, que es más limpio.
- **`m.worker.escape`** → parchear el scope de los workers exige interceptar
  `Worker`/`importScripts`. Evaluar coste: si el bundle de Ankama no usa workers,
  basta con dejarlo documentado como fallo conocido.
- **`js.webgpu`** → añadir `navigator.gpu` al bloque de overrides, o eliminarlo
  (un Android viejo puede no tenerlo, y `MISSING` es más creíble que incoherente).
- **`js.voices`** → `speechSynthesis.getVoices()` filtrado a voces de Android.
- **`http.header.order`** → probablemente no ajustable desde
  `onBeforeSendHeaders`, que reescribe valores, no orden. Verificar; si no se
  puede, reclasificar como `fixable: 'network'`.
- **Coherencia GPU↔modelo** — ya cubierta por `DEVICES` en
  `apps/desktop/src/main/utils/android-profile.ts`, pero el probe debe
  verificarlo, no darlo por hecho.
- **`appVersion` desde iTunes** ([constants/index.ts](../../apps/desktop/src/main/constants/index.ts))
  → el cliente declara `client: "android"` y manda la versión de la build de iOS.
  Sustituir por la versión de la build de Android, o por un valor fijo coherente.

### Criterio de salida

El ciclo termina cuando se cumplen las dos:

- No queda ningún `FAIL` con `fixable: 'client'`.
- Dos iteraciones seguidas sin que aparezcan señales nuevas en `FAIL`.

Tope duro: **8 iteraciones**. Si al llegar quedan fallos, parar y reportar; seguir
iterando a ciegas suele significar que la señal restante no es corregible por la
vía que se está intentando.

---

## Fase 4 · Informe

`node tools/android-probe/report.mjs --final` produce:

1. Tabla de señales con veredicto inicial → final.
2. Lista de correcciones aplicadas, con el commit de cada una.
3. **Lo que queda sin cubrir**, separando lo que es limitación estructural
   (capa TLS/HTTP2) de lo que se decidió no arreglar y por qué.
4. Los `MISSING` que son legítimos, para que no se relean como fallos.

**Aceptación fase 4:** el informe permite responder, señal a señal, por qué el
cliente pasa o no pasa — sin volver a leer el código.

---

## Guardarraíles

- **El juego manda.** `pnpm smoke` después de cada corrección; si rompe, se
  revierte. Un cliente indetectable que no arranca no sirve de nada.
- **`SPOOF_SCREEN_METRICS` sigue en `false`** salvo que el probe demuestre que
  alguien mira `screen.*`. Activarlo rompe el layout del juego.
- **Un commit por señal corregida**, para poder bisecar cuando algo regrese.
- **Todo local.** El probe escucha en `127.0.0.1` y no sale de la máquina.
- **No tocar la capa de red** dentro de este plan. Si el informe concluye que ahí
  está el fallo restante, eso es otro proyecto y se decide aparte.
