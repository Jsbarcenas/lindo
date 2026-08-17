import {
  FollowInstruction,
  GameContext,
  LindoAPI,
  LindoLogger,
  RootStoreModel,
  RootStoreSnapshot,
  SaveCharacterImageArgs
} from '@lindo/shared'
import { applyPatch, getSnapshot, IJsonPatch, onSnapshot } from 'mobx-state-tree'
import { publish, publishLocal, subscribe, subscribeEverywhere } from './channel'
import { createMasterRecord, MasterRecord, open as openSealed, openMasterRecord, seal } from './crypto'
import { deviceId } from './device-id'
import { forgetGame, onUpdateProgress, storedBuildVersion, updateGame } from './game-updater'
import { installHotkeys } from './hotkeys'
import { createAndroidProfile } from './profile'
import * as storage from './storage'
import { collectCodeAfterRedirect, openWebAuthInPopup } from './web-auth'

const STORE_KEY = 'rootStore'
const MASTER_KEY = 'masterPassword'
const MULTI_ACCOUNT_KEY = 'multiAccountState'

/**
 * Marks a promise as deliberately unawaited.
 *
 * `void promise` is the usual idiom for this and the repo's lint config rejects
 * it. Wrapping is better anyway: a rejection here - a failed write to IndexedDB,
 * say - would otherwise be swallowed with nothing to show for it.
 */
const detach = (promise: Promise<unknown>): void => {
  promise.catch((error) => console.error('lindo: una operación en segundo plano falló', error))
}

/**
 * The host holds its own copy of the store, exactly as the main process did.
 *
 * Something has to own the authoritative snapshot and write it down, and in
 * Electron that was main: it applied every patch, persisted the result and
 * relayed it to the other windows. Reproducing that here keeps the renderer
 * side - `client-store/root-store/setup-root-store.ts` - working unchanged,
 * echo-suppression and all.
 */
const rootStore = RootStoreModel.create({})
let hydrated = false

const hydrate = async (): Promise<void> => {
  if (hydrated) return
  hydrated = true
  const snapshot = await storage.get<RootStoreSnapshot>(STORE_KEY)
  if (snapshot) {
    try {
      applyPatch(rootStore, { op: 'replace', path: '', value: snapshot } as IJsonPatch)
    } catch (error) {
      console.error('lindo: snapshot guardado incompatible, se empieza limpio', error)
    }
  }
  // multi-account is stored encrypted under its own key, never in the snapshot -
  // the same exclusion `root-store-persist.ts` makes in the main process
  onSnapshot(rootStore, (next) => {
    const persisted = { ...next, optionStore: { ...next.optionStore, gameMultiAccount: undefined } }
    detach(storage.set(STORE_KEY, persisted))
  })

  await hydrateVersions()
}

/**
 * The versions the client reports about itself.
 *
 * On the desktop these are a side effect of the updater run. Nothing runs an
 * updater here, so without this the store keeps its model defaults and the game
 * footer reads `Client v1.0.0` - which is both wrong and, since it travels to
 * Ankama on every handshake, a claim no real client makes.
 *
 * `buildVersion` is read out of the bundle the updater actually stored, so it
 * cannot drift from what is being served.
 */
const ANDROID_APP_VERSION = '3.14.0'

const hydrateVersions = async (): Promise<void> => {
  rootStore.appStore.setAppVersion(ANDROID_APP_VERSION)
  const buildVersion = await storedBuildVersion()
  if (buildVersion) rootStore.appStore.setBuildVersion(buildVersion)
}

const logger: LindoLogger = {
  // the double call is the same contract as the desktop preload: the first call
  // records, and returns a bound console function so the second one prints with
  // the caller's line number intact
  error: (...args) => console.error.bind(console, ...args),
  warn: (...args) => console.warn.bind(console, ...args),
  info: (...args) => console.info.bind(console, ...args),
  debug: (...args) => console.debug.bind(console, ...args)
}

/** the key derived from the master password, held only in memory while unlocked */
let masterKey: CryptoKey | null = null

const isOptionPopup = () => window.location.hash.startsWith('#/option')

const muteEveryFrame = (value: boolean) => {
  // Electron muted the whole webContents. There is no equivalent here, and the
  // game plays through Web Audio rather than media elements, so this covers what
  // it can and no more.
  document.querySelectorAll('iframe').forEach((frame) => {
    try {
      frame.contentDocument?.querySelectorAll('audio, video').forEach((element) => {
        ;(element as HTMLMediaElement).muted = value
      })
    } catch {
      // a frame from another origin - nothing to do about it
    }
  })
}

export const createWebLindoAPI = async (): Promise<LindoAPI> => {
  await hydrate()
  const androidProfile = await createAndroidProfile()
  installHotkeys()

  // If the login took over the tab, the code is collected on the way back and
  // handed to the client the way it already expects: on its own URL. The
  // browser branch of the web-auth patch sets the flag that makes initialize()
  // read `?code=` off `window.location`, so nothing else has to be told.
  const recovered = await collectCodeAfterRedirect()
  const gameSrc = recovered
    ? `/game/index.html?delayed=true&code=${encodeURIComponent(recovered)}`
    : '/game/index.html?delayed=true'

  // patches arriving from another tab are applied to the authoritative store
  subscribe('patch', (message) => {
    try {
      applyPatch(rootStore, message.payload as IJsonPatch)
    } catch (error) {
      console.error('lindo: no se pudo aplicar un patch remoto', error)
    }
  })

  return {
    // ---- mobx ----
    forwardPatchToMain: (patch) => {
      try {
        applyPatch(rootStore, patch)
      } catch (error) {
        console.error('lindo: patch invalido', error)
      }
      publish({ type: 'patch', payload: patch })
    },
    fetchInitialStateAsync: async () => getSnapshot(rootStore) as RootStoreSnapshot,
    subscribeToIPCPatch: (notify) => subscribe('patch', (message) => notify(message.payload as IJsonPatch)),
    resetStore: () => {
      detach(storage.clear().then(() => window.location.reload()))
    },

    // ---- hotkeys ----
    subscribeToNewTab: (notify) => subscribeEverywhere('new-tab', () => notify()),
    subscribeToSelectTab: (notify) => subscribeEverywhere('select-tab', (message) => notify(message.index)),
    subscribeToNextTab: (notify) => subscribeEverywhere('next-tab', () => notify()),
    subscribeToPrevTab: (notify) => subscribeEverywhere('prev-tab', () => notify()),
    subscribeToCloseTab: (notify) => subscribeEverywhere('close-tab', () => notify()),

    // ---- updater ----
    subscribeToUpdateProgress: (notify) => {
      onUpdateProgress(notify)
    },

    // ---- context ----
    fetchGameContext: async (): Promise<GameContext> => ({
      gameSrc,
      characterImagesSrc: '/character-images/',
      changeLogSrc: '/CHANGELOG.md',
      windowId: 0,
      multiAccount: undefined,
      // el identificador de aparato, no un nombre de plataforma: de aquí sale
      // `window.key`, y de ahí el `uuid` que el cliente convierte en la clave
      // del certificado de Ankama Shield
      hash: deviceId(),
      platform: 'web',
      androidProfile
    }),
    appReadyToShow: () => undefined,
    fetchGameInfo: async () => {
      // the desktop posts this to a stats endpoint that is not configured
      // (LINDO_API is an empty string), so there is nothing to reproduce
      return undefined as unknown as GameContext
    },

    // ---- window ----
    openOptionWindow: () => {
      // a real second browsing context, like the second BrowserWindow it
      // replaces: the game keeps running, and the store stays in sync over the
      // same channel. A route change would unmount MainScreen and take the
      // game frame with it.
      window.open(`${window.location.pathname}#/option`, 'lindo-options', 'width=860,height=600')
    },
    focusCurrentWindow: () => window.focus(),
    closeOptionWindow: () => {
      if (isOptionPopup()) window.close()
      else publish({ type: 'close-option' })
    },
    setAudioMuteWindow: (value) => muteEveryFrame(value),

    // ---- multi account ----
    saveMasterPassword: async (masterPassword) => {
      const record = await createMasterRecord(masterPassword)
      await storage.set(MASTER_KEY, record)
      masterKey = await openMasterRecord(record, masterPassword)
      rootStore.optionStore.gameMultiAccount.setConfigured(true)
      rootStore.optionStore.gameMultiAccount.unlock()
    },
    removeMasterPassword: async () => {
      await storage.remove(MASTER_KEY)
      await storage.remove(MULTI_ACCOUNT_KEY)
      masterKey = null
      rootStore.optionStore.restoreGameMultiAccount({})
    },
    changeMasterPassword: async (masterPassword, oldPassword) => {
      const record = await storage.get<MasterRecord>(MASTER_KEY)
      if (!record) return false
      const oldKey = await openMasterRecord(record, oldPassword)
      if (!oldKey) return false

      const sealedState = await storage.get<string>(MULTI_ACCOUNT_KEY)
      const state = sealedState ? JSON.parse(await openSealed(oldKey, sealedState)) : undefined

      const nextRecord = await createMasterRecord(masterPassword)
      const nextKey = await openMasterRecord(nextRecord, masterPassword)
      if (!nextKey) return false

      if (state) {
        const characters = await Promise.all(
          (state.characters ?? []).map(async (character: { password: string }) => ({
            ...character,
            password: await seal(nextKey, await openSealed(oldKey, character.password))
          }))
        )
        await storage.set(MULTI_ACCOUNT_KEY, await seal(nextKey, JSON.stringify({ ...state, characters })))
      }
      await storage.set(MASTER_KEY, nextRecord)
      masterKey = nextKey
      return true
    },
    encryptCharacterPassword: async (characterPassword) => {
      if (!masterKey) throw new Error('Master password is not configured')
      return seal(masterKey, characterPassword)
    },
    decryptCharacterPassword: async (encrypted) => {
      if (!masterKey) throw new Error('Master password is not configured')
      return openSealed(masterKey, encrypted)
    },
    unlockApplication: async (masterPassword) => {
      const record = await storage.get<MasterRecord>(MASTER_KEY)
      if (!record) return false
      const key = await openMasterRecord(record, masterPassword)
      if (!key) return false
      masterKey = key

      const sealedState = await storage.get<string>(MULTI_ACCOUNT_KEY)
      if (sealedState) {
        rootStore.optionStore.restoreGameMultiAccount(JSON.parse(await openSealed(key, sealedState)))
        rootStore.optionStore.gameMultiAccount.setConfigured(true)
      }
      rootStore.optionStore.gameMultiAccount.unlock()
      return true
    },
    isMasterPasswordConfigured: async () => (await storage.get<MasterRecord>(MASTER_KEY)) !== undefined,
    saveCharacterImage: ({ image, name }: SaveCharacterImageArgs) => {
      // served back through the service worker registered in install.ts, so the
      // <img src> in CharacterCard keeps working untouched
      detach(storage.set(`character-image:${name}.png`, image))
    },
    closeUnlockWindow: () => publish({ type: 'close-unlock' }),
    selectTeamToConnect: (teamId) => publishLocal({ type: 'select-team', teamId }),

    // ---- auto-group ----
    subscribeToAutoGroupPathInstruction: (notify) =>
      subscribe('auto-group', (message) => notify(message.payload as FollowInstruction)),
    sendAutoGroupPathInstruction: (instruction) => publish({ type: 'auto-group', payload: instruction }),

    // ---- options ----
    resetGameData: () => {
      // the desktop deletes the game folder and relaunches, which makes the
      // updater fetch everything again; dropping the stored client does the same
      detach(forgetGame().then(() => window.location.reload()))
    },
    checkGameUpdate: () => {
      detach(
        updateGame().then((changed) => {
          if (changed) window.location.reload()
          else window.alert('El cliente ya está al día.')
        })
      )
    },
    clearCache: () => {
      detach(
        caches
          .keys()
          .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
          .then(() => window.location.reload())
      )
    },

    // ---- web auth ----
    openWebAuth: async (url) => openWebAuthInPopup(url),

    logger
  }
}

export { rootStore as hostRootStore }
