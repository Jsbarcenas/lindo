import { installWebLindoAPI } from '@lindo/host-web'
import { App } from '@lindo/ui'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter } from 'react-router-dom'

const container = document.getElementById('root')
if (!container) throw new Error('missing #root')

/**
 * The host has to be installed before the first render, not in an effect:
 * `@lindo/ui` reads `window.lindoAPI` and `window.titleBar` while it renders.
 * That is the same order the desktop preload guarantees by running before the
 * page scripts.
 *
 * HashRouter rather than BrowserRouter, because the option window is opened as
 * a real popup at `#/option` - the routes are addressed the same way the
 * desktop's second BrowserWindow addressed them.
 */
installWebLindoAPI()
  .then(() => {
    createRoot(container).render(
      <StrictMode>
        <HashRouter>
          <App />
        </HashRouter>
      </StrictMode>
    )
  })
  .catch((error) => {
    console.error('lindo: no se pudo instalar el host web', error)
    container.textContent = 'No se pudo iniciar Lindo. Mira la consola.'
  })
