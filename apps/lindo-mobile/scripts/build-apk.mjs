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

const sdk = findSdk()
if (!sdk || !fs.existsSync(sdk)) {
  console.error(
    `No encuentro el SDK de Android${sdk ? ` en ${sdk}` : ''}.\n` +
      'Instálalo desde Android Studio o apunta ANDROID_HOME a donde esté.'
  )
  process.exit(2)
}

/**
 * En release Android prohíbe el tráfico en claro, así que un APK que apunte al
 * servidor de desarrollo se instala y luego no carga nada. Vale más decirlo aquí
 * que dejar que se descubra con el APK ya en el teléfono.
 */
if (!process.env.EXPO_PUBLIC_LINDO_URL) {
  console.warn(
    '\n  Aviso: sin EXPO_PUBLIC_LINDO_URL el APK apuntará a http://localhost:5173,\n' +
      '  y una build de release no admite http en claro. Para un APK que sirva:\n' +
      '    EXPO_PUBLIC_LINDO_URL=https://tu-despliegue pnpm --filter lindo-mobile build:android\n'
  )
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
