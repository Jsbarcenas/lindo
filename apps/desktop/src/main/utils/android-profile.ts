import crypto from 'crypto'
import { AndroidProfile } from '@lindo/shared'

/**
 * The devices the client can present itself as.
 *
 * The old pool held 5080 scraped strings and drew one at random. A fifth of
 * them were `Dalvik/...` - the Android HTTP stack, not a browser - which the
 * bundle's own UAParser does not resolve to an OS at all, so the game decided
 * the client was not Android and the choice stuck for up to 360 days. The rest
 * topped out at Chrome 97, a version no phone still runs.
 *
 * A short curated list is easier to keep coherent: every entry here is a real
 * browser on a real device, and each field below can be checked against the
 * others. Refresh the Chrome versions once a year or so.
 */
interface DeviceTemplate {
  model: string
  manufacturer: string
  androidVersion: string
  chromeVersion: string
  screenWidth: number
  screenHeight: number
  devicePixelRatio: number
  glVendor: string
  glRenderer: string
  cores: number
  memory: number
}

const DEVICES: ReadonlyArray<DeviceTemplate> = [
  {
    model: 'Pixel 8',
    manufacturer: 'Google',
    androidVersion: '15',
    chromeVersion: '139.0.7258.123',
    screenWidth: 412,
    screenHeight: 915,
    devicePixelRatio: 2.625,
    glVendor: 'ARM',
    glRenderer: 'Mali-G715-Immortalis MC11',
    cores: 9,
    memory: 8
  },
  {
    model: 'Pixel 7',
    manufacturer: 'Google',
    androidVersion: '14',
    chromeVersion: '138.0.7204.157',
    screenWidth: 412,
    screenHeight: 915,
    devicePixelRatio: 2.625,
    glVendor: 'ARM',
    glRenderer: 'Mali-G710 MC10',
    cores: 8,
    memory: 8
  },
  {
    model: 'SM-S918B',
    manufacturer: 'samsung',
    androidVersion: '14',
    chromeVersion: '139.0.7258.123',
    screenWidth: 384,
    screenHeight: 824,
    devicePixelRatio: 3.75,
    glVendor: 'Qualcomm',
    glRenderer: 'Adreno (TM) 740',
    cores: 8,
    memory: 8
  },
  {
    model: 'SM-A546B',
    manufacturer: 'samsung',
    androidVersion: '14',
    chromeVersion: '137.0.7151.89',
    screenWidth: 360,
    screenHeight: 772,
    devicePixelRatio: 3,
    glVendor: 'ARM',
    glRenderer: 'Mali-G68 MC4',
    cores: 8,
    memory: 6
  },
  {
    model: '2201123G',
    manufacturer: 'Xiaomi',
    androidVersion: '13',
    chromeVersion: '138.0.7204.157',
    screenWidth: 393,
    screenHeight: 851,
    devicePixelRatio: 2.75,
    glVendor: 'Qualcomm',
    glRenderer: 'Adreno (TM) 730',
    cores: 8,
    memory: 8
  },
  {
    model: 'Pixel 6a',
    manufacturer: 'Google',
    androidVersion: '14',
    chromeVersion: '137.0.7151.89',
    screenWidth: 412,
    screenHeight: 892,
    devicePixelRatio: 2.625,
    glVendor: 'ARM',
    glRenderer: 'Mali-G78 MC20',
    cores: 8,
    memory: 6
  }
]

/**
 * Chrome on Android puts the build id in the model only for some vendors, and
 * never for Pixels. Reproducing that is not worth a branch: the plain form is
 * what current Chrome sends on every device listed above.
 */
const buildUserAgent = (device: DeviceTemplate): string =>
  `Mozilla/5.0 (Linux; Android ${device.androidVersion}; ${device.model}) AppleWebKit/537.36 ` +
  `(KHTML, like Gecko) Chrome/${device.chromeVersion} Mobile Safari/537.36`

export const createAndroidProfile = (): AndroidProfile => {
  const device = DEVICES[crypto.randomInt(0, DEVICES.length)]

  return {
    userAgent: buildUserAgent(device),
    androidVersion: device.androidVersion,
    chromeVersion: device.chromeVersion,
    chromeMajor: device.chromeVersion.split('.')[0],
    model: device.model,
    manufacturer: device.manufacturer,
    // every Android build since Nougat reports this exact string, including on
    // 64-bit devices - it is not derived from the actual ABI
    navigatorPlatform: 'Linux armv8l',
    screenWidth: device.screenWidth,
    screenHeight: device.screenHeight,
    devicePixelRatio: device.devicePixelRatio,
    glVendor: device.glVendor,
    glRenderer: device.glRenderer,
    cores: device.cores,
    memory: device.memory
  }
}

/**
 * The `Sec-CH-UA*` request headers matching a profile.
 *
 * Chromium builds these from its own identity and ignores `setUserAgent`, so
 * they contradicted the User-Agent and were being deleted outright to hide the
 * contradiction. An Android User-Agent arriving with no client hints at all is
 * itself a shape no real phone produces, so they are set instead.
 *
 * The brand list carries a deliberately meaningless third entry: that is what
 * GREASE is, and a list without one looks synthetic.
 */
export const clientHintHeaders = (profile: AndroidProfile): Record<string, string> => ({
  'sec-ch-ua': `"Chromium";v="${profile.chromeMajor}", "Google Chrome";v="${profile.chromeMajor}", "Not?A_Brand";v="24"`,
  'sec-ch-ua-mobile': '?1',
  'sec-ch-ua-platform': '"Android"',
  'sec-ch-ua-platform-version': `"${profile.androidVersion}.0.0"`,
  'sec-ch-ua-model': `"${profile.model}"`,
  // a capture showed these two arriving empty: they were simply never set here,
  // so a server that asked for the full high-entropy set got a partial answer -
  // which is a stranger shape than not answering at all
  'sec-ch-ua-arch': '"arm"',
  'sec-ch-ua-bitness': '"64"',
  'sec-ch-ua-full-version': `"${profile.chromeVersion}"`,
  'sec-ch-ua-full-version-list': `"Chromium";v="${profile.chromeVersion}", "Google Chrome";v="${profile.chromeVersion}", "Not?A_Brand";v="24.0.0.0"`
})

/**
 * The order Chrome puts these in, ahead of User-Agent.
 *
 * Assigning onto the incoming header object appends instead, which left
 * `sec-ch-ua` after `user-agent` - an order no browser produces. Whether
 * Chromium preserves what is handed back here is not documented, so this is
 * worth exactly one capture to confirm; if the order comes back unchanged, the
 * signal belongs to the network layer after all.
 */
export const orderedRequestHeaders = (
  requestHeaders: Record<string, string>,
  profile: AndroidProfile
): Record<string, string> => {
  const hints = clientHintHeaders(profile)
  const ordered: Record<string, string> = {}

  for (const name of ['Host', 'Connection', 'Content-Length']) {
    if (requestHeaders[name] !== undefined) ordered[name] = requestHeaders[name]
  }
  for (const [name, value] of Object.entries(hints)) ordered[name] = value
  if (requestHeaders['User-Agent'] !== undefined) ordered['User-Agent'] = requestHeaders['User-Agent']

  for (const [name, value] of Object.entries(requestHeaders)) {
    if (ordered[name] === undefined && hints[name.toLowerCase()] === undefined) ordered[name] = value
  }

  return ordered
}
