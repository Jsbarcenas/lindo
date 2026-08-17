/**
 * Deja el cliente web dentro de `android/app/src/main/assets/shell`.
 *
 * De ahí lo sirve `modules/shell-assets` sobre loopback, que es lo que le da al
 * WebView un origen que cuenta como seguro. Sin estos ficheros el servidor
 * levanta igual y contesta 404 a `/`, y por fuera eso se ve como una pantalla
 * negra después de un rato cargando - exactamente lo que pasaba en desarrollo,
 * porque la copia vivía solo dentro de `build-apk.mjs` y `expo run:android`
 * nunca la hacía.
 *
 * Se llama desde tres sitios y es idempotente: el plugin de prebuild, el script
 * de release y el de desarrollo. En CommonJS porque los config plugins de Expo
 * lo son.
 */
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const APP = path.join(__dirname, '..')
const REPO = path.join(APP, '..', '..')
const WEB = path.join(REPO, 'apps', 'lindo-web', 'dist')

/**
 * @param {{ androidRoot?: string, force?: boolean }} options
 *   `androidRoot` lo pasa el plugin, que conoce la ruta del proyecto nativo
 *   antes de que exista donde la esperamos. `force` recompila el cliente aunque
 *   ya haya un `dist`: lo quiere el release, no el día a día.
 * @returns {string | null} dónde quedó, o null si no hacía falta
 */
function stageShell({ androidRoot, force = false } = {}) {
  // con una URL remota el cliente viene de ahí, y meterlo además solo engordaría
  // el APK
  if (process.env.EXPO_PUBLIC_LINDO_URL) return null

  if (force || !fs.existsSync(path.join(WEB, 'index.html'))) {
    console.log('==> compilando apps/lindo-web')
    const build = spawnSync('pnpm', ['--filter', 'lindo-web', 'build'], { cwd: REPO, stdio: 'inherit' })
    if (build.status !== 0) throw new Error('no se pudo compilar apps/lindo-web')
  }
  if (!fs.existsSync(path.join(WEB, 'index.html'))) {
    throw new Error(`No hay build web en ${WEB}`)
  }

  const shell = path.join(androidRoot ?? path.join(APP, 'android'), 'app', 'src', 'main', 'assets', 'shell')
  fs.rmSync(shell, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(shell), { recursive: true })
  fs.cpSync(WEB, shell, { recursive: true })
  console.log(`==> shell empaquetado desde ${path.relative(process.cwd(), WEB)}`)
  return shell
}

module.exports = { stageShell }

if (require.main === module) {
  try {
    stageShell({ force: process.argv.includes('--force') })
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}
