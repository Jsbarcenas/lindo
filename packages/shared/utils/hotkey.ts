/**
 * Hotkeys are stored as Electron accelerator strings ("F1", "Ctrl+Shift+A").
 * The settings UI builds them from KeyboardEvent.key, and the main process
 * matches them against before-input-event, so both sides have to agree on how a
 * key is spelled - hence this shared normalisation.
 *
 * Matching deliberately uses `key`, the character the active layout produces,
 * rather than `code`, the physical position. `code` would only agree with what
 * the UI recorded on a US QWERTY layout: an AZERTY user who records "A" presses
 * the key at QWERTY's Q position, so its code is "KeyQ" and a code-based match
 * would fire on the wrong key.
 */

/** Keys whose KeyboardEvent.key differs from its accelerator spelling. */
const KEY_ALIASES: Record<string, string> = {
  ArrowRight: 'Right',
  ArrowLeft: 'Left',
  ArrowDown: 'Down',
  ArrowUp: 'Up',
  ' ': 'Space'
}

/** Spell a KeyboardEvent.key the way an Electron accelerator would. */
export const normalizeHotkeyKey = (key: string): string => {
  const aliased = Object.hasOwn(KEY_ALIASES, key) ? KEY_ALIASES[key] : key
  return aliased.charAt(0).toUpperCase() + aliased.slice(1)
}

export interface PressedKey {
  key: string
  control: boolean
  shift: boolean
  alt: boolean
  meta: boolean
}

interface ParsedAccelerator extends Omit<PressedKey, 'key'> {
  key: string
}

/**
 * `CmdOrCtrl` follows Electron's own meaning - Command on macOS, Control
 * everywhere else - so shortcuts keep behaving as they did under
 * electron-localshortcut.
 */
const parseAccelerator = (accelerator: string, isMac: boolean): ParsedAccelerator | undefined => {
  const parts = accelerator.split('+')

  // an accelerator ending in '+' means the key itself is '+', which the naive
  // split turns into a trailing empty segment
  if (parts.length > 1 && parts[parts.length - 1] === '') {
    parts.pop()
    parts[parts.length - 1] = '+'
  }

  const key = parts.pop()
  if (!key) return undefined

  const parsed: ParsedAccelerator = { key, control: false, shift: false, alt: false, meta: false }

  for (const modifier of parts) {
    switch (modifier.toLowerCase()) {
      case 'cmdorctrl':
      case 'commandorcontrol':
        if (isMac) parsed.meta = true
        else parsed.control = true
        break
      case 'cmd':
      case 'command':
      case 'super':
      case 'meta':
        parsed.meta = true
        break
      case 'ctrl':
      case 'control':
        parsed.control = true
        break
      case 'alt':
      case 'option':
      case 'altgr':
        parsed.alt = true
        break
      case 'shift':
        parsed.shift = true
        break
      default:
        // an unknown segment means this is not an accelerator we can honour
        return undefined
    }
  }

  return parsed
}

/**
 * True when `pressed` is exactly `accelerator`. Modifiers must match exactly, so
 * Ctrl+F1 does not trigger a shortcut registered as plain F1.
 *
 * `isMac` is a parameter rather than read from `process` because this module is
 * shared with the renderer, which has no Node globals.
 */
export const matchesAccelerator = (accelerator: string, pressed: PressedKey, isMac: boolean): boolean => {
  const parsed = parseAccelerator(accelerator, isMac)
  if (!parsed) return false

  return (
    parsed.control === pressed.control &&
    parsed.shift === pressed.shift &&
    parsed.alt === pressed.alt &&
    parsed.meta === pressed.meta &&
    parsed.key.toLowerCase() === normalizeHotkeyKey(pressed.key).toLowerCase()
  )
}
