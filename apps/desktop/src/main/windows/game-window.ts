import {
  AndroidProfile,
  FollowInstruction,
  GameTeam,
  GameTeamWindow,
  IPCEvents,
  matchesAccelerator,
  MultiAccountContext,
  RootStore
} from '@lindo/shared'
import { app, BeforeSendResponse, BrowserWindow, Event, shell } from 'electron'
import { attachTitlebarToWindow } from 'custom-electron-titlebar/main'
import { join } from 'path'
import { EventEmitter } from 'events'
import TypedEmitter from 'typed-emitter'
import { generateUserArgent, getAndroidProfile, orderedRequestHeaders } from '../utils'
import { logger } from '../logger'
import { platform } from 'os'

type GameWindowEvents = {
  close: (event: Event) => void
}
export class GameWindow extends (EventEmitter as new () => TypedEmitter<GameWindowEvents>) {
  private readonly _win: BrowserWindow
  private readonly _store: RootStore
  private readonly _teamWindow?: GameTeamWindow
  private readonly _team?: GameTeam
  private _isMuted = false
  private readonly _index: number
  private readonly _androidProfile: AndroidProfile

  get id() {
    return this._win.webContents.id!
  }

  get androidProfile(): AndroidProfile {
    return this._androidProfile
  }

  get multiAccount(): MultiAccountContext | undefined {
    if (this._teamWindow && this._team) {
      return {
        teamWindowId: this._teamWindow.id,
        teamId: this._team.id
      }
    }
  }

  private constructor({
    index,
    userAgent,
    androidProfile,
    store,
    team,
    url,
    teamWindow
  }: {
    index: number
    userAgent: string
    androidProfile: AndroidProfile
    store: RootStore
    url: string
    team?: GameTeam
    teamWindow?: GameTeamWindow
  }) {
    super()
    this._index = index
    this._androidProfile = androidProfile
    this._store = store
    this._teamWindow = teamWindow
    this._team = team
    this._win = new BrowserWindow({
      show: false,
      resizable: true,
      frame: platform() !== 'linux',
      title: 'Lindo',
      fullscreenable: true,
      fullscreen: this._store.optionStore.window.fullScreen,
      width: this._store.optionStore.window.resolution.width,
      height: this._store.optionStore.window.resolution.height,
      titleBarStyle: 'hidden',
      webPreferences: {
        preload: join(import.meta.dirname, '../preload/index.cjs'),
        backgroundThrottling: false,
        partition: 'persist:' + this._index,
        sandbox: false,
        allowRunningInsecureContent: true,
        // Enable local iframe window access for client renderers
        webSecurity: false
      }
    })

    // A session keeps a single onBeforeSendHeaders listener: registering a second
    // one silently replaces the first. Both rewrites must share this handler.
    this._win.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
      const requestHeaders = { ...(details.requestHeaders ?? {}) }

      /**
       * Sin referer hacia el CDN de contenidos de Ankama.
       *
       * `static.ankama.com` sirve las imágenes del carrusel de noticias detrás
       * de una lista blanca de referers y contesta 403 -con `content-type:
       * text/html`, que el navegador además bloquea por ORB- a cualquiera que
       * no sea suyo. El cliente real corre sobre `file://` y no manda ninguno.
       *
       * Se hace aquí y no declarando la política en el documento porque Chrome
       * no aplica la del documento a las peticiones que nacen de CSS, y estas
       * nacen de un `background-image`. Medido: la misma URL pedida con
       * `new Image()` sale con `same-origin` y sin referer, y pedida por CSS
       * sale con la política por defecto y con él. En la capa de red no existe
       * esa distinción, y por eso este es el sitio.
       */
      if (details.url.startsWith('https://static.ankama.com/')) {
        delete requestHeaders.Referer
      }

      // Chromium derives the client hints from its own identity and ignores
      // setUserAgent, so they used to contradict the User-Agent and were deleted
      // to hide it. Deleting them is not neutral: current Chrome on Android
      // always sends them, so an Android User-Agent arriving without any is a
      // shape no phone produces. They are overwritten to match the profile
      // instead. Sec-Fetch-* are left alone - they describe the request, not the
      // device, and stripping them is the same kind of tell.
      //
      // Rebuilt in order rather than assigned onto: assigning appended the ones
      // that were not already present, so a capture showed them arriving after
      // `cookie`, at the end of the request.
      const beforeSendResponse: BeforeSendResponse = {
        requestHeaders: orderedRequestHeaders(requestHeaders, androidProfile)
      }
      callback(beforeSendResponse)
    })

    // Show window when page is ready
    this._win.webContents.on('ipc-message', (event, channel) => {
      if (channel === IPCEvents.APP_READY_TO_SHOW) {
        setTimeout(() => {
          this._win.show()
        }, 100)
      }
    })

    this._win.webContents.setUserAgent(userAgent)

    this._win.webContents.setAudioMuted(this._store.optionStore.window.audioMuted)

    this._win.on('close', (event) => {
      logger.debug('GameWindow -> close')
      this._close(event)
    })

    this._win.on('focus', () => {
      if (this._store.optionStore.window.audioMuted || this._isMuted) {
        this._win.webContents.setAudioMuted(true)
        return
      }
      this._win.webContents.setAudioMuted(false)
    })

    this._win.on('blur', () => {
      if (this._store.optionStore.window.audioMuted || this._isMuted) {
        this._win.webContents.setAudioMuted(true)
        return
      }
      if (this._store.optionStore.window.soundOnFocus) {
        this._win.webContents.setAudioMuted(true)
      }
    })

    // Tab shortcuts read the store on every keystroke rather than being
    // re-registered when it changes, so there is nothing to keep in sync.
    const isMac = platform() === 'darwin'
    this._win.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return

      const tabs = this._store.hotkeyStore.window.tabs
      for (let index = 0; index < tabs.length; index++) {
        const accelerator = tabs[index]
        if (accelerator && matchesAccelerator(accelerator, input, isMac)) {
          // keep the shortcut from reaching the game, as registering it did
          event.preventDefault()
          this._win.webContents.send(IPCEvents.SELECT_TAB, index)
          return
        }
      }
    })

    if (app.isPackaged) {
      this._win.loadURL(url)
    } else {
      // 🚧 Use ['ENV_NAME'] avoid vite:define plugin

      // eslint-disable-next-line dot-notation
      const url = `http://${process.env['VITE_DEV_SERVER_HOST']}:${process.env['VITE_DEV_SERVER_PORT']}`

      this._win.loadURL(url)
      if (process.env.NODE_ENV === 'development') {
        this._win.webContents.openDevTools({ mode: 'detach' })
      }
    }
    // Make all links open with the browser, not with the application
    this._win.webContents.setWindowOpenHandler(({ url }) => {
      // Handle authentication flow in-app
      if (url.startsWith('https://auth.ankama.com/')) {
        logger.error('GameWindow -> Ankama login tried to open externally, refusing; the web auth patch is not applied')
        return { action: 'deny' }
      }
      if (url.startsWith('https:')) shell.openExternal(url)
      return { action: 'deny' }
    })

    attachTitlebarToWindow(this._win)
  }

  static async init({
    index,
    store,
    team,
    url,
    teamWindow
  }: {
    index: number
    store: RootStore
    url: string
    team?: GameTeam
    teamWindow?: GameTeamWindow
  }): Promise<GameWindow> {
    const userAgent = await generateUserArgent(store.appStore.appVersion)
    const androidProfile = await getAndroidProfile()
    return new GameWindow({ index, url, userAgent, androidProfile, store, team, teamWindow })
  }

  private _close(event: Event) {
    this._win.removeAllListeners()
    this.emit('close', event)
  }

  focus = () => this._win.focus()
  isMinimized = () => this._win.isMinimized()
  restore = () => this._win.restore()

  toggleMaximize() {
    return this._win.isMaximized() ? this._win.unmaximize() : this._win.maximize()
  }

  setAudioMute(value: boolean) {
    this._isMuted = value
    this._win.webContents.setAudioMuted(value)
  }

  sendAutoGroupInstruction(instruction: FollowInstruction) {
    this._win.webContents.send(IPCEvents.AUTO_GROUP_PUSH_PATH, instruction)
  }

  clearCache() {
    return this._win.webContents.session.clearCache()
  }
}
