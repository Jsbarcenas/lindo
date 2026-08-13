import { app } from 'electron'
import { join } from 'path'

export const APP_PATH = app.getAppPath()
export const LOGS_PATH = app.getPath('logs')
export const GAME_PATH = app.getPath('userData') + '/game/'
export const CHARACTER_IMAGES_PATH = app.getPath('userData') + '/character-images/'
export const LINDO_API = ''
export { DOFUS_ORIGIN, DOFUS_EARLY_ORIGIN } from '@lindo/shared'
export const DOFUS_ITUNES_ORIGIN = 'https://itunes.apple.com/lookup?id=1041406978&t=' + new Date().getTime()

/**
 * The version the Android build of Dofus Touch reports.
 *
 * The client declares itself as `client: "android"` but was sending the version
 * looked up from Apple's App Store, which is a different release train: the
 * store build of com.ankama.dofustouch was at 3.14.0 while iTunes answered
 * 3.11.0. Claiming one platform and reporting the other one's version is a
 * mismatch the client hands over on every handshake.
 *
 * Pinned rather than fetched: Google exposes no equivalent lookup endpoint, and
 * scraping the store page returns "varies with device" often enough that a
 * correct fixed value beats a live one that is sometimes wrong. Refresh it with
 *
 *   adb shell dumpsys package com.ankama.dofustouch | grep versionName
 */
export const DOFUS_ANDROID_APP_VERSION = '3.14.0'
export const LOCAL_ASSET_MAP_PATH = GAME_PATH + 'assetMap.json'
export const LOCAL_LINDO_MANIFEST_PATH = GAME_PATH + 'lindoManifest.json'
export const LOCAL_DOFUS_MANIFEST_PATH = GAME_PATH + 'manifest.json'

// Local game-base files (manifest, regex patches and game shell)
export const GAME_BASE_PATH = join(APP_PATH, 'game-base')
export const LINDO_MANIFEST_PATH = join(GAME_BASE_PATH, 'manifest.json')

// the dofus origin is resolved at runtime, both origins expose the same endpoints
export const dofusManifestUrl = (origin: string) => origin + 'manifest.json'
export const dofusAssetMapUrl = (origin: string) => origin + 'assetMap.json'
export const LOCAL_VERSIONS_PATH = GAME_PATH + 'versions.json'
export const LOCAL_REGEX_PATH = GAME_PATH + 'regex.json'

// GitHub: where this build looks for its own updates.
export const GITHUB_OWNER = 'Jsbarcenas'
export const GITHUB_REPO = 'lindo'
export const GITHUB_LATEST_RELEASE_URL = 'https://github.com/' + GITHUB_OWNER + '/' + GITHUB_REPO + '/releases/latest'
