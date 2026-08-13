import { AndroidProfile } from '@lindo/shared'

/**
 * The device the game frame presents itself as, resolved in the browser.
 *
 * The desktop build derives the browser version from `process.versions.chrome`
 * so the User-Agent, the client hints and the TLS handshake all name the same
 * Chromium. On the web only the JS layer is ours - a page cannot set its own
 * User-Agent, client hints or TLS fingerprint - but the same reasoning applies
 * to what it *can* set: the version claimed inside the frame has to match the
 * engine running it, or the frame contradicts its own host.
 *
 * `userAgentData` is the reliable source and needs no parsing; the User-Agent
 * string is the fallback for engines without it.
 */
const DEVICE = {
  model: 'SM-A546B',
  manufacturer: 'samsung',
  androidVersion: '14',
  screenWidth: 360,
  screenHeight: 772,
  devicePixelRatio: 3,
  glVendor: 'ARM',
  glRenderer: 'Mali-G68 MC4',
  cores: 8,
  memory: 6
}

const chromiumVersion = async (): Promise<string> => {
  const uaData = (navigator as Navigator & { userAgentData?: NavigatorUAData }).userAgentData
  if (uaData?.getHighEntropyValues) {
    try {
      const values = await uaData.getHighEntropyValues(['uaFullVersion'])
      if (values.uaFullVersion) return values.uaFullVersion
    } catch {
      // falls through to the User-Agent below
    }
  }
  return /Chrome\/([\d.]+)/.exec(navigator.userAgent)?.[1] ?? '150.0.0.0'
}

interface NavigatorUAData {
  getHighEntropyValues?: (hints: string[]) => Promise<{ uaFullVersion?: string }>
}

export const createAndroidProfile = async (): Promise<AndroidProfile> => {
  const chromeVersion = await chromiumVersion()
  return {
    userAgent:
      `Mozilla/5.0 (Linux; Android ${DEVICE.androidVersion}; ${DEVICE.model}) AppleWebKit/537.36 ` +
      `(KHTML, like Gecko) Chrome/${chromeVersion} Mobile Safari/537.36`,
    androidVersion: DEVICE.androidVersion,
    chromeVersion,
    chromeMajor: chromeVersion.split('.')[0],
    model: DEVICE.model,
    manufacturer: DEVICE.manufacturer,
    navigatorPlatform: 'Linux armv8l',
    screenWidth: DEVICE.screenWidth,
    screenHeight: DEVICE.screenHeight,
    devicePixelRatio: DEVICE.devicePixelRatio,
    glVendor: DEVICE.glVendor,
    glRenderer: DEVICE.glRenderer,
    cores: DEVICE.cores,
    memory: DEVICE.memory
  }
}
