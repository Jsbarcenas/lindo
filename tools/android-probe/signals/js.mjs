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
      const required = ['platform', 'version', 'model', 'manufacturer', 'uuid', 'cordova', 'isVirtual']
      const missing = device ? required.filter((key) => device[key] === undefined) : required
      const ok = device?.platform === 'Android' && missing.length === 0
      return verdict('js.device', 'D', 'client', ok, device ? JSON.stringify(device) : undefined, 'full Cordova device object')
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
