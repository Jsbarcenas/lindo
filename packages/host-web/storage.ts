/**
 * A key/value store on IndexedDB.
 *
 * Not localStorage: the rootStore snapshot grows with every account and team,
 * localStorage caps around 5 MB, and it is synchronous - which would block the
 * frame on every patch. The character portraits live here too, and those are
 * PNGs.
 */
const DB_NAME = 'lindo'
const STORE = 'kv'

let database: Promise<IDBDatabase> | undefined

const open = (): Promise<IDBDatabase> => {
  if (database) return database
  database = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  return database
}

const transact = async <T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
  const db = await open()
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE, mode)
    const request = run(transaction.objectStore(STORE))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export const get = <T>(key: string): Promise<T | undefined> => transact('readonly', (store) => store.get(key))
export const set = (key: string, value: unknown): Promise<IDBValidKey> =>
  transact('readwrite', (store) => store.put(value, key))
export const remove = (key: string): Promise<undefined> => transact('readwrite', (store) => store.delete(key))
export const clear = (): Promise<undefined> => transact('readwrite', (store) => store.clear())
