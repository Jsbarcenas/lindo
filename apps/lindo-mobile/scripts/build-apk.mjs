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
 * De dónde sale el cliente en este APK.
 *
 * Por defecto, de dentro: se compila `apps/lindo-web` y se copia a los assets,
 * y `modules/shell-assets` lo sirve sobre un dominio https reservado. Así el APK
 * funciona en cualquier teléfono sin servidor de por medio.
 *
 * `EXPO_PUBLIC_LINDO_URL` lo apunta a un despliegue propio, y `--local` al
 * servidor de desarrollo de esta máquina, que es el APK con el que se verifica
 * en el emulador.
 */
const local = process.argv.includes('--local')
if (local) {
  // el APK de pruebas, que sí depende del servidor de desarrollo del anfitrión
  process.env.EXPO_PUBLIC_LINDO_URL = 'http://localhost:5173'
  console.warn('\n  APK local: apunta a http://localhost:5173 y necesita `adb reverse tcp:5173 tcp:5173`.\n')
} else if (process.env.EXPO_PUBLIC_LINDO_URL) {
  console.log(`==> cliente: ${process.env.EXPO_PUBLIC_LINDO_URL} (remoto)`)
} else {
  console.log('==> cliente: empaquetado en el APK')
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
/**
 * El prebuild empieza borrando `android/`, y a veces no puede: si quedó un
 * demonio de Gradle con ficheros abiertos, falla con ENOTEMPTY y se lleva el
 * build entero. Borrarlo aquí y reintentar sale más barato que descubrirlo.
 */
try {
  run('npx', ['expo', 'prebuild', '--platform', 'android', '--no-install'], {
    env: { ...process.env, ANDROID_HOME: sdk }
  })
} catch (error) {
  console.warn('==> prebuild falló, limpiando android/ y reintentando')
  fs.rmSync(ANDROID, { recursive: true, force: true })
  run('npx', ['expo', 'prebuild', '--platform', 'android', '--no-install'], {
    env: { ...process.env, ANDROID_HOME: sdk }
  })
}

fs.writeFileSync(path.join(ANDROID, 'local.properties'), `sdk.dir=${sdk}\n`)

/**
 * El shell, dentro del APK.
 *
 * Se compila y se copia después del prebuild porque el prebuild regenera
 * `android/` entero, assets incluidos. Con una URL remota no hace falta: el
 * cliente vendrá de ahí y meterlo además solo engordaría el APK.
 */
if (!process.env.EXPO_PUBLIC_LINDO_URL) {
  console.log('==> compilando apps/lindo-web')
  run('pnpm', ['--filter', 'lindo-web', 'build'], { cwd: path.join(APP, '..', '..') })

  const web = path.join(APP, '..', 'lindo-web', 'dist')
  if (!fs.existsSync(web)) {
    console.error(`No hay build web en ${web}`)
    process.exit(1)
  }
  const shell = path.join(ANDROID, 'app', 'src', 'main', 'assets', 'shell')
  fs.rmSync(shell, { recursive: true, force: true })
  fs.cpSync(web, shell, { recursive: true })
  console.log(`==> shell empaquetado desde ${path.relative(process.cwd(), web)}`)
}

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
