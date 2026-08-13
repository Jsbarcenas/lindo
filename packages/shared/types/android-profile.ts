/**
 * Every platform signal the client presents, derived from one source.
 *
 * These used to be decided independently - the User-Agent was drawn at random,
 * the client hints were stripped, `navigator.*` was left untouched and
 * `window.device` never existed at all. A checker does not read one signal, it
 * reads several and compares them, so any disagreement between them identifies
 * the client more reliably than a single wrong value would.
 *
 * Keeping them in one object means they can only be set together.
 */
export interface AndroidProfile {
  /** full User-Agent string, the value every other field has to agree with */
  userAgent: string
  /** "15", "14" - the Android release named in the User-Agent */
  androidVersion: string
  /** full Chrome version, e.g. "139.0.7258.123" */
  chromeVersion: string
  /** major only, e.g. "139" - what the Sec-CH-UA brand list carries */
  chromeMajor: string
  /** device model as it appears in the User-Agent, e.g. "Pixel 8" */
  model: string
  /** Cordova's device.manufacturer */
  manufacturer: string
  /** what navigator.platform reports on Android Chrome */
  navigatorPlatform: string
  /** CSS pixels, not physical ones - this is what screen.width returns */
  screenWidth: number
  screenHeight: number
  devicePixelRatio: number
  /** WebGL WEBGL_debug_renderer_info strings */
  glVendor: string
  glRenderer: string
  /** navigator.hardwareConcurrency / navigator.deviceMemory */
  cores: number
  memory: number
}
