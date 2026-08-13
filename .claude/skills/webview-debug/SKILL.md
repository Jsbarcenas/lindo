---
name: webview-debug
description: Depurar el WebView de apps/lindo-mobile cuando el APK falla y desde fuera solo se ve una pantalla negra, un "cargando" eterno o un diálogo del juego que no dice la verdad ("todos los servidores están en mantenimiento"). Engancha DevTools remoto, graba red y consola, y prueba el servidor interno y su proxy de haapi por separado.
---

# Depurar el WebView del APK

El APK carga el cliente web dentro de un WebView. Cuando algo falla ahí dentro,
**desde fuera todos los fallos se ven igual**: negro, o un cartel del juego que
describe un síntoma en vez de la causa. Esta ruta es la que convierte eso en una
línea concreta.

## Cuándo usarla

- El APK arranca y se queda en negro, o en "Preparando el cliente".
- El login termina en *"todos los servidores están en mantenimiento"*, o el
  juego dice algo que no cuadra con lo que hace la web o Electron.
- Algo funciona en `pnpm --filter lindo-web dev` y no en el APK. Esa diferencia
  casi siempre está en el servidor interno o en su proxy.

## Los tres pasos

```bash
.claude/skills/webview-debug/attach.sh
```

Localiza el dispositivo, encuentra el socket de DevTools, lo reenvía a `:9222` y
además saca el puerto del servidor interno y lo reenvía también.

```bash
node .claude/skills/webview-debug/netwatch.mjs 120
```

Graba red, WebSockets y consola de **todos** los contextos durante ese tiempo.
Reproduce el fallo mientras corre.

```bash
adb logcat -d | grep 'lindo\[web'
```

La página reenvía sus errores a logcat (`nativePrelude` en `src/native/bridge.ts`)
porque un release no tiene consola visible. Suele bastar para saber si el fallo
es de JS o de red.

## Lo que hay que saber antes de perder una hora

**El socket lleva el pid.** Cada vez que la app se reinicia cambia, y hay que
volver a lanzar `attach.sh`. Si no, se sigue mirando un puerto muerto y parece
que no pasa nada.

**En release DevTools está apagado salvo por una prop.** `webviewDebuggingEnabled`
en `src/app/index.tsx`. Está puesta a propósito; si desaparece, esta ruta entera
deja de funcionar.

**Hay más de un contexto.** El service worker es un target aparte y sirve
`/game/build/*` desde IndexedDB. `netwatch.mjs` se engancha a todos; mirar solo
la página deja fuera la mitad.

**Las cabeceras de la petición importan tanto como el código.** Un 422 con
`Content-Type` y sin cuerpo es un cuerpo que no se reenvió, no una API rota. Por
eso `netwatch.mjs` imprime método, cabeceras y `postData` de cada 4xx.

**El servidor interno se puede probar solo.** `attach.sh` reenvía su puerto:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:PUERTO/game/regex.json
curl -s -i 'http://127.0.0.1:PUERTO/haapi/json/Ankama/v5/Account/Account?' -H 'apikey: prueba'
```

Un **403** de haapi ahí es buena señal: significa que la petición llegó a Ankama
y solo falló la clave. Así se separa "mi proxy está roto" de "el cliente manda
algo raro".

**Antes de culpar al código, mira el DNS.** Un emulador puede tener IP y no
resolver nombres, y eso sale como `TypeError: Failed to fetch` al comprobar
actualizaciones, indistinguible de un bug nuestro:

```bash
adb shell ping -c1 8.8.8.8                                   # ¿hay red?
adb shell ping -c1 dt-proxy-production-login.ankama-games.com # ¿hay DNS?
```

Si lo segundo falla, arranca el emulador con `-dns-server 8.8.8.8,1.1.1.1`.

## Lo que esta ruta ya encontró

| Síntoma | Causa real |
|---|---|
| "Todos los servidores están en mantenimiento" al entrar | `POST /haapi/…/RefreshApiKey` → 422: el proxy no reenviaba el cuerpo |
| Negro tras "Comprobando actualizaciones" | El emulador tenía IP pero no DNS |
| Negro nada más abrir | El WebView se quedó en `about:blank` porque el enganche nativo falló |

Las tres se veían igual desde fuera.
