import { useEffect, useRef } from 'react'

/**
 * Thin harness, not the real shell.
 *
 * Its only job is to prove the fetch-game pipeline: serve the patched bundle
 * from this origin, hand the frame the globals game-base/index.html reads off
 * `window.top`, and call initDofus. If the login screen appears, phase 2 works
 * and the 39 members of LindoAPI can be written against something that runs.
 *
 * Everything here is replaced by @lindo/ui once the web host exists.
 */

const PROFILE = {
  androidVersion: '14',
  chromeVersion: '150.0.7871.212',
  chromeMajor: '150',
  model: 'SM-A546B',
  manufacturer: 'samsung',
  navigatorPlatform: 'Linux armv8l',
  glVendor: 'ARM',
  glRenderer: 'Mali-G68 MC4',
  cores: 8,
  memory: 6,
  uuid: '46d3185c92e5f130'
}

declare global {
  interface Window {
    appVersion?: string
    buildVersion?: string
    platform?: string
    androidProfile?: typeof PROFILE
    initDofus?: (callback: () => void) => void
  }
}

export function App() {
  const frame = useRef<HTMLIFrameElement>(null)
  // StrictMode mounts twice in development, and initDofus is not idempotent -
  // the desktop renderer guards the same way
  const started = useRef(false)

  useEffect(() => {
    // read by game-base/index.html while its own inline script runs, so they
    // have to exist before the frame is attached
    window.appVersion = '3.14.0'
    window.buildVersion = '1.73.8'
    window.platform = 'web'
    window.androidProfile = PROFILE
  }, [])

  const onLoad = () => {
    if (started.current) return
    started.current = true
    const gameWindow = frame.current?.contentWindow as (Window & typeof globalThis) | null
    if (!gameWindow) {
      console.error('el frame no es accesible - deberia serlo, es del mismo origen')
      return
    }
    // the client only ever used WebSQL as a fallback and it is gone from the web
    ;(gameWindow as unknown as { openDatabase?: unknown }).openDatabase = undefined
    gameWindow.initDofus?.(() => console.log('initDofus done'))
  }

  return (
    <iframe
      ref={frame}
      onLoad={onLoad}
      src='/game/index.html?delayed=true'
      style={{ border: 'none', width: '100vw', height: '100vh', display: 'block' }}
    />
  )
}
