/* eslint-disable @typescript-eslint/no-var-requires */
/**
 * safeStorage is the one irreversible risk in the Electron upgrade: it encrypts
 * the multi-account master password, and the keychain backend it selects has
 * changed between Electron majors. A round-trip inside a single version proves
 * nothing on its own, so this keeps a fixture on disk: the first run writes a
 * ciphertext, and every later run (on a newer Electron) must still decrypt it.
 *
 * Run under Electron, not node:
 *   npx electron scripts/safe-storage-check.cjs
 */
const fs = require('fs')
const path = require('path')
const { app, safeStorage } = require('electron')

const FIXTURE = path.join(__dirname, '..', '.safe-storage-fixture.json')
const PLAINTEXT = 'lindo-safe-storage-canary'

const fail = (msg) => {
  console.error('SAFE_STORAGE_FAIL ' + msg)
  app.exit(1)
}

app.whenReady().then(() => {
  const electronVersion = process.versions.electron

  if (!safeStorage.isEncryptionAvailable()) {
    return fail(`encryption unavailable on electron ${electronVersion}`)
  }
  console.log(`electron ${electronVersion}: backend available`)

  // 1. round-trip within this version
  const roundTripped = safeStorage.decryptString(safeStorage.encryptString(PLAINTEXT))
  if (roundTripped !== PLAINTEXT) {
    return fail(`round-trip mismatch on electron ${electronVersion}`)
  }
  console.log(`electron ${electronVersion}: round-trip OK`)

  // 2. decrypt every ciphertext written by an earlier version
  const fixture = fs.existsSync(FIXTURE) ? JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) : { entries: [] }

  for (const entry of fixture.entries) {
    let decrypted
    try {
      decrypted = safeStorage.decryptString(Buffer.from(entry.ciphertext, 'base64'))
    } catch (e) {
      return fail(`cannot decrypt ciphertext written by electron ${entry.electron}: ${e.message}`)
    }
    if (decrypted !== PLAINTEXT) {
      return fail(`ciphertext from electron ${entry.electron} decrypted to the wrong value`)
    }
    console.log(`electron ${electronVersion}: decrypted fixture from electron ${entry.electron} OK`)
  }

  // 3. record this version's ciphertext for the next stop
  if (!fixture.entries.some((e) => e.electron === electronVersion)) {
    fixture.entries.push({
      electron: electronVersion,
      ciphertext: safeStorage.encryptString(PLAINTEXT).toString('base64')
    })
    fs.writeFileSync(FIXTURE, JSON.stringify(fixture, null, 2) + '\n')
    console.log(`electron ${electronVersion}: fixture recorded`)
  }

  console.log('SAFE_STORAGE_OK')
  app.exit(0)
})
