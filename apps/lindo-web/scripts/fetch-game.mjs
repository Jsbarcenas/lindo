/**
 * Copies the local game shell into public/game/.
 *
 *   node scripts/fetch-game.mjs
 *
 * It used to download and patch the Dofus bundle here, which meant an image
 * froze at whatever Ankama shipped the day it was built while the desktop kept
 * updating itself. That work moved into the page - see
 * `packages/host-web/game-updater.ts` - so this only stages the files that are
 * ours: index.html, platform.js, fixes.* and regex.json, which the updater
 * reads to know what to patch.
 *
 * The build needs no network, and the image no longer carries a client.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const GAME_BASE = path.join(HERE, '..', '..', 'desktop', 'game-base')
const OUT = path.join(HERE, '..', 'public', 'game')

const manifest = JSON.parse(fs.readFileSync(path.join(GAME_BASE, 'manifest.json'), 'utf8'))

fs.mkdirSync(OUT, { recursive: true })

const wanted = new Set()
let copied = 0
for (const entry of Object.values(manifest.files)) {
  const source = path.join(GAME_BASE, entry.filename)
  if (!fs.existsSync(source)) continue
  fs.copyFileSync(source, path.join(OUT, entry.filename))
  wanted.add(entry.filename)
  copied++
}

/**
 * Lo que ya no está en el manifiesto tampoco debe seguir servido.
 *
 * Copiar sin barrer deja para siempre lo que se retire: al quitar
 * `keymaster2.js` su copia seguía aquí, servida por el servidor de desarrollo,
 * aunque nada la cargara. El updater del escritorio ya poda; esto hace lo mismo
 * de este lado.
 */
let removed = 0
for (const name of fs.readdirSync(OUT)) {
  if (wanted.has(name)) continue
  fs.rmSync(path.join(OUT, name), { recursive: true, force: true })
  removed++
}

console.log(
  `fetch-game: ${copied} ficheros de game-base en ${path.relative(process.cwd(), OUT)}` +
    (removed ? ` (${removed} retirados)` : '')
)
console.log('fetch-game: el bundle de Dofus lo descarga y parchea el navegador al arrancar')
