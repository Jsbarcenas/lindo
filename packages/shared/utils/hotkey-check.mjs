/**
 * Tab shortcuts used to be handled by @hfelix/electron-localshortcut, fed a
 * keyboard layout by native-keymap. Both are gone; matchesAccelerator does the
 * work now. That is real logic replacing a library, so it gets checked.
 *
 *   pnpm --filter @lindo/shared test
 */
import { matchesAccelerator, normalizeHotkeyKey } from './hotkey.ts'

const pressed = (key, modifiers = {}) => ({
  key,
  control: false,
  shift: false,
  alt: false,
  meta: false,
  ...modifiers
})

let passed = 0
const failures = []
const check = (name, got, want) => {
  if (got === want) passed++
  else failures.push(`${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
}

// the eight defaults, F1..F8
check('F1 matches F1', matchesAccelerator('F1', pressed('F1'), false), true)
check('F1 does not match F2', matchesAccelerator('F1', pressed('F2'), false), false)

// the reason matching uses `key` and not `code`: on AZERTY the key producing
// "a" sits at QWERTY's Q position, so its code is KeyQ. Matching on code would
// fire the shortcut from the wrong physical key.
check('AZERTY "a" matches an "A" shortcut', matchesAccelerator('A', pressed('a'), false), true)

// modifiers have to match in both directions
check('Ctrl+F1 requires ctrl', matchesAccelerator('Ctrl+F1', pressed('F1'), false), false)
check('Ctrl+F1 with ctrl', matchesAccelerator('Ctrl+F1', pressed('F1', { control: true }), false), true)
check('plain F1 rejects ctrl', matchesAccelerator('F1', pressed('F1', { control: true }), false), false)
check(
  'Ctrl+Shift+A',
  matchesAccelerator('Ctrl+Shift+A', pressed('a', { control: true, shift: true }), false),
  true
)
check(
  'Ctrl+Shift+A without shift',
  matchesAccelerator('Ctrl+Shift+A', pressed('a', { control: true }), false),
  false
)

// arrows and space, spelled the way the settings UI records them
check('Down accepts ArrowDown', matchesAccelerator('Down', pressed('ArrowDown'), false), true)
check('Space accepts " "', matchesAccelerator('Space', pressed(' '), false), true)

// CmdOrCtrl keeps Electron's meaning: Command on macOS, Control elsewhere
check('CmdOrCtrl+1 on macOS takes meta', matchesAccelerator('CmdOrCtrl+1', pressed('1', { meta: true }), true), true)
check(
  'CmdOrCtrl+1 on macOS rejects ctrl',
  matchesAccelerator('CmdOrCtrl+1', pressed('1', { control: true }), true),
  false
)
check(
  'CmdOrCtrl+1 elsewhere takes ctrl',
  matchesAccelerator('CmdOrCtrl+1', pressed('1', { control: true }), false),
  true
)

// a literal '+', which a naive split on '+' gets wrong
check('Ctrl++ matches a literal plus', matchesAccelerator('Ctrl++', pressed('+', { control: true }), false), true)

// an unset or unparseable shortcut must never fire
check('empty accelerator never matches', matchesAccelerator('', pressed('F1'), false), false)
check('unknown modifier never matches', matchesAccelerator('Bogus+F1', pressed('F1'), false), false)

check('normalize ArrowUp', normalizeHotkeyKey('ArrowUp'), 'Up')
check('normalize letter', normalizeHotkeyKey('a'), 'A')

if (failures.length) {
  console.error(`HOTKEY_FAIL: ${failures.length} of ${failures.length + passed}`)
  for (const failure of failures) console.error(`  ${failure}`)
  process.exit(1)
}

console.log(`HOTKEY_OK: ${passed} checks passed`)
