import { AndroidProfile } from './android-profile'

export interface MultiAccountContext {
  teamId: string
  teamWindowId: string
}

export interface GameContext {
  gameSrc: string
  characterImagesSrc: string
  windowId: number
  multiAccount?: MultiAccountContext
  changeLogSrc: string
  hash: string
  platform: string
  /**
   * The device the game frame has to present itself as. It is resolved in the
   * main process because the same values drive the request headers, and the two
   * must not be able to drift apart.
   */
  androidProfile: AndroidProfile
}
