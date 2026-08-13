/**
 * Copies the local game shell into public/game/.
 *
 *   node scripts/fetch-game.mjs
 *
 * It used to download and patch the Dofus bundle here, which meant an image
 * froze at whatever Ankama shipped the day it was built while the desktop kept
 * updating itself. That work moved into the page - see
 * `packages/host-web/game-updater.ts` - so this only stages the files that are
 * ours: index.html, platform.js, fixes.*, keymaster2.js and regex.json, which
 * the updater reads to know what to patch.
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

let copied = 0
for (const entry of Object.values(manifest.files)) {
  const source = path.join(GAME_BASE, entry.filename)
  if (!fs.existsSync(source)) continue
  fs.copyFileSync(source, path.join(OUT, entry.filename))
  copied++
}

console.log(`fetch-game: ${copied} ficheros de game-base en ${path.relative(process.cwd(), OUT)}`)
console.log('fetch-game: el bundle de Dofus lo descarga y parchea el navegador al arrancar')
