import {
  GameContext,
  IPCEvents,
  RootStore,
  SaveCharacterImageArgs,
  GameTeamWindow,
  GameTeam,
  LANGUAGE_KEYS
} from '@lindo/shared'
import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron'
import express from 'express'
import getPort from 'get-port'
import { Server } from 'http'
import { observe } from 'mobx'
import { AddressInfo } from 'net'
import { APP_PATH, CHARACTER_IMAGES_PATH, GAME_PATH, LINDO_API } from './constants'
import fs from 'fs-extra'
import { getAppMenu } from './menu'
import { MultiAccount } from './multi-account'
import { runUpdater } from './updater'
import { GameWindow, OptionWindow, openWebAuthWindow } from './windows'
import path, { join } from 'path'
import cors from 'cors'
import { getAndroidProfile, I18n } from './utils'
import { logger, setupRendererLogger } from './logger'
import axios from 'axios'
import { Locales } from '@lindo/i18n'
import { platform } from 'os'
import { deviceId } from './device-id'

export class Application {
  private static _instance: Application
  private readonly _multiAccount: MultiAccount
  private readonly _i18n: I18n
  private readonly _hash: string

  static async init(rootStore: RootStore) {
    if (Application._instance) {
      throw new Error('Application already initialized')
    }

    const hash = deviceId()

    // create express server to serve game file
    const serveGameServer = express()
    serveGameServer.use(
      cors({
        origin: '*'
      })
    )
    // sin referer hacia fuera: static.ankama.com sirve las imágenes de noticias
    // detrás de una lista blanca de referers, y `http://localhost:<puerto>` no
    // está en ella. Va como cabecera además de como <meta> en el shell.
    serveGameServer.use((_request, response, next) => {
      response.setHeader('Referrer-Policy', 'same-origin')
      next()
    })
    serveGameServer.use('/game', express.static(GAME_PATH))
    serveGameServer.use('/renderer', express.static(join(import.meta.dirname, '../renderer/')))
    serveGameServer.use('/character-images', express.static(CHARACTER_IMAGES_PATH))
    serveGameServer.use('/changelog', express.static(APP_PATH + '/CHANGELOG.md'))
    const gameServerPort = await getPort({ port: 3000 })
    const gameServer: Server = serveGameServer.listen(gameServerPort)

    // set default language
    if (!rootStore.appStore._language) {
      const userLocal = app.getLocale()
      const userLang = userLocal.split('-')[0] as Locales
      console.log(userLang)
      if (LANGUAGE_KEYS.includes(userLang)) {
        rootStore.appStore.setLanguageKey(userLang)
      }
    }

    Application._instance = new Application(rootStore, gameServer, hash)
  }

  static get instance(): Application {
    if (!Application._instance) {
      throw new Error('Application not initialized')
    }
    return Application._instance
  }

  private _gWindows: Array<GameWindow> = []
  private _optionWindow?: OptionWindow

  private constructor(private _rootStore: RootStore, private _gameServer: Server, hash: string) {
    this._multiAccount = new MultiAccount(this._rootStore)
    this._i18n = new I18n(this._rootStore)
    this._hash = hash
  }

  async run() {
    // setup global IPC handlers
    this._setupIPCHandlers()

    // run updater
    await runUpdater(this._rootStore, this._i18n)

    // set the app menu
    this._setAppMenu()

    await this._initGameWindows()

    app.on('second-instance', () => {
      logger.debug('Application -> second-instance')
      if (this._gWindows.length) {
        // Focus on the main window if the user tried to open another
        if (this._gWindows[0].isMinimized()) this._gWindows[0].restore()
        this._gWindows[0].focus()
      }
    })

    app.on('activate', () => {
      logger.debug('Application -> activate')
      if (this._gWindows.length) {
        this._gWindows[0].focus()
      } else {
        this.createGameWindow()
      }
    })
  }

  private async _initGameWindows() {
    const multiAccountEnabled = await this._multiAccount.isEnabled()
    if (multiAccountEnabled) {
      try {
        const selectedTeamId = await this._multiAccount.unlockWithTeam()
        const team = this._rootStore.optionStore.gameMultiAccount.selectTeamById(selectedTeamId)
        if (!team) {
          throw new Error('Team not found')
        }
        for (const window of team.windows) {
          this.createGameWindow(team, window)
        }
      } catch (e) {
        console.log(e)
        logger.warn('MultiAccount canceled')

        this.createGameWindow()
      }
    } else {
      this.createGameWindow()
    }
    observe(
      this._rootStore.optionStore.window,
      'audioMuted',
      () => {
        for (const gWindow of this._gWindows) {
          gWindow.setAudioMute(this._rootStore.optionStore.window.audioMuted)
        }
      },
      true
    )
  }

  private _setAppMenu() {
    Menu.setApplicationMenu(getAppMenu(this._rootStore, this._i18n))
    logger.debug('Application -> _setAppMenu')
    observe(this._rootStore.hotkeyStore.window, (change) => {
      logger.debug('Application -> _setAppMenu')
      if (change.type === 'update') {
        Menu.setApplicationMenu(getAppMenu(this._rootStore, this._i18n))
      }
    })
    this._i18n.on('localeChanged', () => {
      Menu.setApplicationMenu(getAppMenu(this._rootStore, this._i18n))
    })
  }

  async createGameWindow(team?: GameTeam, teamWindow?: GameTeamWindow) {
    const index = this._gWindows.length
    logger.debug('Application -> _createGameWindow ' + index)
    const serverAddress: AddressInfo = this._gameServer.address() as AddressInfo
    const gWindow = await GameWindow.init({
      index,
      url: 'http://localhost:' + serverAddress.port + '/renderer/index.html',
      store: this._rootStore,
      team,
      teamWindow
    })
    gWindow.on('close', () => {
      this._gWindows.splice(this._gWindows.indexOf(gWindow), 1)
      if (this._gWindows.length === 0) {
        if (process.platform !== 'darwin') app.quit()
      }
    })
    this._gWindows.push(gWindow)
  }

  openOptionWindow() {
    logger.debug('Application -> openOptionWindow')
    if (this._optionWindow) {
      this._optionWindow.focus()
      return
    }
    this._optionWindow = new OptionWindow()
    this._optionWindow.on('close', () => {
      this._optionWindow = undefined
    })
  }

  private _setupIPCHandlers() {
    // logger handler
    setupRendererLogger()

    // handlers
    ipcMain.handle(IPCEvents.GET_GAME_CONTEXT, async (event) => {
      const serverAddress: AddressInfo = this._gameServer.address() as AddressInfo
      const gWindow = this._gWindows.find((gWindow) => gWindow.id === event.sender.id)
      const context: GameContext = {
        gameSrc: 'http://localhost:' + serverAddress.port + '/game/index.html?delayed=true',
        characterImagesSrc: 'http://localhost:' + serverAddress.port + '/character-images/',
        changeLogSrc: 'http://localhost:' + serverAddress.port + '/changelog',
        windowId: event.sender.id,
        multiAccount: gWindow?.multiAccount,
        hash: this._hash,
        platform: platform(),
        // the window owns the profile because its request headers are built from
        // the same object; falling back to a fresh one would let the frame and
        // the headers describe two different devices
        androidProfile: gWindow ? gWindow.androidProfile : await getAndroidProfile()
      }
      return JSON.stringify(context)
    })

    ipcMain.on(IPCEvents.OPEN_OPTION, () => {
      this.openOptionWindow()
    })

    ipcMain.on(IPCEvents.CLOSE_OPTION, () => {
      if (this._optionWindow) {
        this._optionWindow.close()
      }
    })

    ipcMain.on(IPCEvents.RESET_STORE, () => {
      this._rootStore.reset()
    })

    ipcMain.on(IPCEvents.SAVE_CHARACTER_IMAGE, (event, { image, name }: SaveCharacterImageArgs) => {
      const base64Data = image.replace(/^data:image\/png;base64,/, '')
      fs.mkdirSync(CHARACTER_IMAGES_PATH, { recursive: true })
      fs.writeFile(path.join(CHARACTER_IMAGES_PATH, `${name}.png`), base64Data, 'base64', (err) => {
        logger.error(err)
      })
    })

    ipcMain.on(IPCEvents.TOGGLE_MAXIMIZE_WINDOW, (event) => {
      logger.debug('Application -> TOGGLE_MAXIMIZE_WINDOW')
      const gWindow = this._gWindows.find((gWindow) => gWindow.id === event.sender.id)
      if (gWindow) {
        gWindow.toggleMaximize()
      }
    })

    ipcMain.on(IPCEvents.AUTO_GROUP_PUSH_PATH, (event, instruction) => {
      logger.debug('Application -> AUTO_GROUP_PUSH_PATH')
      for (const gWindow of this._gWindows) {
        gWindow.sendAutoGroupInstruction(instruction)
      }
    })

    ipcMain.on(IPCEvents.FOCUS_WINDOW, (event) => {
      logger.debug('Application -> FOCUS_WINDOW')
      const gWindow = this._gWindows.find((gWindow) => gWindow.id === event.sender.id)
      if (gWindow) {
        gWindow.focus()
      }
    })

    ipcMain.handle(IPCEvents.FETCH_GAME_CONTEXT, (event, context: string) => {
      logger.debug('Application -> FETCH_GAME_CONTEXT')
      return axios
        .post(LINDO_API + 'stats/stats.php', context)
        .then((res) => {
          return !!res.data
        })
        .catch(() => true)
    })

    ipcMain.on(IPCEvents.AUDIO_MUTE_WINDOW, (event, value) => {
      logger.debug('Application -> AUDIO_MUTE_WINDOW')
      const gWindow = this._gWindows.find((gWindow) => gWindow.id === event.sender.id)
      if (gWindow) {
        gWindow.setAudioMute(value)
      }
    })

    ipcMain.on(IPCEvents.CHECK_GAME_UPDATE, () => {
      logger.debug('Application -> CHECK_GAME_UPDATE')
      // the updater only runs at startup, and it already downloads just what the
      // manifests say changed - so asking for a check is asking for a restart
      app.relaunch()
      app.quit()
    })

    ipcMain.on(IPCEvents.RESET_GAME_DATA, () => {
      logger.debug('Application -> RESET_GAME_DATA')
      fs.rmSync(GAME_PATH, { recursive: true, force: true })
      app.relaunch()
      app.quit()
    })

    ipcMain.handle(IPCEvents.OPEN_WEB_AUTH, (event, authUrl: string) => {
      logger.debug('Application -> OPEN_WEB_AUTH')
      // only ever open Ankama's own auth host: this URL is built inside the
      // game bundle, so it must not be able to point the window anywhere else
      let host: string
      try {
        host = new URL(authUrl).host
      } catch {
        return { error: 'Invalid authentication URL' }
      }
      if (host !== 'auth.ankama.com') {
        logger.warn(`Application -> refused web auth for unexpected host ${host}`)
        return { error: `Unexpected authentication host ${host}` }
      }
      return openWebAuthWindow(authUrl, BrowserWindow.fromWebContents(event.sender))
    })

    ipcMain.on(IPCEvents.CLEAR_CACHE, async () => {
      logger.debug('Application -> CLEAR_CACHE')
      Promise.all(this._gWindows.map((gWindow) => gWindow.clearCache())).finally(() => {
        dialog
          .showMessageBox(BrowserWindow.getFocusedWindow()!, {
            type: 'info',
            title: this._i18n.LL.main.dialogs.cacheCleared.title(),
            message: this._i18n.LL.main.dialogs.cacheCleared.message(),
            buttons: ['OK']
          })
          .then(() => {
            app.exit()
          })
      })
    })
  }
}
