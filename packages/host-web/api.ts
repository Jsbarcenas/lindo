import {
  FollowInstruction,
  GameContext,
  LindoAPI,
  LindoLogger,
  RootStoreModel,
  RootStoreSnapshot,
  SaveCharacterImageArgs,
  WebAuthResult
} from '@lindo/shared'
import { applyPatch, getSnapshot, IJsonPatch, onSnapshot } from 'mobx-state-tree'
import { publish, publishLocal, subscribe, subscribeEverywhere } from './channel'
import { createMasterRecord, MasterRecord, open as openSealed, openMasterRecord, seal } from './crypto'
import { installHotkeys } from './hotkeys'
import { createAndroidProfile } from './profile'
import * as storage from './storage'

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
 * `buildVersion` is read out of the bundle that `fetch-game.mjs` actually
 * downloaded, so it cannot drift from what is being served.
 */
const ANDROID_APP_VERSION = '3.14.0'

const hydrateVersions = async (): Promise<void> => {
  rootStore.appStore.setAppVersion(ANDROID_APP_VERSION)
  try {
    const response = await fetch('/game/versions.json')
    const versions = (await response.json()) as { buildVersion?: string }
    if (versions.buildVersion) rootStore.appStore.setBuildVersion(versions.buildVersion)
  } catch (error) {
    console.warn('lindo: no se pudo leer /game/versions.json', error)
  }
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

/**
 * Ankama's login, as far as a browser can take it.
 *
 * The desktop opens the login in a window it owns and catches the redirect to
 * `dofustouch://authorized`. Neither half of that is available here: a page
 * cannot register a custom scheme, and it cannot ask for its own URL as the
 * redirect either - Ankama validates `redirect_uri` against what is registered
 * for the client and answers with an error page for anything else. Pointing it
 * at this origin was tried and rejected; pointing it at Ankama's own registered
 * redirect renders the login form normally.
 *
 * So the login runs in a popup and ends on Ankama's page with `?code=` in its
 * URL - readable by the person looking at it, not by this origin. The last step
 * is theirs. It is one paste, and it is the only part of the desktop flow that
 * does not survive the move to a browser.
 */
const RETURNING_FROM_AUTH = 'lindo:returning-from-auth'

/**
 * Asks for the code once, on the way back from a login that took over the tab.
 *
 * Called during install, before anything renders, so the prompt is the first
 * thing seen after coming back rather than something that interrupts later.
 */
export const collectCodeAfterRedirect = (): string | undefined => {
  if (window.sessionStorage.getItem(RETURNING_FROM_AUTH) !== '1') return undefined
  window.sessionStorage.removeItem(RETURNING_FROM_AUTH)
  const answer = window.prompt(AUTH_PROMPT)
  return answer ? extractCode(answer) : undefined
}

const AUTH_PROMPT = 'Pega aquí la URL a la que llegaste al terminar el login en Ankama.\nEs la que contiene "?code=".'

const extractCode = (answer: string): string | undefined => {
  const match = /[?&]code=([^&\s]+)/.exec(answer)?.[1]
  const bare = /^[\w-]{8,}$/.test(answer.trim()) ? answer.trim() : undefined
  const code = match ?? bare
  return code ? decodeURIComponent(code) : undefined
}

const openWebAuthInPopup = async (url: string): Promise<WebAuthResult> => {
  const popup = window.open(url, 'lindo-auth', 'width=520,height=720')
  if (!popup) {
    // The game reaches this through its own promise chain, so the click that
    // started it is no longer the current task and the popup can be blocked.
    // Taking over this window instead is not a downgrade: the store lives in
    // IndexedDB and survives the trip, and the login page has to be top level
    // anyway - its challenge fails when framed.
    window.sessionStorage.setItem(RETURNING_FROM_AUTH, '1')
    window.location.href = url
    return { cancelled: true }
  }

  // resolves when the person closes the popup, which is the only signal this
  // origin gets: everything the popup does after leaving here is cross-origin
  await new Promise<void>((resolve) => {
    const timer = window.setInterval(() => {
      if (popup.closed) {
        window.clearInterval(timer)
        resolve()
      }
    }, 500)
  })

  const answer = window.prompt(AUTH_PROMPT)
  if (!answer) return { cancelled: true }

  const code = extractCode(answer)
  if (!code) return { error: 'No encontré ningún "code" en lo que pegaste.' }
  return { code }
}

export const createWebLindoAPI = async (): Promise<LindoAPI> => {
  await hydrate()
  const androidProfile = await createAndroidProfile()
  installHotkeys()

  // If the login took over the tab, the code is collected on the way back and
  // handed to the client the way it already expects: on its own URL. The
  // browser branch of the web-auth patch sets the flag that makes initialize()
  // read `?code=` off `window.location`, so nothing else has to be told.
  const recovered = collectCodeAfterRedirect()
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
    // there is no updater on the web: deploying is updating. The screen that
    // consumes this simply never advances, which is why nothing routes to it.
    subscribeToUpdateProgress: () => undefined,

    // ---- context ----
    fetchGameContext: async (): Promise<GameContext> => ({
      gameSrc,
      characterImagesSrc: '/character-images/',
      changeLogSrc: '/CHANGELOG.md',
      windowId: 0,
      multiAccount: undefined,
      hash: 'web',
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
      detach(storage.clear().then(() => window.location.reload()))
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
