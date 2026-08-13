/**
 * Compila el APK de release y dice dónde quedó.
 *
 *   pnpm --filter lindo-mobile build:android
 *
 * Son tres pasos y ninguno es opcional:
 *
 * 1. `expo prebuild` regenera `android/` desde `app.json`. El directorio no se
 *    versiona a propósito -es salida, no fuente-, así que en un clon limpio no
 *    existe y en uno usado puede estar desfasado respecto a la config.
 * 2. `local.properties` se escribe **después** del prebuild, porque el prebuild
 *    se lleva por delante el que hubiera. Sin él, y sin `ANDROID_HOME` en el
 *    entorno, Gradle falla con un "SDK location not found" que no dice cómo
 *    arreglarse.
 * 3. `assembleRelease` empaqueta el JS dentro del APK, que es lo que lo hace
 *    instalable sin Metro delante.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const ANDROID = path.join(APP, 'android')

/** dónde vive el SDK: lo que diga el entorno, y si no, donde lo pone cada sistema */
const findSdk = () => {
  const fromEnv = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT
  if (fromEnv) return fromEnv
  const home = os.homedir()
  const guesses = {
    darwin: path.join(home, 'Library', 'Android', 'sdk'),
    linux: path.join(home, 'Android', 'Sdk'),
    win32: path.join(home, 'AppData', 'Local', 'Android', 'Sdk')
  }
  return guesses[process.platform]
}

const run = (command, args, options = {}) =>
  execFileSync(command, args, { stdio: 'inherit', cwd: APP, ...options })

/**
 * Un release tiene que traer un origen al que cualquier teléfono llegue.
 *
 * Sin `EXPO_PUBLIC_LINDO_URL` el APK apunta a `http://localhost:5173`, que es el
 * servidor de desarrollo del anfitrión y solo responde con `adb reverse`. En el
 * emulador de al lado parece que funciona; en cuanto el APK sale de esta máquina
 * se queda en "Cargando" para siempre. Eso no es un release, así que aquí se
 * para en vez de entregar un APK roto.
 *
 * `--local` es la excepción explícita: el APK de pruebas que sí depende del
 * dev server, que es el que se usa para verificar en el emulador.
 */
const local = process.argv.includes('--local')
if (!process.env.EXPO_PUBLIC_LINDO_URL && !local) {
  console.error(
    '\nFalta EXPO_PUBLIC_LINDO_URL.\n\n' +
      'Un APK de release sirve el cliente desde ese origen, y tiene que ser\n' +
      'alcanzable desde cualquier dispositivo - o sea, https público. El repo ya\n' +
      'trae listos `vercel.json` y `Dockerfile`/`railway.json` para desplegar\n' +
      '`apps/lindo-web`.\n\n' +
      '  EXPO_PUBLIC_LINDO_URL=https://tu-despliegue pnpm --filter lindo-mobile build:android\n\n' +
      'Para el APK de pruebas contra el dev server (necesita adb reverse):\n\n' +
      '  pnpm --filter lindo-mobile build:android -- --local\n'
  )
  process.exit(2)
}

if (local) {
  console.warn('\n  APK local: apunta a http://localhost:5173 y necesita `adb reverse tcp:5173 tcp:5173`.\n')
} else {
  console.log(`==> cliente: ${process.env.EXPO_PUBLIC_LINDO_URL}`)
}

const sdk = findSdk()
if (!sdk || !fs.existsSync(sdk)) {
  console.error(
    `No encuentro el SDK de Android${sdk ? ` en ${sdk}` : ''}.\n` +
      'Instálalo desde Android Studio o apunta ANDROID_HOME a donde esté.'
  )
  process.exit(2)
}

console.log('==> prebuild')
run('npx', ['expo', 'prebuild', '--platform', 'android', '--no-install'], {
  env: { ...process.env, ANDROID_HOME: sdk }
})

fs.writeFileSync(path.join(ANDROID, 'local.properties'), `sdk.dir=${sdk}\n`)

console.log('==> assembleRelease')
run(path.join(ANDROID, 'gradlew'), ['-p', ANDROID, 'assembleRelease'], {
  env: { ...process.env, ANDROID_HOME: sdk }
})

const apk = path.join(ANDROID, 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk')
if (!fs.existsSync(apk)) {
  console.error(`Gradle terminó bien pero no hay APK en ${apk}`)
  process.exit(1)
}
const megabytes = (fs.statSync(apk).size / 1024 / 1024).toFixed(1)
console.log(`\n==> ${apk}  (${megabytes} MB)`)
console.log('    instalar:  adb install -r ' + apk)
