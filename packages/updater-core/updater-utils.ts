import { AxiosInstance } from 'axios'
import fs from 'fs'
import { Manifest } from './models'

export type DiffManifest = Record<string, 1 | 0 | -1>

export const retrieveManifests = async ({
  localManifestPath,
  manifestSource,
  httpClient
}: {
  localManifestPath: string
  /** an http(s) url or a path on the disk */
  manifestSource: string
  httpClient: AxiosInstance
}): Promise<[Manifest, Manifest, DiffManifest]> => {
  const localManifest: Manifest = fs.existsSync(localManifestPath)
    ? JSON.parse(fs.readFileSync(localManifestPath, 'utf8'))
    : {}
  const remoteManifest = await loadJson<Manifest>(manifestSource, httpClient)
  const difference = diffManifest(localManifest, remoteManifest)

  return [localManifest, remoteManifest, difference]
}

export const isRemoteSource = (source: string): boolean => /^https?:\/\//.test(source)

/** load a json from an http(s) url or from the disk */
export const loadJson = <T>(source: string, httpClient: AxiosInstance): Promise<T> => {
  if (!isRemoteSource(source)) {
    return fs.promises.readFile(source, 'utf8').then((content) => JSON.parse(content) as T)
  }
  return downloadJson<T>(source, httpClient)
}

export const downloadJson = <T>(url: string, httpClient: AxiosInstance): Promise<T> => {
  return httpClient.get(url).then((res) => {
    return res.data
  })
}

/**
 * Return the difference between two manifest
 * @returns {(1|-1|0)} 0 -> same files, -1 files removed, 1 file added */
export const diffManifest = (manifestA: Manifest, manifestB: Manifest): DiffManifest => {
  const differences: DiffManifest = {}

  if (manifestB && manifestB.files) {
    for (const i in manifestB.files) {
      if (
        !manifestA ||
        !manifestA.files ||
        !manifestA.files[i] ||
        manifestA.files[i].version !== manifestB.files[i].version
      ) {
        differences[i] = 1
      } else {
        differences[i] = 0
      }
    }
  }

  if (manifestA && manifestA.files) {
    for (const i in manifestA.files) {
      if (!manifestB || !manifestB.files || !manifestB.files[i]) {
        differences[i] = -1
      }
    }
  }

  return differences
}
