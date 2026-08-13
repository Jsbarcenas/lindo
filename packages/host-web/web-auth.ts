import { WebAuthResult } from '@lindo/shared'

/**
 * Ankama's login, as far as a browser can take it.
 *
 * The desktop opens the login in a window it owns and catches the redirect to
 * `dofustouch://authorized`. Neither half of that is available here: a page
 * cannot register a custom scheme, and it cannot ask for its own URL as the
 * redirect either - Ankama validates `redirect_uri` against what is registered
 * for the client, and the same value is sent again when the code is exchanged
 * for a token, so it cannot be swapped for one this origin could read. Pointing
 * it at this origin was tried and rejected.
 *
 * Ankama's own Electron build does not solve this either, it sidesteps it: it
 * polls the popup's `location.search` and calls `eval` inside it to scrape the
 * final URL out of the success page. Both are cross-origin reads that only work
 * with web security switched off, which is exactly what a page does not have.
 *
 * So the login runs in a popup and ends on Ankama's page with `?code=` in its
 * URL - readable by the person looking at it, not by this origin. That copy is
 * irreducible. Everything after it is not, and this module removes it: the
 * clipboard is watched while the login is in flight, so coming back to this tab
 * (or pressing paste once) finishes the login and closes the popup.
 */

const RETURNING_FROM_AUTH = 'lindo:returning-from-auth'
const PANEL_ID = 'lindo-auth-panel'

/**
 * The code as it appears in a redirect URL.
 *
 * Strict on purpose: this is what anything read from the clipboard without
 * being asked has to match. The loose form below would accept any word of eight
 * characters, and sending whatever happened to be copied to Ankama as a login
 * code is both useless and rude.
 */
const codeFromUrl = (text: string): string | undefined => {
  const match = /[?&]code=([^&\s]+)/.exec(text)?.[1]
  return match ? decodeURIComponent(match) : undefined
}

/** what a person typing into the field may reasonably mean: the URL, or the code alone */
export const extractCode = (answer: string): string | undefined => {
  const fromUrl = codeFromUrl(answer)
  if (fromUrl) return fromUrl
  const trimmed = answer.trim()
  return /^[\w-]{8,}$/.test(trimmed) ? trimmed : undefined
}

const PANEL_MARKUP = `
<div style="position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;
     justify-content:center;background:rgba(0,0,0,.6);font:14px system-ui,sans-serif">
  <div style="width:min(440px,92vw);background:#1e1e1e;color:#e0e0e0;border-radius:10px;
       padding:24px;box-shadow:0 12px 40px rgba(0,0,0,.5)">
    <div style="font-size:16px;font-weight:600;margin-bottom:12px">Terminando el login</div>
    <div id="lindo-auth-hint" style="line-height:1.5;color:#b0b0b0">
      Cuando Ankama te lleve a la última página, copia su URL (⌘L, ⌘C).
      Al volver a esta pestaña entras solo.
    </div>
    <input id="lindo-auth-field" placeholder="…o pega la URL aquí" spellcheck="false"
      style="width:100%;box-sizing:border-box;margin-top:16px;padding:10px;border-radius:6px;
      border:1px solid #3a3a3a;background:#121212;color:#e0e0e0;font:13px ui-monospace,monospace" />
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px">
      <button id="lindo-auth-cancel" style="padding:8px 14px;border-radius:6px;border:1px solid #3a3a3a;
        background:transparent;color:#b0b0b0;cursor:pointer;font:inherit">Cancelar</button>
      <button id="lindo-auth-paste" style="padding:8px 14px;border-radius:6px;border:0;
        background:#7cb342;color:#0d1a04;cursor:pointer;font:inherit;font-weight:600">Pegar y entrar</button>
    </div>
  </div>
</div>`

/**
 * Waits for the code, from wherever it arrives first.
 *
 * Three routes, because each one covers what the others cannot. The clipboard
 * is only read while this panel is up, and only once the browser has granted
 * the permission - the paste event needs no permission at all, so the flow
 * still works in a browser that never grants it, and in Firefox and Safari,
 * which do not implement the query.
 */
const collectCode = (popup?: Window | null): Promise<WebAuthResult> =>
  new Promise((resolve) => {
    const panel = document.createElement('div')
    panel.id = PANEL_ID
    panel.innerHTML = PANEL_MARKUP
    document.body.appendChild(panel)

    const field = panel.querySelector<HTMLInputElement>('#lindo-auth-field')
    const hint = panel.querySelector<HTMLElement>('#lindo-auth-hint')
    let settled = false

    const finish = (result: WebAuthResult) => {
      if (settled) return
      settled = true
      window.clearInterval(timer)
      document.removeEventListener('paste', onPaste, true)
      window.removeEventListener('focus', fromClipboard)
      panel.remove()
      try {
        popup?.close()
      } catch {
        // a popup on another origin can still be closed by its opener, but not
        // every browser agrees; there is nothing to do if this one does not
      }
      resolve(result)
    }

    /** true when the text carried a code, so callers know whether to keep waiting */
    const accept = (text: string | undefined, loose: boolean): boolean => {
      const code = text ? (loose ? extractCode(text) : codeFromUrl(text)) : undefined
      if (code) finish({ code })
      return !!code
    }

    const onPaste = (event: ClipboardEvent) => {
      // the field handles its own paste; anywhere else is the shortcut path,
      // where pressing paste with nothing focused is the whole interaction
      if (event.target === field) return
      accept(event.clipboardData?.getData('text'), true)
    }

    const granted = async (): Promise<boolean> => {
      try {
        const status = await navigator.permissions.query({ name: 'clipboard-read' as PermissionName })
        return status.state === 'granted'
      } catch {
        // Firefox and Safari do not know this permission name
        return false
      }
    }

    /** the silent route: no gesture, so it only runs once the permission exists */
    const fromClipboard = () => {
      if (settled || !document.hasFocus() || !navigator.clipboard?.readText) return
      granted()
        .then((allowed) => (allowed ? navigator.clipboard.readText() : undefined))
        .then((text) => accept(text, false))
        .catch(() => undefined)
    }

    // the popup closing is the only thing this origin ever hears from it, and it
    // means the person is done there - not that the login failed
    const timer = window.setInterval(() => {
      if (popup?.closed && hint) {
        hint.textContent = 'Pega la URL que copiaste (⌘V) o usa el botón, y entras.'
      }
      fromClipboard()
    }, 800)

    document.addEventListener('paste', onPaste, true)
    window.addEventListener('focus', fromClipboard)
    fromClipboard()

    field?.addEventListener('input', () => accept(field.value, true))
    // the game binds shortcuts on the document, and they should not fire while
    // someone is typing a login code into a field
    field?.addEventListener('keydown', (event) => event.stopPropagation())

    panel.querySelector('#lindo-auth-paste')?.addEventListener('click', () => {
      // a click is a gesture, so this is the call that gets the permission
      // prompt shown; once granted, every later login resolves on focus alone
      navigator.clipboard
        ?.readText()
        .then((text) => {
          if (!accept(text, true) && hint) {
            hint.textContent = 'No encontré ningún "code" en el portapapeles. Copia la URL entera.'
          }
        })
        .catch(() => {
          if (hint) hint.textContent = 'Este navegador no me deja leer el portapapeles: pega la URL en el campo.'
          field?.focus()
        })
    })

    panel.querySelector('#lindo-auth-cancel')?.addEventListener('click', () => finish({ cancelled: true }))
  })

/**
 * Asks for the code on the way back from a login that took over the tab.
 *
 * Called during install, before anything renders, so it is the first thing seen
 * after coming back rather than something that interrupts later.
 */
export const collectCodeAfterRedirect = async (): Promise<string | undefined> => {
  if (window.sessionStorage.getItem(RETURNING_FROM_AUTH) !== '1') return undefined
  window.sessionStorage.removeItem(RETURNING_FROM_AUTH)
  const result = await collectCode()
  return result.code
}

export const openWebAuthInPopup = async (url: string): Promise<WebAuthResult> => {
  const popup = window.open(url, 'lindo-auth', 'width=520,height=720')
  if (!popup) {
    // The game reaches this through its own promise chain, so the click that
    // started it is no longer the current task and the popup can be blocked.
    // Taking over this window instead is not a downgrade: the store lives in
    // IndexedDB and survives the trip, and the login page has to be top level
    // anyway - its challenge fails when framed.
    window.sessionStorage.setItem(RETURNING_FROM_AUTH, '1')
    window.location.href = url
    return { cancelled: true }
  }

  return collectCode(popup)
}
