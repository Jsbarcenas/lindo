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

/**
 * Every global platform.js installs must be one the bundle never mentions.
 *
 * That rule has been broken twice by hand - once with `store`, which has 86
 * references and threw on its first chained call, and once with
 * `WizAssetsError`, which was confused with a name that really is unused. Both
 * were caught after the fact. Checking it here means the next one is caught
 * before the game is opened.
 */
const checkInstalledGlobals = () => {
  const platformPath = path.join(GAME_BASE, 'platform.js')
  const bundlePath = path.join(gamePath, 'build', 'script.js')
  if (!fs.existsSync(platformPath) || !fs.existsSync(bundlePath)) return []

  const surface = /var surface = \{([\s\S]*?)\n {4}\}\n/.exec(fs.readFileSync(platformPath, 'utf8'))
  if (!surface) return ['could not find the surface table in platform.js']

  const names = [...surface[1].matchAll(/^ {6}(\w+):/gm)].map((match) => match[1])
  const bundle = fs.readFileSync(bundlePath, 'utf8')
  return names
    .filter((name) => new RegExp(`\\b${name}\\b`).test(bundle))
    .map((name) => `platform.js installs "${name}", which the bundle references - a stub can send it down a path that then fails`)
}

const globalProblems = checkInstalledGlobals()

if (!stale.length && !absent.length && !globalProblems.length) {
  console.log(`check-game-base: OK - ${Object.keys(manifest.files).length} files match what is deployed`)
  process.exit(0)
}

for (const problem of globalProblems) console.error(`check-game-base: ${problem}`)

for (const name of absent) console.error(`check-game-base: never deployed: ${name}`)
for (const name of stale) console.error(`check-game-base: deployed copy differs from source: ${name}`)
console.error('\nBump the "version" of those entries in game-base/manifest.json - the updater')
console.error('copies a file only when its recorded version changes.')
process.exit(1)
