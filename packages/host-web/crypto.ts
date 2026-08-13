/**
 * Master password and character password encryption, on Web Crypto only.
 *
 * Two deliberate differences from the desktop implementation, both worth
 * knowing before enabling multi-account on the web build:
 *
 * 1. **No keychain.** Electron wraps the stored hash with `safeStorage`, which
 *    encrypts it with the OS keychain, so reading the file is not enough. A
 *    browser has no equivalent: what is in IndexedDB is protected by the master
 *    password and nothing else, and any script running on this origin can read
 *    it.
 *
 * 2. **PBKDF2 instead of argon2.** argon2 in a browser means shipping a WASM
 *    build; PBKDF2-SHA256 is native and dependency-free. It is weaker against
 *    hardware attacks at equal cost, which is why the iteration count is high.
 *    Swapping in argon2-browser later only changes this file.
 */
const ITERATIONS = 310_000
const encoder = new TextEncoder()
const decoder = new TextDecoder()

const toBase64 = (bytes: ArrayBuffer): string => btoa(String.fromCharCode(...new Uint8Array(bytes)))
/**
 * Backed by a plain ArrayBuffer on purpose: `Uint8Array.from` widens to
 * ArrayBufferLike, which includes SharedArrayBuffer, and Web Crypto will not
 * accept that as a BufferSource.
 */
const fromBase64 = (value: string): Uint8Array<ArrayBuffer> => {
  const binary = atob(value)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

const deriveKey = async (password: string, salt: Uint8Array): Promise<CryptoKey> => {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

export interface MasterRecord {
  salt: string
  /** a known plaintext sealed with the derived key, so a wrong password fails to open it */
  verifier: string
}

export const createMasterRecord = async (password: string): Promise<MasterRecord> => {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await deriveKey(password, salt)
  return { salt: toBase64(salt.buffer as ArrayBuffer), verifier: await seal(key, 'lindo') }
}

export const openMasterRecord = async (record: MasterRecord, password: string): Promise<CryptoKey | null> => {
  const key = await deriveKey(password, fromBase64(record.salt))
  try {
    return (await open(key, record.verifier)) === 'lindo' ? key : null
  } catch {
    // AES-GCM fails to authenticate on a wrong key, which is the check itself
    return null
  }
}

export const seal = async (key: CryptoKey, plaintext: string): Promise<string> => {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(plaintext))
  return `${toBase64(iv.buffer as ArrayBuffer)}.${toBase64(sealed)}`
}

export const open = async (key: CryptoKey, payload: string): Promise<string> => {
  const [iv, body] = payload.split('.')
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(iv) }, key, fromBase64(body))
  return decoder.decode(plain)
}
