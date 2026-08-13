import axios, { AxiosInstance } from 'axios'
import axiosRetry from 'axios-retry'
import fs from 'fs-extra'
import path from 'path'
import * as beautify from 'js-beautify'
import { UpdaterWindow } from '../windows/updater-window'
import { DiffManifest, Files, Manifest, RegexPatches, retrieveManifests } from '@lindo/updater-core'
import {
  DOFUS_ANDROID_APP_VERSION,
  DOFUS_ORIGIN,
  GAME_BASE_PATH,
  GAME_PATH,
  LINDO_MANIFEST_PATH,
  LOCAL_ASSET_MAP_PATH,
  LOCAL_DOFUS_MANIFEST_PATH,
  LOCAL_LINDO_MANIFEST_PATH,
  LOCAL_REGEX_PATH,
  LOCAL_VERSIONS_PATH,
  DOFUS_EARLY_ORIGIN,
  dofusAssetMapUrl,
  dofusManifestUrl
} from '../constants'
import { RootStore } from '@lindo/shared'
import { logger } from '../logger'
import { generateUserArgent } from '../utils'
import { Agent } from 'https'

interface GameVersion {
  buildVersion: string
  appVersion: string
}

export class GameUpdater {
  private readonly _updaterWindow: UpdaterWindow
  private readonly _rootStore: RootStore
  private readonly _httpClient: AxiosInstance
  private _dofusOrigin: string

  private constructor(updaterWindow: UpdaterWindow, rootStore: RootStore, userAgent: string) {
    this._updaterWindow = updaterWindow
    this._rootStore = rootStore
    this._httpClient = axios.create({
      headers: {
        'User-Agent': userAgent
      },
      httpsAgent: new Agent({ keepAlive: true })
    })
    this._dofusOrigin = rootStore.appStore.dofusTouchEarly ? DOFUS_EARLY_ORIGIN : DOFUS_ORIGIN
    axiosRetry(this._httpClient, {
      retries: 5,
      retryDelay: () => 1000,
      shouldResetTimeout: true,
      onRetry: (retryCount, error) => {
        logger.warn({ retryCount, error: error.toString() })
      }
    })
  }

  static async init(rootStore: RootStore): Promise<GameUpdater> {
    const updaterWindow = await UpdaterWindow.init(rootStore)
    const userAgent = await generateUserArgent(rootStore.appStore.appVersion)
    return new GameUpdater(updaterWindow, rootStore, userAgent)
  }

  async run() {
    // create folder if missing
    return (async () => {
      // fs.rmSync(GAME_PATH, { recursive: true, force: true })
      fs.mkdirSync(GAME_PATH, { recursive: true })
      fs.mkdirSync(GAME_PATH + 'build', { recursive: true })

      this._updaterWindow.sendProgress({ message: 'RESOLVING DOFUS ORIGIN', percent: 0 })
      this._dofusOrigin = await this._resolveDofusOrigin()
      // the renderer needs it too: mods talk to the same backend
      this._rootStore.appStore.setDofusOrigin(this._dofusOrigin)

      this._updaterWindow.sendProgress({ message: 'DOWNLOADING ALL MANIFESTS', percent: 0 })

      const [, remoteAssetManifest, assetDiffManifest] = await retrieveManifests({
        localManifestPath: LOCAL_ASSET_MAP_PATH,
        manifestSource: dofusAssetMapUrl(this._dofusOrigin),
        httpClient: this._httpClient
      })
      const [, remoteLindoManifest, lindoDiffManifest] = await retrieveManifests({
        localManifestPath: LOCAL_LINDO_MANIFEST_PATH,
        manifestSource: LINDO_MANIFEST_PATH,
        httpClient: this._httpClient
      })
      const [, remoteDofusManifest, dofusDiffManifest] = await retrieveManifests({
        localManifestPath: LOCAL_DOFUS_MANIFEST_PATH,
        manifestSource: dofusManifestUrl(this._dofusOrigin),
        httpClient: this._httpClient
      })

      this._updaterWindow.sendProgress({ message: 'DOWNLOAD MISSING ASSETS FILES ON DISK..', percent: 10 })
      return this._downloadAssetsFiles(assetDiffManifest, remoteAssetManifest, false)
        .catch((error) => {
          logger.error('Error while downloading assets files:', error)
          // logger.info('Will restart in non async mod')
          // return this._downloadAssetsFiles(assetDiffManifest, remoteAssetManifest, false)
        })
        .then(async () => {
          this._updaterWindow.sendProgress({
            message: 'DOWNLOAD MISSING LINDO AND DOFUS FILES IN MEMORY..',
            percent: 40
          })
          const [missingLindoFiles, missingDofusFiles] = await this._retrieveMissingLindoAndDofusFiles(
            lindoDiffManifest,
            remoteLindoManifest,
            dofusDiffManifest,
            remoteDofusManifest
          )

          this._updaterWindow.sendProgress({ message: 'FINDING VERSIONS..', percent: 60 })
          const localVersions = await this._findingVersions(missingDofusFiles)

          this._updaterWindow.sendProgress({
            message: 'APPLYING CLIENT ASSET EXTENSIONS ON DOFUS MISSING FILES',
            percent: 70
          })
          this._applyRegex(lindoDiffManifest, missingLindoFiles, missingDofusFiles)

          this._updaterWindow.sendProgress({ message: 'WRITING LINDO AND DOFUS MISSING FILES TO DISK', percent: 80 })
          this._writeMissingFiles(missingLindoFiles)
          this._writeMissingFiles(missingDofusFiles)

          this._updaterWindow.sendProgress({ message: 'REMOVING OLD ASSETS AND DOFUS FILES..', percent: 90 })
          this._removeOldAssets(dofusDiffManifest, remoteDofusManifest)
          this._removeOldAssets(lindoDiffManifest, remoteLindoManifest)

          this._updaterWindow.sendProgress({ message: 'SAVING ALL JSON FILES TO DISK', percent: 100 })
          await Promise.all([
            fs.promises.writeFile(LOCAL_ASSET_MAP_PATH, JSON.stringify(remoteAssetManifest)),
            fs.promises.writeFile(LOCAL_LINDO_MANIFEST_PATH, JSON.stringify(remoteLindoManifest)),
            fs.promises.writeFile(LOCAL_DOFUS_MANIFEST_PATH, JSON.stringify(remoteDofusManifest)),
            fs.promises.writeFile(LOCAL_VERSIONS_PATH, JSON.stringify(localVersions))
          ])

          // save to store
          this._rootStore.appStore.setAppVersion(localVersions.appVersion)
          this._rootStore.appStore.setBuildVersion(localVersions.buildVersion)
        })
    })().finally(() => {
      logger.info('GAME UPDATE FINISH')
      this._updaterWindow.close()
    })
  }

  /** the other origin, used as a fallback when a file is missing on the current one */
  private get _fallbackDofusOrigin(): string {
    return this._dofusOrigin === DOFUS_EARLY_ORIGIN ? DOFUS_ORIGIN : DOFUS_EARLY_ORIGIN
  }

  /**
   * An origin can be permanently offline (proxyconnection.touch.dofus.com doesn't resolve anymore),
   * so the preferred one is probed first and the other one is used as a fallback.
   */
  private async _resolveDofusOrigin(): Promise<string> {
    const preferred = this._rootStore.appStore.dofusTouchEarly ? DOFUS_EARLY_ORIGIN : DOFUS_ORIGIN
    const fallback = preferred === DOFUS_EARLY_ORIGIN ? DOFUS_ORIGIN : DOFUS_EARLY_ORIGIN

    for (const origin of [preferred, fallback]) {
      try {
        // a host that doesn't resolve is dead for good and must not delay the startup,
        // but the origin can also be simply slow to answer, in that case retry
        await this._httpClient.get(dofusManifestUrl(origin), {
          timeout: 10000,
          'axios-retry': { retries: 3, retryCondition: (error) => error.code !== 'ENOTFOUND' }
        })
        logger.info('GameUpdater -> using dofus origin ' + origin)
        return origin
      } catch (error) {
        // the reason matters when diagnosing: a host that does not resolve is dead
        // for good, a timeout may just be a slow origin
        logger.warn(`GameUpdater -> dofus origin unreachable ${origin}: ${(error as Error).message}`)
      }
    }

    throw new Error('No reachable Dofus Touch origin, the game servers may be down')
  }

  /** read a file from the local game-base folder, json files are parsed, the others kept as raw buffer */
  private _readGameBaseFile(filename: string): Promise<unknown> {
    const filePath = path.join(GAME_BASE_PATH, filename)
    if (filename.endsWith('.json')) {
      return fs.promises.readFile(filePath, 'utf-8').then((content) => JSON.parse(content))
    }
    return fs.promises.readFile(filePath)
  }

  private _writeMissingFiles(files: Files) {
    for (const filename in files) {
      let fileContent: string | Buffer
      if (Buffer.isBuffer(files[filename])) {
        fileContent = files[filename] as Buffer
      } else if (typeof files[filename] === 'object') {
        fileContent = JSON.stringify(files[filename])
      } else {
        fileContent = files[filename] as string
      }

      fs.writeFileSync(GAME_PATH + filename, fileContent)
    }
  }

  private _removeOldAssets(differences: DiffManifest, manifest: Manifest) {
    for (const key in differences) {
      if (differences[key] === -1) {
        const filePath = GAME_PATH + manifest.files[key].filename
        const directoryPath = path.dirname(filePath)

        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath)

          const directory = fs.readdirSync(directoryPath)
          if (directory.length === 0) fs.rmdirSync(directoryPath)
        }
      }
    }
  }

  private _applyRegex(lindoDiffManifest: DiffManifest, missingLindoFiles: Files, missingDofusFiles: Files) {
    let regex: RegexPatches

    if (lindoDiffManifest['regex.json'] === 1) {
      regex = missingLindoFiles['regex.json'] as RegexPatches
    } else {
      regex = fs.existsSync(LOCAL_REGEX_PATH) ? JSON.parse(fs.readFileSync(LOCAL_REGEX_PATH, 'utf-8')) : {}
    }

    for (const filename in regex) {
      if (missingDofusFiles[filename]) {
        if (/.js$/.test(filename)) {
          missingDofusFiles[filename] = beautify.js(missingDofusFiles[filename] as string, {
            break_chained_methods: true
          })
        } else if (/.css$/.test(filename)) {
          missingDofusFiles[filename] = beautify.css(missingDofusFiles[filename] as string)
        }

        for (const i in regex[filename]) {
          // the patches can reference the origin the game is served from, which is resolved at runtime
          const replacement = regex[filename][i][1].replace(/{{DOFUS_ORIGIN}}/g, this._dofusOrigin.replace(/\/$/, ''))
          const pattern = new RegExp(regex[filename][i][0], 'g')
          const before = missingDofusFiles[filename] as string
          const after = before.replace(pattern, replacement)

          // String.replace returns the input untouched when nothing matches, so
          // a patch that stopped matching an upstream change used to disappear
          // without a trace - including the one that sets the reported platform,
          // which then silently kept Ankama's own value. Several of these are
          // anchored on distances between tokens (`[\s\S]{1,200}`) that a
          // reformat is enough to break, so this is not a rare failure.
          if (after === before) {
            logger.error(`GameUpdater -> regex patch ${i} of ${filename} matched nothing, it needs updating`)
          }

          missingDofusFiles[filename] = after
        }
      }
    }
  }

  private async _findingVersions(missingDofusFiles: Files): Promise<GameVersion> {
    const localVersions: GameVersion = fs.existsSync(LOCAL_VERSIONS_PATH)
      ? JSON.parse(fs.readFileSync(LOCAL_VERSIONS_PATH, 'utf-8'))
      : {}

    // Set unconditionally, unlike buildVersion below. It used to be fetched from
    // Apple's lookup endpoint alongside reading the bundle, so it was gated on
    // the bundle having been re-downloaded. It no longer comes from there, and
    // leaving it gated meant any install that already had script.js would keep
    // the old value forever - the change would have looked applied and done
    // nothing.
    localVersions.appVersion = DOFUS_ANDROID_APP_VERSION

    const buildScriptFile = missingDofusFiles['build/script.js']
    if (buildScriptFile && typeof buildScriptFile === 'string') {
      logger.info('FETCH BUILD VERSION FROM script.js')
      localVersions.buildVersion = buildScriptFile.match(/window\.buildVersion\s?=\s?"(\d+\.\d+\.\d+(?:-\d+)?)"/)![1]
    }

    logger.info(
      'VERSIONS : buildVersion = ' + localVersions.buildVersion + ' - appVersion = ' + localVersions.appVersion
    )

    return localVersions
  }

  private async _retrieveMissingLindoAndDofusFiles(
    lindoDiff: DiffManifest,
    remoteLindo: Manifest,
    dofusDiff: DiffManifest,
    remoteDofus: Manifest
  ) {
    const lindoFiles: Files = {}
    for (const i in lindoDiff) {
      if (lindoDiff[i] === 1) {
        lindoFiles[i] = await this._readGameBaseFile(remoteLindo.files[i].filename)
      }
    }

    /** Re-download forced dofus if regex has changed */
    if (lindoDiff['regex.json'] === 1) {
      for (const i in dofusDiff) dofusDiff[i] = 1
    }

    const dofusFiles: Files = {}
    for (const i in dofusDiff) {
      if (dofusDiff[i] === 1) {
        dofusFiles[i] = await this._downloadFile(this._dofusOrigin + remoteDofus.files[i].filename).catch(() => {
          // switch on the other origin if the file is missing on the current one
          return this._downloadFile(this._fallbackDofusOrigin + remoteDofus.files[i].filename)
        })
      }
    }
    return [lindoFiles, dofusFiles]
  }

  private async _downloadAssetsFiles(diffManifest: DiffManifest, remoteAsset: Manifest, parallel: boolean = true) {
    const initialStatus = 'Downloading Dofus files'

    const totalDownload = Object.keys(diffManifest).reduce((acc, key) => acc + (diffManifest[key] === 1 ? 1 : 0), 0)
    let currentDownload = 0

    const promises = Object.keys(diffManifest)
      .filter((key) => diffManifest[key] === 1)
      .map(async (key) => {
        const url = this._dofusOrigin + remoteAsset.files[key].filename
        const filePath = GAME_PATH + remoteAsset.files[key].filename

        const directoryPath = path.dirname(filePath)
        const fileExists = await fs.promises
          .access(directoryPath, fs.constants.F_OK)
          .then(() => true)
          .catch(() => false)
        if (!fileExists) {
          await fs.promises.mkdir(directoryPath, { recursive: true })
        }

        const fileWriteStream = fs.createWriteStream(filePath)

        return this._httpClient
          .get(url, { responseType: 'stream' })
          .catch(() => {
            // switch on the other origin if the file is missing on the current one
            return this._httpClient.get(this._fallbackDofusOrigin + remoteAsset.files[key].filename, {
              responseType: 'stream'
            })
          })
          .then((response) => {
            return new Promise<void>((resolve, reject) => {
              fileWriteStream.on('finish', function () {
                resolve()
              })
              fileWriteStream.on('error', (err) => {
                reject(err)
              })
              response.data.pipe(fileWriteStream)
            }).catch((e) => {
              console.log(e)
              logger.error('Error while downloading ' + url)
            })
          })
          .then(() => {
            currentDownload++
            this._updaterWindow.sendProgress({
              message: initialStatus + ' (' + currentDownload + '/' + totalDownload + ')',
              percent: 10 + (currentDownload / totalDownload) * 30
            })
          })
      })

    if (parallel) {
      await Promise.allSettled(promises).then((results) => {
        if (results.some((result) => result.status === 'rejected')) {
          throw new Error('Error while downloading files')
        }
      })
    } else {
      for (const promise of promises) {
        await promise.catch((err) => {
          logger.error('Error while downloading asset file', err)
        })
      }
    }
  }

  private _downloadFile(url: string) {
    return this._httpClient.get(url).then((response) => response.data)
  }
}
