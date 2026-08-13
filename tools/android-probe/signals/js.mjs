/**
 * JS-layer evaluators.
 *
 * These read the object `probe.js` collected inside the audited context. They
 * never touch the browser themselves, so they stay testable against a fixture.
 *
 * Two families live here. `D` signals ask "does this value reveal the host"; `M`
 * signals ask "does this value look like it was tampered with", which is a
 * different question and often the easier one for a checker to answer.
 */

const verdict = (id, family, fixable, ok, observed, expected) => ({
  id,
  layer: 'js',
  family,
  verdict: observed === undefined || observed === null ? 'MISSING' : ok ? 'PASS' : 'FAIL',
  observed: observed ?? null,
  expected,
  fixable
})

/**
 * What the bundle's platform module reads off `window.device`, in its order.
 *
 *   t.identifier = [c.cordova || "", c.isVirtual || "", c.model || "", d,
 *                   c.version || "", c.uuid || "", c.serial || ""].join("|")
 *
 * Taken from the module itself rather than guessed, which is how `serial`
 * turned up: it feeds the identifier the game reports, and nothing here was
 * checking it.
 */
const DEVICE_FIELDS = ['cordova', 'isVirtual', 'model', 'platform', 'version', 'uuid', 'serial']

/**
 * What `cordova.plugins` holds in the official Android client.
 *
 * Read out of the shipped `assets/www/cordova_plugins.js` in the store build
 * (com.ankama.dofustouch 3.14.0) rather than guessed. Note what is not here:
 * `isemulator`, which this project has been exposing. A plugin the real client
 * does not ship identifies this build just as well as a missing one does.
 */
const CORDOVA_PLUGINS = ['Keyboard', 'Yanap', 'browsertab', 'screenorientation']

/**
 * The two of those the bundle would really use, so a stub that answers without
 * working takes audio and the login tab with it. They are reported separately
 * rather than folded into the failure above: this is a decision that was made,
 * not a gap nobody noticed.
 */
const CORDOVA_PLUGINS_LEFT_ABSENT = ['Yanap', 'browsertab']

/** fonts that ship with macOS and are absent from Android */
const MACOS_ONLY_FONTS = ['Helvetica Neue', 'SF Pro Text', 'Lucida Grande', 'Geneva']
/** speech voices macOS installs by default */
const MACOS_VOICE = /alex|samantha|victoria|fred|daniel|karen|moira/i

export const JS_SIGNALS = [
  {
    id: 'js.uad.platform',
    run: (ctx) =>
      verdict('js.uad.platform', 'D', 'client', ctx.js.uaData?.platform === 'Android', ctx.js.uaData?.platform, 'Android')
  },
  {
    id: 'js.uad.highentropy',
    run: (ctx) => {
      const high = ctx.js.uaDataHighEntropy
      const ok = high?.platform === 'Android' && Boolean(high?.model) && Boolean(high?.platformVersion)
      return verdict('js.uad.highentropy', 'D', 'client', ok, high ? JSON.stringify(high) : undefined, 'Android + model + version')
    }
  },
  {
    id: 'js.platform',
    run: (ctx) => verdict('js.platform', 'D', 'client', ctx.js.platform === 'Linux armv8l', ctx.js.platform, 'Linux armv8l')
  },
  {
    id: 'js.vendor',
    run: (ctx) => verdict('js.vendor', 'D', 'client', ctx.js.vendor === 'Google Inc.', ctx.js.vendor, 'Google Inc.')
  },
  {
    id: 'js.touch',
    run: (ctx) => {
      const ok = ctx.js.maxTouchPoints >= 1 && ctx.js.hasOnTouchStart && ctx.js.hasTouchEvent
      const observed = `maxTouchPoints=${ctx.js.maxTouchPoints} ontouchstart=${ctx.js.hasOnTouchStart} TouchEvent=${ctx.js.hasTouchEvent}`
      return verdict('js.touch', 'D', 'client', ok, observed, 'touch capable')
    }
  },
  {
    id: 'js.plugins',
    run: (ctx) =>
      verdict('js.plugins', 'D', 'client', ctx.js.pluginCount === 0, ctx.js.pluginCount, '0 (Android Chrome ships none)')
  },
  {
    id: 'js.webdriver',
    run: (ctx) => verdict('js.webdriver', 'D', 'client', ctx.js.webdriver === false, ctx.js.webdriver, 'false')
  },
  {
    id: 'js.device',
    run: (ctx) => {
      const device = ctx.js.device
      // exactly the fields the bundle's platform module reads off window.device,
      // in the order it reads them. `manufacturer` is not among them; `serial`
      // is, and was missing from this list until the module was read properly.
      const missing = device ? DEVICE_FIELDS.filter((key) => device[key] === undefined) : DEVICE_FIELDS
      const ok = device?.platform === 'Android' && missing.length === 0
      const observed = device ? JSON.stringify(device) : undefined
      return verdict('js.device', 'D', 'client', ok, observed, `Cordova device carrying ${DEVICE_FIELDS.join(', ')}`)
    }
  },
  {
    id: 'js.device.identifier',
    run: (ctx) => {
      const device = ctx.js.device
      if (!device) return verdict('js.device.identifier', 'D', 'client', false, undefined, 'a populated identifier')

      // the bundle joins these into one string and treats it as the device
      // identity, so an empty segment is a hole in what it reports upstream
      const identifier = DEVICE_FIELDS.map((key) => device[key] || '').join('|')
      // isVirtual is false on a real device too, and `false || ''` is empty
      // there as well, so it is the one segment allowed to be blank
      const blank = DEVICE_FIELDS.filter((key) => key !== 'isVirtual' && !device[key])
      return verdict('js.device.identifier', 'D', 'client', blank.length === 0, identifier, 'no empty segment but isVirtual')
    }
  },
  {
    id: 'js.cordova.plugins',
    run: (ctx) => {
      const keys = ctx.js.cordovaPlugins
      if (!keys) return verdict('js.cordova.plugins', 'D', 'client', false, undefined, CORDOVA_PLUGINS.join(', '))
      const missing = CORDOVA_PLUGINS.filter(
        (name) => !keys.includes(name) && !CORDOVA_PLUGINS_LEFT_ABSENT.includes(name)
      )
      // an extra one is its own kind of tell: it is a plugin no copy of the real
      // client ships, so its presence identifies this build rather than hiding it
      const extra = keys.filter((name) => !CORDOVA_PLUGINS.includes(name))
      const ok = missing.length === 0 && extra.length === 0
      const observed = `${keys.join(',')}${missing.length ? ` | missing: ${missing.join(',')}` : ''}${
        extra.length ? ` | extra: ${extra.join(',')}` : ''
      }`
      return verdict('js.cordova.plugins', 'D', 'client', ok, observed, CORDOVA_PLUGINS.join(', '))
    }
  },
  {
    id: 'js.cordova.globals',
    run: (ctx) => {
      const collected = ctx.js.cordovaGlobals
      if (!collected) return verdict('js.cordova.globals', 'D', 'client', false, undefined, 'the official plugin globals')
      const missing = collected.expected.filter((name) => !collected.present.includes(name))
      return verdict(
        'js.cordova.globals',
        'D',
        'client',
        missing.length === 0,
        `${collected.present.length}/${collected.expected.length} present, missing: ${missing.join(',') || '(none)'}`,
        'every global the official client installs'
      )
    }
  },
  {
    id: 'js.webgl',
    run: (ctx) => {
      // both contexts matter: patching only WebGLRenderingContext leaves WebGL2
      // reporting the host GPU, and the game requests WebGL2 first
      const gl1 = ctx.js.webgl1 ?? {}
      const gl2 = ctx.js.webgl2 ?? {}
      const looksMobile = (renderer) => /adreno|mali|powervr|xclipse|immortalis/i.test(renderer ?? '')
      const ok = looksMobile(gl1.renderer) && looksMobile(gl2.renderer)
      return verdict('js.webgl', 'D', 'client', ok, `gl1=${gl1.renderer ?? '-'} gl2=${gl2.renderer ?? '-'}`, 'mobile GPU in both')
    }
  },
  {
    id: 'js.webgpu',
    run: (ctx) => {
      const info = ctx.js.gpuAdapter
      // absent is fine and even plausible; present but naming Apple is not
      if (info === null || info === undefined) {
        return { id: 'js.webgpu', layer: 'js', family: 'D', verdict: 'PASS', observed: null, expected: 'absent or mobile vendor', fixable: 'client' }
      }
      const ok = !/apple|intel|nvidia|amd/i.test(JSON.stringify(info))
      return verdict('js.webgpu', 'D', 'client', ok, JSON.stringify(info), 'no desktop GPU vendor')
    }
  },
  {
    id: 'js.voices',
    run: (ctx) => {
      const voices = ctx.js.voices ?? []
      const leaking = voices.filter((name) => MACOS_VOICE.test(name))
      return verdict('js.voices', 'D', 'client', leaking.length === 0, leaking.join(',') || '(none)', 'no macOS voices')
    }
  },
  {
    id: 'js.fonts',
    run: (ctx) => {
      const present = (ctx.js.fonts ?? []).filter((name) => MACOS_ONLY_FONTS.includes(name))
      return verdict('js.fonts', 'D', 'no', present.length === 0, present.join(',') || '(none)', 'no macOS-only fonts')
    }
  },
  {
    id: 'js.mq',
    run: (ctx) => {
      const ok = ctx.js.pointerCoarse === true && ctx.js.hoverNone === true
      return verdict('js.mq', 'D', 'client', ok, `coarse=${ctx.js.pointerCoarse} hoverNone=${ctx.js.hoverNone}`, 'coarse pointer, no hover')
    }
  },
  {
    id: 'js.perfmemory',
    run: (ctx) =>
      // This expected the opposite at first, on the assumption that
      // `performance.memory` was desktop-only. It is not: it is a Blink feature
      // that is not gated by platform, so Chrome on Android exposes it too.
      // Removing it would have manufactured an anomaly rather than removed one.
      // Kept, inverted, as a guard against exactly that kind of over-correction.
      verdict('js.perfmemory', 'C', 'no', ctx.js.hasPerformanceMemory === true, ctx.js.hasPerformanceMemory, 'present, as on any Chromium')
  },

  // ---- family M: does the environment look tampered with ----
  {
    id: 'm.descriptor.navigator',
    run: (ctx) => {
      // in a real browser these live on Navigator.prototype and the instance has
      // no own property at all; defining them on the instance is the single
      // easiest spoof to detect
      const own = ctx.js.ownNavigatorProps ?? []
      return verdict('m.descriptor.navigator', 'M', 'client', own.length === 0, own.join(',') || '(none)', 'no own properties on navigator')
    }
  },
  {
    id: 'm.tostring.getparameter',
    run: (ctx) => {
      const ok = /\[native code\]/.test(ctx.js.getParameterSource ?? '')
      return verdict('m.tostring.getparameter', 'M', 'client', ok, ctx.js.getParameterSource, '[native code]')
    }
  },
  {
    id: 'm.tostring.generic',
    run: (ctx) => {
      const dirty = (ctx.js.nonNativeFunctions ?? [])
      return verdict('m.tostring.generic', 'M', 'client', dirty.length === 0, dirty.join(',') || '(none)', 'every patched builtin reports native code')
    }
  },
  {
    id: 'm.uad.class',
    run: (ctx) => {
      const ok = ctx.js.uaDataTag === '[object NavigatorUAData]'
      return verdict('m.uad.class', 'M', 'client', ok, ctx.js.uaDataTag, '[object NavigatorUAData]')
    }
  },
  {
    id: 'm.iframe.escape',
    run: (ctx) => {
      // a freshly created frame gets a clean realm: if the overrides were applied
      // to one window object rather than installed per frame, the real value
      // shows up here and nowhere else
      const ok = ctx.js.iframePlatform === 'Linux armv8l'
      return verdict('m.iframe.escape', 'M', 'client', ok, ctx.js.iframePlatform, 'Linux armv8l inside a new iframe')
    }
  },
  {
    id: 'm.parent.escape',
    run: (ctx) => {
      // null means the probe ran at the top, where there is no parent to ask -
      // not that the check passed
      if (ctx.js.parentPlatform === null || ctx.js.parentPlatform === undefined) {
        return {
          id: 'm.parent.escape',
          layer: 'js',
          family: 'M',
          verdict: 'MISSING',
          observed: null,
          expected: 'run inside the game frame to have a parent to read',
          fixable: 'client'
        }
      }
      const ok = ctx.js.parentPlatform === 'Linux armv8l'
      return verdict('m.parent.escape', 'M', 'client', ok, ctx.js.parentPlatform, 'Linux armv8l in top.navigator')
    }
  },
  {
    id: 'm.worker.escape',
    run: (ctx) => {
      const ok = ctx.js.workerPlatform === 'Linux armv8l'
      return verdict('m.worker.escape', 'M', 'client', ok, ctx.js.workerPlatform, 'Linux armv8l inside a worker')
    }
  },
  {
    id: 'm.stack',
    run: (ctx) => {
      const leaks = /app\.asar|electron|\/Users\//i.test(ctx.js.stackSample ?? '')
      return verdict('m.stack', 'M', 'no', !leaks, ctx.js.stackSample, 'no host paths in stack traces')
    }
  }
]
