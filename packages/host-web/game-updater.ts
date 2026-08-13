import { UpdateProgress } from '@lindo/shared'
import beautifyPkg from 'js-beautify'
import * as storage from './storage'

/**
 * The desktop updater, in the page.
 *
 * The web build used to bake a patched client into the image at build time,
 * which meant it froze at whatever Ankama was shipping that day while the
 * desktop kept updating itself. This does what the desktop updater does -
 * compare manifests, download what changed, apply regex.json - on every visit.
 *
 * It is affordable because it was measured rather than assumed: the manifest is
 * 177 bytes, the bundle downloads in ~570 ms, js-beautify takes ~480 ms on its
 * 5.1 MB and the sixteen patches take ~56 ms. Around a second, once, and only
 * when Ankama has actually shipped something. That is also why there is no
 * worker here: half a second behind a splash is not worth the indirection.
 */
const ORIGIN = 'https://dt-proxy-production-login.ankama-games.com/'
const MANIFEST_KEY = 'game:manifest'
const SHELL = ['build/script.js', 'build/styles-native.css']

export const gameKey = (name: string): string => `game:${name}`

interface ManifestEntry {
  filename: string
  version: string
}
interface Manifest {
  files: Record<string, ManifestEntry>
}

const listeners = new Set<(progress: UpdateProgress) => void>()

export const onUpdateProgress = (notify: (progress: UpdateProgress) => void): (() => void) => {
  listeners.add(notify)
  return () => listeners.delete(notify)
}

const report = (message: string, percent: number) => {
  for (const notify of listeners) notify({ message, percent })
}

const patch = (name: string, source: string, rules: Array<[string, string]>): string => {
  let output = name.endsWith('.js') ? beautifyPkg.js(source, { break_chained_methods: true }) : beautifyPkg.css(source)

  for (const [pattern, replacement] of rules) {
    const resolved = replacement.replace(/{{DOFUS_ORIGIN}}/g, ORIGIN.replace(/\/$/, ''))
    const next = output.replace(new RegExp(pattern, 'g'), resolved)
    // a patch that silently stops matching is how the client would quietly go
    // back to reporting itself as something other than Android
    if (next === output) console.warn(`lindo: el parche de ${name} no encontró nada:`, pattern.slice(0, 80))
    output = next
  }
  return output
}

/**
 * Brings the stored client up to date, and reports whether anything changed.
 *
 * `force` skips the comparison, which is what "reset game data" needs: the same
 * meaning it has on the desktop, where it deletes the game folder and lets the
 * updater run again.
 */
export const updateGame = async ({ force = false } = {}): Promise<boolean> => {
  report('Comprobando actualizaciones', 0)

  const remote: Manifest = await fetch(`${ORIGIN}manifest.json`, { cache: 'no-store' }).then((r) => r.json())
  const local = await storage.get<Manifest>(MANIFEST_KEY)

  const stale = SHELL.filter((name) => {
    if (force || !local) return true
    return local.files[name]?.version !== remote.files[name]?.version
  })

  // a stored file can go missing even when the manifest says otherwise
  const missing = await Promise.all(SHELL.map(async (name) => ((await storage.get(gameKey(name))) ? null : name)))
  const wanted = [...new Set([...stale, ...missing.filter((name): name is string => name !== null)])]

  if (!wanted.length) {
    report('Al día', 100)
    return false
  }

  // served from public/game by fetch-game.mjs. Asking for it and getting the
  // SPA fallback means it was never staged, and the JSON parse error that
  // follows says nothing about why
  const rules: Record<string, Array<[string, string]>> = await fetch('/game/regex.json').then((response) => {
    const type = response.headers.get('content-type') ?? ''
    if (!response.ok || !type.includes('json')) {
      throw new Error('No encuentro /game/regex.json. Ejecuta `pnpm --filter lindo-web fetch-game`.')
    }
    return response.json()
  })

  let done = 0
  for (const name of wanted) {
    report(`Descargando ${name}`, Math.round((done / wanted.length) * 70))
    const entry = remote.files[name]
    if (!entry) throw new Error(`${name} no está en el manifest remoto`)

    const source = await fetch(ORIGIN + entry.filename, { cache: 'no-store' }).then((r) => {
      if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`)
      return r.text()
    })

    report(`Parcheando ${name}`, Math.round(70 + (done / wanted.length) * 25))
    await storage.set(gameKey(name), patch(name, source, rules[name] ?? []))
    done++
  }

  await storage.set(MANIFEST_KEY, remote)

  const buildVersion = /window\.buildVersion\s?=\s?"([\d.]+(?:-\d+)?)"/.exec(
    (await storage.get<string>(gameKey('build/script.js'))) ?? ''
  )?.[1]
  if (buildVersion) await storage.set('game:buildVersion', buildVersion)

  report('Listo', 100)
  return true
}

export const storedBuildVersion = (): Promise<string | undefined> => storage.get<string>('game:buildVersion')

/** drops the stored client so the next run downloads it again */
export const forgetGame = async (): Promise<void> => {
  await storage.remove(MANIFEST_KEY)
  await Promise.all(SHELL.map((name) => storage.remove(gameKey(name))))
}
