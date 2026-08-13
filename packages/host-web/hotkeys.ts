import { matchesAccelerator, RootStoreSnapshot } from '@lindo/shared'
import { publishLocal } from './channel'
import * as storage from './storage'

/**
 * Window-level shortcuts, on the document instead of the main process.
 *
 * Electron caught these in `before-input-event` and sent them back to the
 * renderer. Here the document is the only place they can be caught, and
 * `matchesAccelerator` from @lindo/shared is reused unchanged - it is pure.
 *
 * **What a browser will not give up.** Cmd/Ctrl+W, Cmd/Ctrl+N and Cmd/Ctrl+T
 * are handled by the browser before any page sees them, so an accelerator using
 * them silently never fires. `preventDefault` does not help. The defaults for
 * the web build have to avoid them, and Options should say so rather than let
 * someone configure a shortcut that cannot work.
 */
export const RESERVED_BY_BROWSER = ['CommandOrControl+W', 'CommandOrControl+N', 'CommandOrControl+T']

export const isReservedByBrowser = (accelerator: string): boolean =>
  RESERVED_BY_BROWSER.some((reserved) => reserved.toLowerCase() === accelerator.toLowerCase())

const asInput = (event: KeyboardEvent) => ({
  key: event.key,
  code: event.code,
  control: event.ctrlKey,
  meta: event.metaKey,
  shift: event.shiftKey,
  alt: event.altKey
})

export const installHotkeys = (): (() => void) => {
  const onKeyDown = async (event: KeyboardEvent) => {
    const snapshot = await storage.get<RootStoreSnapshot>('rootStore')
    const hotkeys = snapshot?.hotkeyStore?.window
    if (!hotkeys) return

    const isMac = navigator.platform.toLowerCase().includes('mac')
    const input = asInput(event)

    const tabs = hotkeys.tabs ?? []
    for (let index = 0; index < tabs.length; index++) {
      const accelerator = tabs[index]
      if (accelerator && matchesAccelerator(accelerator, input, isMac)) {
        event.preventDefault()
        publishLocal({ type: 'select-tab', index })
        return
      }
    }

    const simple: Array<[string | undefined, () => void]> = [
      [hotkeys.newTab, () => publishLocal({ type: 'new-tab' })],
      [hotkeys.nextTab, () => publishLocal({ type: 'next-tab' })],
      [hotkeys.prevTab, () => publishLocal({ type: 'prev-tab' })],
      [hotkeys.closeTab, () => publishLocal({ type: 'close-tab' })]
    ]
    for (const [accelerator, fire] of simple) {
      if (accelerator && matchesAccelerator(accelerator, input, isMac)) {
        event.preventDefault()
        fire()
        return
      }
    }
  }

  document.addEventListener('keydown', onKeyDown)
  return () => document.removeEventListener('keydown', onKeyDown)
}
