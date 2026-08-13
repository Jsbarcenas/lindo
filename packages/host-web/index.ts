import { LindoTitleBar } from '@lindo/shared'
import { createWebLindoAPI } from './api'
import { onUpdateProgress, updateGame } from './game-updater'

export * from './api'
export * from './game-updater'
export * from './hotkeys'
export * from './profile'

const RELOADED_FOR_WORKER = 'lindo:reloaded-for-worker'

/**
 * The game shell is served by the worker out of IndexedDB, so it has to be in
 * control before the frame asks for it. On a first visit it usually is not:
 * a newly installed worker does not control the page that installed it.
 *
 * `clients.claim()` covers most of that, and this covers the rest with a single
 * reload, guarded so a worker that never takes control cannot loop.
 */
const ensureWorkerControls = async (): Promise<void> => {
  if (!('serviceWorker' in navigator)) {
    throw new Error('Este navegador no tiene service workers, que es lo que sirve el cliente del juego.')
  }

  await navigator.serviceWorker.register('/lindo-sw.js', { scope: '/' })
  await navigator.serviceWorker.ready

  if (!navigator.serviceWorker.controller && sessionStorage.getItem(RELOADED_FOR_WORKER) !== '1') {
    sessionStorage.setItem(RELOADED_FOR_WORKER, '1')
    window.location.reload()
    // the reload wins; nothing after this runs
    await new Promise(() => undefined)
  }
  sessionStorage.removeItem(RELOADED_FOR_WORKER)
}

/** a splash, in plain DOM: React is not mounted yet and should not have to be */
const splash = () => {
  const root = document.getElementById('root')
  if (!root) return { update: () => undefined, done: () => undefined }

  root.innerHTML =
    '<div id="lindo-splash" style="position:fixed;inset:0;display:flex;flex-direction:column;' +
    'align-items:center;justify-content:center;gap:16px;background:#121212;color:#e0e0e0;' +
    'font:14px system-ui,sans-serif">' +
    '<div id="lindo-splash-text">Iniciando</div>' +
    '<div style="width:260px;height:4px;background:#2a2a2a;border-radius:2px;overflow:hidden">' +
    '<div id="lindo-splash-bar" style="width:0%;height:100%;background:#7cb342;transition:width .2s"></div>' +
    '</div></div>'

  return {
    update: (message: string, percent: number) => {
      const text = document.getElementById('lindo-splash-text')
      const bar = document.getElementById('lindo-splash-bar')
      if (text) text.textContent = message
      if (bar) bar.style.width = `${percent}%`
    },
    done: () => {
      const node = document.getElementById('lindo-splash')
      if (node) node.remove()
    }
  }
}

/**
 * Installs the browser host and hands back once the UI can be mounted.
 *
 * `@lindo/ui` reads `window.lindoAPI` and `window.titleBar` while it renders, so
 * both have to exist before the first render rather than after an effect.
 */
export const installWebLindoAPI = async (): Promise<void> => {
  const screen = splash()
  const stopReporting = onUpdateProgress(({ message, percent }) => screen.update(message, percent))

  try {
    await ensureWorkerControls()
    await updateGame()
  } finally {
    stopReporting()
    screen.done()
  }

  window.lindoAPI = await createWebLindoAPI()

  /**
   * Makes the patched bundle ask Ankama for its browser redirect instead of the
   * `dofustouch://` deep link, which only an app owning the scheme can catch.
   *
   * `game-base/index.html` copies this into the game frame. Nothing sets it on
   * the desktop, which is how that build keeps asking for the deep link.
   */
  const host = window as Window & { lindoBrowserAuth?: boolean }
  host.lindoBrowserAuth = true

  // Navigator asserts this is present with a non-null assertion. There is no
  // custom title bar in a browser, so it reports no height and the layout
  // resolves to the full viewport.
  const titleBar: LindoTitleBar = {
    updateTitle: (title: string) => {
      document.title = title
    },
    height: '0px'
  }
  window.titleBar = titleBar
}
