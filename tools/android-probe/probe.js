/* eslint-disable */
/**
 * The payload. Runs inside the context being audited and posts what it finds.
 *
 * It has to be injected into the game frame's own document - navigating a tab to
 * the probe page measures a fresh document where none of the overrides were ever
 * applied, which produces a clean-looking report that means nothing.
 *
 *   var s = document.createElement('script')
 *   s.src = 'http://127.0.0.1:8420/probe.js'
 *   document.head.appendChild(s)
 *
 * Every reader is wrapped: a throw in one signal must not cost us the rest of
 * the report, and "this threw" is itself an observation worth keeping.
 */
;(function () {
  var ORIGIN = 'http://127.0.0.1:8420'
  var sid = String(Date.now()) + '-' + Math.random().toString(36).slice(2, 8)

  var safe = function (fn, fallback) {
    try {
      var value = fn()
      return value === undefined ? fallback : value
    } catch (error) {
      return '__threw__:' + (error && error.message)
    }
  }

  var glInfo = function (contextName) {
    return safe(function () {
      var canvas = document.createElement('canvas')
      var gl = canvas.getContext(contextName)
      if (!gl) return null
      var ext = gl.getExtension('WEBGL_debug_renderer_info')
      if (!ext) return { vendor: null, renderer: null, extensionMissing: true }
      return {
        vendor: gl.getParameter(ext.UNMASKED_VENDOR_WEBGL),
        renderer: gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
      }
    }, null)
  }

  /** a font is present when rendering in it differs from the generic fallback */
  var detectFonts = function (candidates) {
    return safe(function () {
      var canvas = document.createElement('canvas')
      var ctx = canvas.getContext('2d')
      var sample = 'mmmmmmmmmmlli'
      ctx.font = '72px monospace'
      var baseline = ctx.measureText(sample).width
      var found = []
      for (var i = 0; i < candidates.length; i++) {
        ctx.font = '72px "' + candidates[i] + '", monospace'
        if (ctx.measureText(sample).width !== baseline) found.push(candidates[i])
      }
      return found
    }, [])
  }

  /** builtins this project patches - each must still claim to be native */
  var nonNativeFunctions = function () {
    return safe(function () {
      var targets = [
        ['WebGLRenderingContext.prototype.getParameter', window.WebGLRenderingContext && window.WebGLRenderingContext.prototype.getParameter],
        ['WebGL2RenderingContext.prototype.getParameter', window.WebGL2RenderingContext && window.WebGL2RenderingContext.prototype.getParameter],
        ['Function.prototype.toString', Function.prototype.toString],
        ['navigator.permissions.query', navigator.permissions && navigator.permissions.query]
      ]
      var dirty = []
      for (var i = 0; i < targets.length; i++) {
        var fn = targets[i][1]
        if (typeof fn !== 'function') continue
        if (!/\[native code\]/.test(Function.prototype.toString.call(fn))) dirty.push(targets[i][0])
      }
      return dirty
    }, [])
  }

  /** a brand new frame gets a clean realm; anything patched per-window is absent */
  var iframePlatform = function () {
    return safe(function () {
      var frame = document.createElement('iframe')
      frame.style.display = 'none'
      document.documentElement.appendChild(frame)
      var value = frame.contentWindow.navigator.platform
      frame.remove()
      return value
    }, null)
  }

  var workerPlatform = function () {
    return new Promise(function (resolve) {
      try {
        var source = 'self.postMessage({platform: navigator.platform, ua: navigator.userAgent})'
        var blob = new Blob([source], { type: 'application/javascript' })
        var worker = new Worker(URL.createObjectURL(blob))
        var timer = setTimeout(function () {
          worker.terminate()
          resolve(null)
        }, 2000)
        worker.onmessage = function (event) {
          clearTimeout(timer)
          worker.terminate()
          resolve(event.data && event.data.platform)
        }
        worker.onerror = function () {
          clearTimeout(timer)
          resolve('__threw__:worker error')
        }
      } catch (error) {
        resolve('__threw__:' + (error && error.message))
      }
    })
  }

  /**
   * Where this ran.
   *
   * Injecting into the wrong realm is the failure that costs a whole cycle: the
   * React renderer and a freshly navigated tab both produce a report full of
   * PASS that describes a document the overrides were never applied to. Recording
   * it means a bad capture identifies itself instead of being read as a result.
   */
  var describeContext = function () {
    return {
      href: safe(function () { return location.href }),
      isGameFrame: safe(function () { return typeof window.initDofus === 'function' || Boolean(window.dofus) }, false),
      hasInstaller: safe(function () { return typeof window.installLindoPlatform === 'function' }, false),
      isTopFrame: safe(function () { return window === window.top }, null)
    }
  }

  var collect = function () {
    var result = {
      sid: sid,
      context: describeContext(),
      userAgent: safe(function () { return navigator.userAgent }),
      platform: safe(function () { return navigator.platform }),
      vendor: safe(function () { return navigator.vendor }),
      languages: safe(function () { return navigator.languages }),
      maxTouchPoints: safe(function () { return navigator.maxTouchPoints }),
      hardwareConcurrency: safe(function () { return navigator.hardwareConcurrency }),
      deviceMemory: safe(function () { return navigator.deviceMemory }, null),
      webdriver: safe(function () { return navigator.webdriver }),
      pluginCount: safe(function () { return navigator.plugins.length }),
      mimeTypeCount: safe(function () { return navigator.mimeTypes.length }),

      uaData: safe(function () {
        if (!navigator.userAgentData) return null
        return {
          brands: navigator.userAgentData.brands,
          mobile: navigator.userAgentData.mobile,
          platform: navigator.userAgentData.platform
        }
      }, null),
      uaDataTag: safe(function () {
        return navigator.userAgentData ? Object.prototype.toString.call(navigator.userAgentData) : null
      }, null),

      device: safe(function () { return window.device ? JSON.parse(JSON.stringify(window.device)) : null }, null),
      cordovaPlugins: safe(function () { return window.cordova ? Object.keys(window.cordova.plugins || {}) : null }, null),

      webgl1: glInfo('webgl'),
      webgl2: glInfo('webgl2'),

      screen: safe(function () {
        return {
          width: screen.width,
          height: screen.height,
          availWidth: screen.availWidth,
          availHeight: screen.availHeight,
          colorDepth: screen.colorDepth,
          dpr: window.devicePixelRatio,
          orientation: screen.orientation ? screen.orientation.type : null,
          windowOrientation: window.orientation
        }
      }, null),

      hasOnTouchStart: safe(function () { return 'ontouchstart' in window }),
      hasTouchEvent: safe(function () { return typeof window.TouchEvent !== 'undefined' }),
      pointerCoarse: safe(function () { return matchMedia('(pointer: coarse)').matches }),
      hoverNone: safe(function () { return matchMedia('(hover: none)').matches }),
      hasPerformanceMemory: safe(function () { return Boolean(performance.memory) }),
      hasBattery: safe(function () { return typeof navigator.getBattery === 'function' }),
      timeZone: safe(function () { return Intl.DateTimeFormat().resolvedOptions().timeZone }),

      voices: safe(function () {
        return (window.speechSynthesis ? speechSynthesis.getVoices() : []).map(function (voice) { return voice.name })
      }, []),
      fonts: detectFonts(['Helvetica Neue', 'SF Pro Text', 'Lucida Grande', 'Geneva', 'Roboto', 'Noto Sans']),

      ownNavigatorProps: safe(function () { return Object.getOwnPropertyNames(navigator) }, []),
      getParameterSource: safe(function () {
        return window.WebGLRenderingContext
          ? Function.prototype.toString.call(window.WebGLRenderingContext.prototype.getParameter)
          : null
      }, null),
      nonNativeFunctions: nonNativeFunctions(),
      iframePlatform: iframePlatform(),
      stackSample: safe(function () { return new Error('probe').stack }, null)
    }

    var pending = [
      workerPlatform().then(function (value) { result.workerPlatform = value }),
      Promise.resolve()
        .then(function () {
          if (!navigator.userAgentData || !navigator.userAgentData.getHighEntropyValues) return null
          return navigator.userAgentData.getHighEntropyValues([
            'architecture', 'bitness', 'model', 'platformVersion', 'uaFullVersion', 'fullVersionList'
          ])
        })
        .then(function (value) { result.uaDataHighEntropy = value || null })
        .catch(function (error) { result.uaDataHighEntropy = '__threw__:' + error.message }),
      Promise.resolve()
        .then(function () {
          if (!navigator.gpu) return null
          return navigator.gpu.requestAdapter().then(function (adapter) {
            if (!adapter) return null
            return adapter.info || (adapter.requestAdapterInfo ? adapter.requestAdapterInfo() : null)
          })
        })
        .then(function (value) {
          result.gpuAdapter = value ? JSON.parse(JSON.stringify(value, ['vendor', 'architecture', 'device', 'description'])) : null
        })
        .catch(function () { result.gpuAdapter = null })
    ]

    return Promise.all(pending).then(function () { return result })
  }

  // the first request to this origin cannot carry the high-entropy client hints
  // because the server had not asked for them yet; this warm-up request is what
  // makes the following POST carry them
  fetch(ORIGIN + '/echo?sid=' + sid, { mode: 'cors' })
    .then(collect)
    .then(function (result) {
      return fetch(ORIGIN + '/collect?sid=' + sid, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(result)
      })
    })
    .then(function (response) { return response.json() })
    .then(function (summary) {
      console.log('[android-probe] run stored:', summary.file)
      console.log('[android-probe] PASS %d / FAIL %d / MISSING %d', summary.pass, summary.fail, summary.missing)
      if (summary.failed && summary.failed.length) console.table(summary.failed)
    })
    .catch(function (error) {
      console.error(
        '[android-probe] could not reach ' + ORIGIN + ' - is `node tools/android-probe/server.mjs` running?',
        error
      )
    })
})()
