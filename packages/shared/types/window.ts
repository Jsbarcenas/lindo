import { LindoAPI, LindoTitleBar } from './lindo-api'

/**
 * The contract a host has to satisfy for the client code to run.
 *
 * This used to sit in the renderer as `global.d.ts`, which was fine while every
 * consumer lived in that one directory. Now that the store, the mods and the UI
 * are packages of their own, each has to see this declaration to typecheck on
 * its own, and none of them can reach into an app to get it. It lives here
 * because `@lindo/shared` is what already owns `LindoAPI` itself.
 *
 * Declaring it says nothing about who provides it: Electron does it from the
 * preload over contextBridge, and any other host would have to supply its own.
 */
declare global {
  // eslint-disable-next-line no-unused-vars
  interface Window {
    lindoAPI: LindoAPI
    buildVersion: string
    appVersion: string
    lindoVersion: string
    key?: string
    titleBar?: LindoTitleBar
  }
}

export {}
