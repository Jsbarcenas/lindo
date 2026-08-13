import { LindoTitleBar } from '@lindo/shared'
import { createWebLindoAPI } from './api'

export * from './api'
export * from './hotkeys'
export * from './profile'

/**
 * Installs the browser host and hands back once the UI can be mounted.
 *
 * `@lindo/ui` reads `window.lindoAPI` and `window.titleBar` while it renders, so
 * both have to exist before the first render rather than after an effect.
 */
export const installWebLindoAPI = async (): Promise<void> => {
  window.lindoAPI = await createWebLindoAPI()

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

  // serves the portraits saved by saveCharacterImage back at
  // /character-images/<name>.png, which is the URL CharacterCard builds
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('/character-images-sw.js', { scope: '/' })
    } catch (error) {
      console.warn('lindo: sin service worker, los retratos de multicuenta no se mostrarán', error)
    }
  }
}
