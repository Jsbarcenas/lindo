import { WebAuthResult } from '@lindo/shared'
import { BrowserWindow, Event } from 'electron'
import { logger } from '../logger'

/**
 * Desktop client OAuth authentication window implementation.
 * Handles authentication redirect events and token extraction for active user sessions.
 */
const DEEP_LINK_PREFIX = 'dofustouch://'

/** net::ERR_ABORTED - navigation superseded. */
const ERR_ABORTED = -3

const parseDeepLink = (url: string): WebAuthResult | undefined => {
  if (!url.startsWith(DEEP_LINK_PREFIX)) return undefined
  const query = url.slice(url.indexOf('?') + 1)
  const params = new URLSearchParams(url.includes('?') ? query : '')
  const code = params.get('code')
  if (code) return { code }
  const error = params.get('error')
  return { error: error ?? 'Authentication returned no authorization code' }
}

export const openWebAuthWindow = (authUrl: string, parent: BrowserWindow | null): Promise<WebAuthResult> => {
  return new Promise<WebAuthResult>((resolve) => {
    const win = new BrowserWindow({
      width: 520,
      height: 720,
      parent: parent ?? undefined,
      closable: true,
      autoHideMenuBar: true,
      title: 'Ankama',
      webPreferences: {
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true
      }
    })

    let settled = false
    const settle = (result: WebAuthResult) => {
      if (settled) return
      settled = true
      logger.info(`AuthWindow -> ${result.code ? 'got authorization code' : JSON.stringify(result)}`)
      resolve(result)
      if (!win.isDestroyed()) win.destroy()
    }

    const handleNavigation = (event: Event, url: string) => {
      const result = parseDeepLink(url)
      if (!result) return
      event.preventDefault()
      settle(result)
    }

    win.webContents.on('will-navigate', handleNavigation)
    win.webContents.on('will-redirect', handleNavigation)

    win.webContents.on('before-input-event', (_event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape' && !win.isDestroyed()) win.close()
    })

    const poll = setInterval(async () => {
      if (settled || win.isDestroyed()) return
      try {
        const href = await win.webContents.executeJavaScript(
          `document.querySelector('redirect-uri')?.getAttribute('uri')
             || document.querySelector('.success-page a')?.href
             || null`,
          true
        )
        if (typeof href === 'string') {
          const result = parseDeepLink(href)
          if (result) settle(result)
        }
      } catch {
        // Retry on next tick
      }
    }, 1000)

    win.on('closed', () => {
      clearInterval(poll)
      settle({ cancelled: true })
    })

    win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, _url, isMainFrame) => {
      if (!isMainFrame || errorCode === ERR_ABORTED) return
      logger.error(`AuthWindow -> could not load the auth page: ${errorDescription} (${errorCode})`)
      settle({ error: `${errorDescription} (${errorCode})` })
    })

    win.loadURL(authUrl).catch((error: Error) => {
      logger.debug(`AuthWindow -> navigation superseded: ${error.message}`)
    })
  })
}
