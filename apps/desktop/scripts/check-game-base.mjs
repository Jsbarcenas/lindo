/**
 * Checks that what is deployed under the user data directory is what game-base
 * actually contains.
 *
 * The updater diffs these files by the version recorded in manifest.json, so
 * editing one without bumping its version means the change is never copied out.
 * Nothing fails: the app runs, every other check passes, and only the behaviour
 * is missing. That went unnoticed once for the whole platform-identity work, and
 * a run of this found two more files carrying undeployed edits.
 *
 *   node scripts/check-game-base.mjs [gamePath]
 *
 * JSON is compared parsed, not byte for byte: the updater reads those files with
 * JSON.parse and writes them back with JSON.stringify, so a pretty-printed
 * source can never match its own deployed copy as bytes.
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const GAME_BASE = path.join(HERE, '..', 'game-base')

const defaultGamePath = () => {
  const home = process.env.HOME ?? ''
  return process.platform === 'linux'
    ? path.join(home, '.config', 'Lindo', 'game')
    : path.join(home, 'Library', 'Application Support', 'Lindo', 'game')
}

const gamePath = process.argv[2] ?? defaultGamePath()

if (!fs.existsSync(gamePath)) {
  console.error(`check-game-base: ${gamePath} does not exist - run the app once so the updater populates it`)
  process.exit(2)
}

const manifest = JSON.parse(fs.readFileSync(path.join(GAME_BASE, 'manifest.json'), 'utf8'))
const stale = []
const absent = []

/** the updater re-serialises json, so only the parsed value is comparable */
const sameContent = (name, source, deployed) => {
  if (!name.endsWith('.json')) return Buffer.compare(source, deployed) === 0
  try {
    return JSON.stringify(JSON.parse(source.toString())) === JSON.stringify(JSON.parse(deployed.toString()))
  } catch {
    return false
  }
}

for (const [key, entry] of Object.entries(manifest.files)) {
  const name = entry.filename
  const sourcePath = path.join(GAME_BASE, name)
  const deployedPath = path.join(gamePath, name)

  if (!fs.existsSync(sourcePath)) continue
  if (!fs.existsSync(deployedPath)) {
    absent.push(`${name} (manifest key "${key}", version ${entry.version})`)
    continue
  }
  if (!sameContent(name, fs.readFileSync(sourcePath), fs.readFileSync(deployedPath))) {
    stale.push(`${name} (still deployed at version ${entry.version})`)
  }
}

if (!stale.length && !absent.length) {
  console.log(`check-game-base: OK - ${Object.keys(manifest.files).length} files match what is deployed`)
  process.exit(0)
}

for (const name of absent) console.error(`check-game-base: never deployed: ${name}`)
for (const name of stale) console.error(`check-game-base: deployed copy differs from source: ${name}`)
console.error('\nBump the "version" of those entries in game-base/manifest.json - the updater')
console.error('copies a file only when its recorded version changes.')
process.exit(1)
