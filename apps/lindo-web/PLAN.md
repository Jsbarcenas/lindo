# Plan: llevar el cliente completo a `lindo-web`

Objetivo: que la app React + Vite corra el cliente entero, sin perder
funcionalidad ni comodidad, y desplegable en Vercel o Netlify. Funcionar en local
primero es suficiente.

---

## La costura ya existe

Casi todo el cliente es agnóstico de Electron. `@lindo/ui`, `@lindo/mods`,
`@lindo/shared`, `@lindo/client-store` y `@lindo/dofus-window` no importan nada
de `electron`: hablan con la plataforma **solo** a través de `window.lindoAPI`.

Eso está dicho explícitamente en
[`packages/shared/types/window.ts`](../../packages/shared/types/window.ts):

> *Declaring it says nothing about who provides it: Electron does it from the
> preload over contextBridge, and any other host would have to supply its own.*

Así que el trabajo **no** es reescribir el cliente. Es escribir una segunda
implementación de `LindoAPI` — **39 miembros** — y una tubería que sirva el juego.

```
          ┌──────────── @lindo/ui · mods · client-store · shared ────────────┐
          │                    (sin cambios, ya son agnósticos)              │
          └───────────────────────────┬─────────────────────────────────────┘
                                      │ window.lindoAPI
                    ┌─────────────────┴─────────────────┐
                    │                                   │
        apps/desktop/src/preload            packages/host-web  ← lo nuevo
        (Electron, contextBridge)           (navegador)
```

---

## Fase 0 · Reconocimiento — **decide todo lo demás**

**No empezar a portar sin esto.** Hay una incógnita que puede cambiar el plan
entero: a qué habla el juego en runtime y si le importa desde dónde.

El bundle usa **Primus**, o sea WebSocket. El host no está en el bundle: sale de
`window.Config` en tiempo de ejecución. Hay que medirlo, no deducirlo.

1. Con Lindo abierto y sesión iniciada, DevTools → Network, filtro WS y Fetch/XHR.
2. Anotar: hosts, si hay `Origin` en el handshake, si hay cookies, si se usan
   cabeceras que un navegador no deja fijar.
3. Probar desde una pestaña normal del navegador (mismo Chromium, otro origen)
   una conexión al endpoint Primus y ver si el servidor la acepta.

### Resultado (2026-08-13) — **no hace falta proxy**

Medido, no supuesto. Todas las pruebas con `Origin: https://lindo-web.up.railway.app`:

| Superficie | Respuesta |
|---|---|
| `GET {proxy}/config.json?lang=es` | `200` · `access-control-allow-origin: *` |
| CDN de assets (`dofustouch.cdn.ankama.com`) | `access-control-allow-origin: *` |
| haapi (`haapi.ankama.com`) | refleja el origen · `allow-credentials: true` |
| **`wss://{proxy}/primus`** | **`101 Switching Protocols`** |

**Ankama no valida el origen en ninguna de las cuatro.** El navegador puede
hablar directo con sus servidores: no hace falta proxy, ni WebSocket ni HTTP.
Railway solo tiene que servir ficheros estáticos.

Cómo se localizó el host, por si cambia: el cliente lo construye en
`build/script.js` como

```js
var server = (window.appInfo || {}).server || "https://dt-proxy-production-login.ankama-games.com"
loadJson(server + "/config.json?lang=" + lang)   // -> window.Config
```

De ahí salen `dataUrl` (el mismo host, donde vive `/primus`), `assetsUrl` y
`uiUrl` (CDN), y `haapi`.

> **Hallazgo útil:** `window.appInfo.server` es un override **oficial** del
> cliente. Apuntar el juego a otro backend no necesita parche regex: basta con
> definir ese campo, y `game-base/index.html` ya construye `window.appInfo`.

**Aceptación fase 0: cumplida.**

---

## Fase 1 · `packages/host-web`

Implementar `LindoAPI` sobre primitivas de navegador. Miembro a miembro:

### Estado y sincronización (5)

| Miembro | Implementación web |
|---|---|
| `fetchInitialStateAsync` | leer el snapshot de IndexedDB |
| `forwardPatchToMain` | `BroadcastChannel.postMessage(patch)` |
| `subscribeToIPCPatch` | `BroadcastChannel.onmessage` |
| `resetStore` | borrar el almacén y recargar |
| `fetchGameContext` | construir el contexto desde `location` |

`BroadcastChannel` sustituye al relé de patches del proceso main y **encaja
mejor**: sincroniza pestañas del navegador igual que Electron sincronizaba
ventanas. La deduplicación por `object-hash` que ya hay en
[`client-store/root-store/setup-root-store.ts`](../../packages/client-store/root-store/setup-root-store.ts)
sirve tal cual.

Persistencia: IndexedDB, no `localStorage` — el snapshot del rootStore crece y
`localStorage` es síncrono y tiene 5 MB.

### Pestañas y ventanas (8)

`subscribeToNewTab`, `subscribeToSelectTab`, `subscribeToNextTab`,
`subscribeToPrevTab`, `subscribeToCloseTab`, `focusCurrentWindow`,
`setAudioMuteWindow`, `appReadyToShow`.

En Electron esto venía de `before-input-event` en el proceso main. En web es un
listener `keydown` en `document` reusando `matchesAccelerator` de
[`packages/shared/utils/hotkey.ts`](../../packages/shared/utils/hotkey.ts), que ya
es código puro.

**Pérdida real:** el navegador se reserva `Cmd/Ctrl+W`, `Cmd+N`, `Cmd+T`. Esos
atajos **no se pueden capturar**. Hay que reasignarlos por defecto en web (p. ej.
`Alt+1..9` para pestañas) y avisarlo en Opciones.

### Opciones y multicuenta (9)

`openOptionWindow` / `closeOptionWindow` dejan de abrir una ventana y pasan a ser
una **ruta** (`/options`) o un diálogo. `packages/ui` ya usa `react-router-dom`,
así que es cambiar el destino, no la pantalla.

La multicuenta es la parte delicada:

| Miembro | Web |
|---|---|
| `saveMasterPassword` / `changeMasterPassword` | `argon2-browser` (WASM) |
| `encryptCharacterPassword` / `decryptCharacterPassword` | Web Crypto AES-GCM |
| `unlockApplication`, `isMasterPasswordConfigured` | IndexedDB |
| `closeUnlockWindow`, `selectTeamToConnect` | estado de React |

> **Degradación de seguridad, explícita:** en Electron el hash de la contraseña
> maestra va envuelto en `safeStorage`, que lo cifra con el llavero del sistema.
> **En navegador no hay equivalente.** El estado cifrado queda protegido solo por
> la contraseña maestra, y cualquier XSS en el origen puede leer IndexedDB. Si
> esto no es aceptable, la multicuenta no debería habilitarse en la build web.

### Utilidades (9)

`logger` (4 niveles) → consola + buffer circular en memoria, descargable.
`saveCharacterImage` → IndexedDB en vez de disco; `characterImagesSrc` pasa a ser
un blob URL. `updateTitle` → `document.title`. `height` del titlebar → `0`.
`clearCache` → borrar caches + IndexedDB. `resetGameData` → borrar el almacén.
`fetchGameInfo`, `subscribeToUpdateProgress`, `sendAutoGroupPathInstruction` y
`subscribeToAutoGroupPathInstruction` → `BroadcastChannel`.

### `openWebAuth` — **bloqueante conocido**

En Electron, [`openWebAuthWindow`](../../apps/desktop/src/main/windows/auth-window.ts)
abre `auth.ankama.com` y **intercepta la navegación** al esquema
`dofustouch://authorized` para sacar el `code`.

Un navegador **no puede interceptar una navegación a un esquema propio** en una
ventana de otro origen. Opciones, por orden de preferencia:

1. **Login clásico** (cuenta + contraseña) por `gui.loginScreen._login`, que es
   justo lo que ya usa la multicuenta en
   [`use-game-manager.ts`](../../packages/ui/screens/main-screen/game-screen/use-game-manager.ts).
   Probablemente cubre el 100% del uso real de este cliente.
2. Popup a `auth.ankama.com` con un `redirect_uri` propio — **requiere que Ankama
   lo tenga registrado**, así que casi seguro no.
3. Dejar el login social/web fuera de la build web y decirlo en la UI.

**Recomendación:** ir por la 1 y documentar que en web no hay login social.

---

## Fase 2 · Tubería del juego en tiempo de build — **hecha**

Implementada en [`scripts/fetch-game.mjs`](scripts/fetch-game.mjs), enganchada a
`dev` y `build`. Descarga `build/script.js` y `build/styles-native.css`, aplica
`regex.json` y copia los ficheros de `game-base` a `public/game/`.

**Los assets no se descargan**: el cliente los pide a `Config.assetsUrl`, que es
el CDN de Ankama y responde con CORS abierto. Solo hay que servir la cáscara,
porque es la que lleva los parches.

Verificado de punta a punta el 2026-08-13: con `pnpm --filter lindo-web dev`, el
cliente **arranca y pinta la pantalla de login en una pestaña normal**, con los
assets viniendo del CDN y mostrando `Client v3.14.0/Build v1.73.8`. Los cuatro
parches críticos (`client:"android"`, `window.singletons`, `lindoWebAuth`,
`CharacterDisplay`) aplican sobre el bundle servido.

El árbol resultante pesa ~9 MB y está en `.gitignore`: es reproducible.

Un aviso conocido y benigno: el parche `cdvfile://` sobre `styles-native.css` no
encuentra nada. Reescribía rutas de assets de Cordova, y en web los assets vienen
del CDN, así que no aplica.

### Detalle original

El actualizador de Electron descarga de Ankama y parchea con `regex.json`. Un
navegador **no puede hacer eso**: no hay CORS desde los orígenes de Ankama.

La solución que además simplifica el despliegue: **hacerlo en el build**.

```
scripts/fetch-game.mjs   (Node, reutiliza @lindo/updater-core tal cual)
  ├── resolver origin, bajar manifests, calcular diff
  ├── aplicar regex.json  ← el parche client:"android" incluido
  └── escribir en apps/lindo-web/public/game/
```

Es el mismo código de
[`game-updater.ts`](../../apps/desktop/src/main/updater/game-updater.ts) sin la
parte de `UpdaterWindow`. Extraer esa lógica a `@lindo/updater-core` beneficia a
las dos apps.

Dos consecuencias buenas:

- **La iframe pasa a ser del mismo origen.** Desaparece la necesidad de
  `webSecurity: false`: `iframe.contentWindow` es accesible porque el juego se
  sirve desde el propio dominio. Los mods siguen funcionando sin tocar nada.
- El despliegue es estático.

Una mala: **tamaño**. `build/script.js` pesa ~7,9 MB y los assets bastante más.
Comprobar los límites del plan de Vercel/Netlify antes de confiar en esto; si no
cabe, los assets van a un bucket/CDN aparte y solo el HTML/JS al hosting.

---

## Fase 3 · La cáscara React

`apps/lindo-web` hoy son 17 líneas. Pasa a:

```tsx
// main.tsx
import { installWebLindoAPI } from '@lindo/host-web'
installWebLindoAPI()          // antes de montar: la UI lo espera en window
import('@lindo/ui').then(({ App }) => createRoot(...).render(<App />))
```

`packages/ui/App.tsx` no cambia. Sí hay que:

- Añadir `@lindo/ui`, `@lindo/shared`, `@lindo/client-store` y `@lindo/theme` a
  las dependencias de `apps/lindo-web`.
- Reemplazar `TitleBar` por un encabezado propio, o esconderlo si `titleBar` no
  existe (ya es opcional en el tipo `Window`).
- `vite.config.ts`: `optimizeDeps` para los paquetes del workspace, y alias si
  hace falta.

---

## Fase 4 · Lo que NO se puede conservar

Esto es lo que hay que decidir aceptar antes de empezar, no descubrir a mitad.

### 1. Toda la identidad de plataforma se pierde

Es la más importante, porque es donde está el trabajo reciente.

Un navegador **no puede cambiar su propio `User-Agent` ni sus `Sec-CH-UA`** para
las peticiones que hace. Tampoco su huella TLS. En web:

- Las cabeceras de [`game-window.ts`](../../apps/desktop/src/main/windows/game-window.ts) no tienen equivalente.
- `platform.js` **sí sigue funcionando** para la capa JS —`window.device`,
  `navigator.userAgentData`, WebGL, fuentes— porque son overrides dentro del
  documento.
- Pero HTTP y TLS delatan un navegador de escritorio, y eso **solo** se arregla
  proxeando *todo* el tráfico del juego por un servidor propio que reescriba
  cabeceras. Con WebSocket de por medio, eso es un servicio siempre encendido.

**Consecuencia práctica:** la build web es Android por JS y escritorio por red.
Si el servidor de validación mira cabeceras, la build web no pasa. Decidir si eso
importa **antes** de invertir en las fases 1-3.

### 2. Menú nativo, titlebar y ventanas múltiples

`Menu.setApplicationMenu`, `custom-electron-titlebar` y `BrowserWindow` no
existen. Varias ventanas pasan a ser varias pestañas del `gameStore`, que ya lo
soporta. Es pérdida de comodidad, no de función.

### 3. Atajos reservados por el navegador

`Cmd/Ctrl+W`, `Cmd+N`, `Cmd+T` y compañía. Reasignar por defecto en web.

### 4. `safeStorage`

Ver fase 1. Degradación de seguridad real en multicuenta.

### 5. Auto-actualización

`electron-updater` desaparece; en web, desplegar *es* actualizar. Se gana.

---

## Fase 5 · Despliegue

**Estático (si la fase 0 lo permite):**

```
build command   pnpm --filter lindo-web build   (incluye fetch-game.mjs)
output          apps/lindo-web/dist
```

Cabeceras a añadir en `vercel.json` / `netlify.toml`:

- `Cross-Origin-Opener-Policy` y `Cross-Origin-Embedder-Policy` **permisivas**:
  el juego usa canvas y WebGL con recursos propios, y COEP estricto rompería
  cosas sin aportar nada aquí.
- Cache larga para `/game/**` (contenido versionado por el manifest).

**Si hace falta proxy** (fase 0 dice que sí):

Vercel y Netlify **no sirven** para el WebSocket: sus funciones son
petición-respuesta. Alternativas, de menos a más trabajo: Cloudflare Workers con
Durable Objects, Fly.io, Railway. El front puede seguir en Vercel/Netlify y solo
el proxy vivir aparte.

---

## Orden recomendado y esfuerzo

| Fase | Qué desbloquea | Esfuerzo |
|---|---|---|
| **0** Reconocimiento | decide si el resto tiene sentido | bajo — una tarde |
| **2** Tubería del juego | poder cargar el juego en local | medio |
| **1** `host-web` | que la UI arranque | alto — 39 miembros |
| **3** Cáscara React | app usable en local | bajo |
| **5** Despliegue | hosting | bajo si es estático |
| **4** — | no es trabajo, es aceptar pérdidas | — |

Empezar por la **0**, luego la **2**: con el juego sirviéndose desde
`localhost:5173/game/` y una iframe del mismo origen ya se ve si el cliente
arranca, antes de escribir los 39 miembros.

**Criterio de éxito local:** entrar con una cuenta, ver el mapa, y que los mods
inicialicen — los mismos tres marcadores que comprueba `pnpm smoke` hoy.
