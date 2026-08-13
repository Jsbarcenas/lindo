/**
 * Builds the playable game tree into public/game/.
 *
 *   node scripts/fetch-game.mjs [--force]
 *
 * Same job the desktop updater does, minus everything that needs Electron: it
 * downloads the Dofus shell, applies regex.json, and drops the result next to
 * the local game-base files.
 *
 * Assets are NOT downloaded. The client loads those from `Config.assetsUrl`,
 * which is Ankama's CDN, and that CDN answers with `access-control-allow-origin: *`
 * - so a browser can fetch them directly and there is nothing to mirror. Only
 * the shell has to be served locally, because the patches in regex.json are
 * what make it run outside a phone.
 *
 * Downloads are cached under .game-cache/ keyed by the remote manifest version,
 * so a rebuild with nothing new is instant. --force ignores the cache.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
// js-beautify is CommonJS: under plain ESM the functions hang off the default
// export, not off the namespace the way the desktop build's interop makes it look
import beautifyPkg from 'js-beautify'

const beautify = { js: beautifyPkg.js, css: beautifyPkg.css }

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WEB = path.join(HERE, '..')
const GAME_BASE = path.join(WEB, '..', 'desktop', 'game-base')
const OUT = path.join(WEB, 'public', 'game')
const CACHE = path.join(WEB, '.game-cache')

const DOFUS_ORIGIN = 'https://dt-proxy-production-login.ankama-games.com/'
const DOFUS_EARLY_ORIGIN = 'https://earlyproxy.touch.dofus.com/'
const force = process.argv.includes('--force')

/**
 * The shell files, and only those. The manifest lists far more, but everything
 * else is either an asset served from the CDN or something the browser build
 * has no use for.
 */
const WANTED = ['build/script.js', 'build/styles-native.css']

const log = (message) => console.log(`fetch-game: ${message}`)

/** an origin can be permanently gone, so the preferred one is probed first */
const resolveOrigin = async () => {
  for (const origin of [DOFUS_ORIGIN, DOFUS_EARLY_ORIGIN]) {
    try {
      const response = await fetch(origin + 'manifest.json', { signal: AbortSignal.timeout(15000) })
      if (response.ok) {
        log(`origen ${origin}`)
        return { origin, manifest: await response.json() }
      }
    } catch (error) {
      log(`origen inalcanzable ${origin}: ${error.message}`)
    }
  }
  throw new Error('ningun origen de Dofus Touch responde')
}

const applyRegex = (filename, content, patches, origin) => {
  const rules = patches[filename]
  if (!rules) return content

  let output = filename.endsWith('.js')
    ? beautify.js(content, { break_chained_methods: true })
    : beautify.css(content)

  for (const [pattern, replacement] of rules) {
    const resolved = replacement.replace(/{{DOFUS_ORIGIN}}/g, origin.replace(/\/$/, ''))
    const next = output.replace(new RegExp(pattern, 'g'), resolved)
    // a patch that stops matching disappears without a trace otherwise, and one
    // of these is what makes the client report itself as Android
    if (next === output) {
      console.error(`fetch-game: AVISO - el parche de ${filename} no encontro nada:\n  ${pattern.slice(0, 90)}`)
    }
    output = next
  }
  return output
}

const run = async () => {
  const { origin, manifest } = await resolveOrigin()
  const patches = JSON.parse(fs.readFileSync(path.join(GAME_BASE, 'regex.json'), 'utf8'))

  fs.mkdirSync(path.join(OUT, 'build'), { recursive: true })
  fs.mkdirSync(CACHE, { recursive: true })

  for (const name of WANTED) {
    const entry = manifest.files[name]
    if (!entry) throw new Error(`${name} no esta en el manifest remoto`)

    // versions in this manifest are opaque hashes and contain slashes, so both
    // halves of the cache name have to be flattened
    const safe = (value) => String(value).replace(/[^\w.-]/g, '_')
    const cached = path.join(CACHE, `${safe(name)}.${safe(entry.version)}`)
    let content
    if (!force && fs.existsSync(cached)) {
      log(`cache ${name} (v${entry.version})`)
      content = fs.readFileSync(cached, 'utf8')
    } else {
      log(`descargando ${name} (v${entry.version})`)
      const response = await fetch(origin + entry.filename, { signal: AbortSignal.timeout(120000) })
      if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`)
      content = await response.text()
      fs.writeFileSync(cached, content)
    }

    fs.writeFileSync(path.join(OUT, name), applyRegex(name, content, patches, origin))
  }

  // the local shell: index.html, platform.js, fixes.*, keymaster2.js
  const base = JSON.parse(fs.readFileSync(path.join(GAME_BASE, 'manifest.json'), 'utf8'))
  for (const entry of Object.values(base.files)) {
    const source = path.join(GAME_BASE, entry.filename)
    if (!fs.existsSync(source)) continue
    fs.copyFileSync(source, path.join(OUT, entry.filename))
  }

  const versionMatch = /window\.buildVersion\s?=\s?"([\d.]+(?:-\d+)?)"/.exec(
    fs.readFileSync(path.join(OUT, 'build/script.js'), 'utf8')
  )
  fs.writeFileSync(
    path.join(OUT, 'versions.json'),
    JSON.stringify({ buildVersion: versionMatch ? versionMatch[1] : 'unknown', origin })
  )

  log(`listo en ${path.relative(process.cwd(), OUT)} (buildVersion ${versionMatch?.[1] ?? '?'})`)
}

run().catch((error) => {
  console.error(`fetch-game: ${error.message}`)
  process.exit(1)
})
