/**
 * The externalisation contract says every module kept out of the main bundle
 * must be copied into the asar. Nothing enforced it: a missing module is
 * invisible at build time and only crashes the packaged app, which is the one
 * artefact nobody runs before shipping.
 *
 * This walks every package inside a built asar and checks that each of its
 * declared runtime dependencies resolves inside that same asar, the way Node
 * would resolve it by walking node_modules upwards.
 *
 *   node scripts/verify-asar.mjs release/<version>/mac-arm64/Lindo.app/Contents/Resources/app.asar
 */
import * as asar from '@electron/asar'
import fs from 'fs'
import path from 'path'

/** Every app.asar electron-builder produced under release/, for any platform. */
const findAsars = (dir, found = []) => {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    // an .app bundle is a directory; app.asar is a file
    if (entry.isDirectory()) findAsars(full, found)
    else if (entry.name === 'app.asar') found.push(full)
  }
  return found
}

const targets = process.argv[2] ? [process.argv[2]] : findAsars('release')

if (!targets.length) {
  console.error('verify-asar: no app.asar found under release/ - run the packaging step first')
  process.exit(2)
}

const verify = (asarPath) => {
  const listing = asar
    .listPackage(asarPath, { isPack: false })
    .map((p) => p.replace(/^[/\\]/, '').split(path.sep).join('/'))

  const files = new Set(listing)

  // package roots only: .../node_modules/<name>/package.json, scoped or not
  const packageJsons = listing.filter((f) =>
    /(?:^|\/)node_modules\/(?:@[^/]+\/[^/]+|[^/@][^/]*)\/package\.json$/.test(f)
  )

  /** Resolve `dep` from `fromDir` the way Node walks node_modules upwards. */
  const resolves = (fromDir, dep) => {
    let dir = fromDir
    for (;;) {
      if (files.has(`${dir}/node_modules/${dep}/package.json`)) return true
      if (!dir.includes('/')) return files.has(`node_modules/${dep}/package.json`)
      dir = dir.slice(0, dir.lastIndexOf('/'))
    }
  }

  const problems = []
  for (const pj of packageJsons) {
    const pkgDir = pj.slice(0, pj.lastIndexOf('/'))
    let meta
    try {
      meta = JSON.parse(asar.extractFile(asarPath, pj).toString('utf8'))
    } catch {
      continue
    }
    const optional = new Set(Object.keys(meta.optionalDependencies || {}))
    for (const dep of Object.keys(meta.dependencies || {})) {
      if (optional.has(dep)) continue
      if (!resolves(pkgDir, dep)) {
        problems.push({ pkg: `${meta.name}@${meta.version}`, dir: pkgDir, missing: dep })
      }
    }
  }

  if (problems.length) {
    console.error(`ASAR_INCOMPLETE ${asarPath}: ${problems.length} unresolvable runtime dependencies`)
    for (const p of problems) {
      console.error(`  ${p.pkg} requires "${p.missing}"  (at ${p.dir})`)
    }
    return false
  }

  console.log(`ASAR_OK ${asarPath}: ${packageJsons.length} packages checked, all runtime dependencies resolve`)
  return true
}

const allOk = targets.map(verify).every(Boolean)
process.exit(allOk ? 0 : 1)
