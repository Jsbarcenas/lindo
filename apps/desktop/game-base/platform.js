/* eslint-disable */
/**
 * Installs the device identity into a realm.
 *
 * The first version of this lived inline in index.html and set each value with
 * `Object.defineProperty(navigator, ...)`. The values were right and it still
 * gave itself away three ways, all of them cheaper to check than the values
 * themselves:
 *
 *   - the properties landed on the navigator *instance*, where a real browser
 *     has none at all - they live on Navigator.prototype
 *   - the replacement functions reported their own source, so
 *     `getParameter.toString()` returned JavaScript instead of [native code]
 *   - it patched one window, so a freshly created iframe or a worker - each of
 *     which gets its own realm - still reported the host
 *
 * So the shape here is an installer that can be applied to any realm, and every
 * definition it makes is indistinguishable from a native one.
 */
;(function (root) {
  /** realms already done - a marker property on the window would be visible */
  var installed = new WeakSet()

  /**
   * Sources to report for the functions we install. Shared across realms
   * because a WeakMap does not care which realm a key came from.
   */
  var fakeSource = new WeakMap()

  var nativeSource = function (name) {
    return 'function ' + name + '() { [native code] }'
  }

  /**
   * Makes Function.prototype.toString lie for our functions only.
   *
   * It has to lie about itself too, or the check just moves one level up:
   * `Function.prototype.toString.toString()` would report a Proxy.
   */
  var patchToString = function (win) {
    var proto = win.Function.prototype
    var original = proto.toString
    if (fakeSource.has(original)) return

    var proxy = new win.Proxy(original, {
      apply: function (target, thisArg, args) {
        if (fakeSource.has(thisArg)) return fakeSource.get(thisArg)
        return Reflect.apply(target, thisArg, args)
      }
    })
    fakeSource.set(proxy, nativeSource('toString'))
    proto.toString = proxy
  }

  /** an accessor on the prototype, exactly where the real one lives */
  var defineGetter = function (target, prop, value) {
    if (!target) return
    var getter = function () {
      return value
    }
    fakeSource.set(getter, 'function get ' + prop + '() { [native code] }')
    try {
      Object.defineProperty(target, prop, { get: getter, enumerable: true, configurable: true })
    } catch (error) {}
  }

  var defineMethod = function (target, prop, fn) {
    if (!target) return
    fakeSource.set(fn, nativeSource(prop))
    try {
      Object.defineProperty(target, prop, { value: fn, writable: true, enumerable: true, configurable: true })
    } catch (error) {}
  }

  /** what runs inside a worker to give it the same identity */
  var workerBootstrap = function (profile) {
    try {
      var proto = Object.getPrototypeOf(self.navigator)
      var define = function (prop, value) {
        Object.defineProperty(proto, prop, { get: function () { return value }, enumerable: true, configurable: true })
      }
      define('platform', profile.navigatorPlatform)
      define('hardwareConcurrency', profile.cores)
      define('deviceMemory', profile.memory)
    } catch (error) {}
  }

  var installWorker = function (win, profile) {
    var Original = win.Worker
    if (!Original) return

    var prelude = '(' + workerBootstrap.toString() + ')(' + JSON.stringify(profile) + ');'

    var Wrapped = function Worker(url, options) {
      // module workers have no importScripts, so there is nothing to prepend and
      // an unpatched worker beats a broken one
      if (options && options.type === 'module') return new Original(url, options)
      try {
        var absolute = new win.URL(url, win.location.href).href
        var glue =
          prelude + 'importScripts(' + JSON.stringify(absolute) + ');'
        var blob = new win.Blob([glue], { type: 'application/javascript' })
        return new Original(win.URL.createObjectURL(blob), options)
      } catch (error) {
        return new Original(url, options)
      }
    }

    Wrapped.prototype = Original.prototype
    fakeSource.set(Wrapped, nativeSource('Worker'))
    try {
      win.Worker = Wrapped
    } catch (error) {}
  }

  /**
   * Any iframe the page creates gets a clean realm, so the identity has to be
   * installed there too.
   *
   * A MutationObserver would be too late: it runs on a microtask, and reading
   * `frame.contentWindow.navigator.platform` right after appendChild is
   * synchronous. Hooking the getter instead means the realm is patched by the
   * time anyone can hold a reference to it.
   */
  var installFrameHook = function (win, profile) {
    var proto = win.HTMLIFrameElement && win.HTMLIFrameElement.prototype
    if (!proto) return

    var hook = function (prop, resolve) {
      var descriptor = Object.getOwnPropertyDescriptor(proto, prop)
      if (!descriptor || !descriptor.get) return
      var original = descriptor.get
      var getter = function () {
        var value = original.call(this)
        try {
          var frameWindow = resolve(value)
          if (frameWindow) install(frameWindow, profile)
        } catch (error) {}
        return value
      }
      fakeSource.set(getter, 'function get ' + prop + '() { [native code] }')
      Object.defineProperty(proto, prop, {
        get: getter,
        set: descriptor.set,
        enumerable: descriptor.enumerable,
        configurable: true
      })
    }

    hook('contentWindow', function (value) {
      return value
    })
    hook('contentDocument', function (value) {
      return value && value.defaultView
    })
  }

  /**
   * The globals the official client's Cordova plugins install.
   *
   * Only the ones the bundle never mentions are installed. That rule replaced a
   * judgement call about which stubs would be "harmless", and it did so because
   * the judgement was wrong: `store` looked unused and has 86 references, so a
   * stub of it threw on the first chained call and took the game down. The
   * detection behind that judgement was the flawed part - it only matched
   * `window.X` and bare `X`, while webpack hands these around as `t.store`.
   *
   * So: zero references in build/script.js, or it does not go in. Everything
   * else stays absent, whatever a checker makes of that. A missing global costs
   * one signal; a stub in a path the game actually walks costs the game.
   *
   * Refresh the list against a new bundle with a plain word-boundary count -
   * `\bNAME\b` - not a property-access pattern.
   */
  var installCordovaSurface = function (win) {
    var ok = function (success) {
      if (typeof success === 'function') success()
    }

    var surface = {
      StatusBar: {
        isVisible: false,
        hide: function () {}, show: function () {},
        styleDefault: function () {}, styleLightContent: function () {},
        backgroundColorByHexString: function () {}, overlaysWebView: function () {}
      },
      AppSettings: { open: function (setting, page, success) { ok(success) } },
      MobileAccessibilityNotifications: {
        ANNOUNCEMENT: 'announcement', SCREEN_CHANGED: 'screenChanged'
      },
      LocalFileSystem: { TEMPORARY: 0, PERSISTENT: 1 },
      // the cordova-plugin-file surface. All at zero references, and the guard
      // below skips the ones the engine already provides natively
      requestFileSystem: function requestFileSystem(type, size, success, fail) {
        if (typeof fail === 'function') fail({ code: 5 })
      },
      DirectoryEntry: function DirectoryEntry() {},
      DirectoryReader: function DirectoryReader() {},
      Entry: function Entry() {},
      FileEntry: function FileEntry() {},
      FileSystem: function FileSystem() {},
      FileWriter: function FileWriter() {},
      Flags: function Flags() {},
      Metadata: function Metadata() {},
      FileUploadOptions: function FileUploadOptions() {},
      FileUploadResult: function FileUploadResult() {},
      FileError: {
        NOT_FOUND_ERR: 1, SECURITY_ERR: 2, ABORT_ERR: 3, NOT_READABLE_ERR: 4, ENCODING_ERR: 5,
        NO_MODIFICATION_ALLOWED_ERR: 6, INVALID_STATE_ERR: 7, SYNTAX_ERR: 8, INVALID_MODIFICATION_ERR: 9,
        QUOTA_EXCEEDED_ERR: 10, TYPE_MISMATCH_ERR: 11, PATH_EXISTS_ERR: 12
      }
    }

    for (var name in surface) {
      // never shadow something the engine already provides: File, FileReader,
      // ProgressEvent and friends are native here, and Cordova overriding them
      // on a phone is not a reason to override them on top of a real one
      if (typeof win[name] === 'undefined') {
        try {
          win[name] = surface[name]
        } catch (error) {}
      }
    }
  }

  /**
   * Families that ship with macOS and do not exist on Android.
   *
   * Apple Color Emoji is deliberately not here. Measurement is what gets
   * redirected below, not drawing, so putting an emoji font on this list would
   * make the game measure one width and paint another - and emoji really do
   * appear in chat.
   */
  var HOST_ONLY_FONTS = [
    'helvetica neue', 'lucida grande', 'geneva', 'monaco', 'menlo',
    'sf pro text', 'sf pro display', 'sf mono', 'apple chancery', 'applegothic',
    'american typewriter', 'andale mono', 'avenir', 'avenir next', 'baskerville',
    'big caslon', 'chalkboard', 'chalkduster', 'charter', 'cochin', 'copperplate',
    'didot', 'futura', 'gill sans', 'herculanum', 'hoefler text', 'marker felt',
    'noteworthy', 'optima', 'papyrus', 'phosphate', 'rockwell', 'savoye let',
    'skia', 'superclarendon', 'trattatello', 'zapfino'
  ]

  /**
   * Splits a CSS font shorthand at the size, so what follows is the family list.
   *
   * Anchored on the size *and its unit*, not on a digit: `(?:\d|\))` matched the
   * `7` of `72px` and handed back "2px ..." as the family, so nothing was ever
   * recognised and the whole redirection below did nothing at all.
   */
  var FONT_SIZE = /\d[\d.]*(?:px|pt|pc|in|cm|mm|em|rem|ex|ch|q|vw|vh|vmin|vmax|%)(?:\s*\/\s*[^\s]+)?\s+(.+)$/i

  var firstFamily = function (fontShorthand) {
    var match = FONT_SIZE.exec(String(fontShorthand))
    if (!match) return null
    return match[1].split(',')[0].trim().replace(/^["']|["']$/g, '').toLowerCase()
  }

  var isHostOnly = function (family) {
    return family !== null && HOST_ONLY_FONTS.indexOf(family) !== -1
  }

  /** the same declaration with its first family dropped, as Android would resolve it */
  var withoutFirstFamily = function (fontShorthand) {
    var text = String(fontShorthand)
    var match = FONT_SIZE.exec(text)
    if (!match) return text
    var families = match[1].split(',')
    families.shift()
    var rest = families.join(',').trim()
    return text.slice(0, text.length - match[1].length) + (rest || 'sans-serif')
  }

  /**
   * Font enumeration.
   *
   * Asking whether a family exists is done by measuring text in it and comparing
   * against a fallback: the widths differ only when the font is installed. So the
   * host's fonts answer for it, and macOS ones are as good as a name tag.
   *
   * Only measurements naming a family Android does not have are redirected, which
   * is why the list above is explicit rather than an allowlist. The game measures
   * text constantly to lay out its interface, and it never asks for Zapfino - so
   * nothing it does goes through this branch, while a script probing for macOS
   * gets the width it would get on a phone.
   *
   * What this does not cover: a family named only in a stylesheet and measured
   * through the layout engine. Catching that means intercepting offsetWidth,
   * which the game uses everywhere and which is not worth breaking for one signal.
   */
  var installFonts = function (win) {
    var contextProto = win.CanvasRenderingContext2D && win.CanvasRenderingContext2D.prototype
    if (contextProto && contextProto.measureText) {
      var originalMeasure = contextProto.measureText
      var replacement = function measureText(text) {
        if (!isHostOnly(firstFamily(this.font))) return originalMeasure.apply(this, arguments)
        var saved = this.font
        try {
          this.font = withoutFirstFamily(saved)
          return originalMeasure.call(this, text)
        } finally {
          this.font = saved
        }
      }
      defineMethod(contextProto, 'measureText', replacement)
    }

    // the direct question, which needs no measuring at all
    if (win.document.fonts && win.document.fonts.check) {
      var fontsProto = Object.getPrototypeOf(win.document.fonts)
      var originalCheck = fontsProto.check
      var checkReplacement = function check(font) {
        if (isHostOnly(firstFamily(font))) return false
        return originalCheck.apply(this, arguments)
      }
      defineMethod(fontsProto, 'check', checkReplacement)
    }

    // an inline style naming one of these renders and measures as the fallback,
    // so DOM-based probes see the same answer without offsetWidth being touched
    var styleProto = win.CSSStyleDeclaration && win.CSSStyleDeclaration.prototype
    if (styleProto) {
      var descriptor = Object.getOwnPropertyDescriptor(styleProto, 'fontFamily')
      if (descriptor && descriptor.set) {
        var originalSet = descriptor.set
        var familySetter = function (value) {
          var families = String(value).split(',')
          var kept = []
          for (var i = 0; i < families.length; i++) {
            var name = families[i].trim().replace(/^["']|["']$/g, '').toLowerCase()
            if (HOST_ONLY_FONTS.indexOf(name) === -1) kept.push(families[i])
          }
          return originalSet.call(this, kept.length ? kept.join(',') : 'sans-serif')
        }
        fakeSource.set(familySetter, 'function set fontFamily() { [native code] }')
        try {
          Object.defineProperty(styleProto, 'fontFamily', {
            get: descriptor.get,
            set: familySetter,
            enumerable: descriptor.enumerable,
            configurable: true
          })
        } catch (error) {}
      }
    }
  }

  /**
   * @param options.inputTraits set false to leave touch, pointer media queries
   *   and orientation alone. The renderer that hosts the game frame is reachable
   *   from inside it (`top.navigator`), so it needs the same identity - but it
   *   is also where the React interface lives, and MUI lays itself out from
   *   `(pointer: coarse)` and `'ontouchstart' in window`. The device has to
   *   match; how the surrounding interface responds to a mouse does not.
   */
  var install = function (win, profile, options) {
    if (!win || installed.has(win)) return
    installed.add(win)
    var inputTraits = !(options && options.inputTraits === false)

    try {
      patchToString(win)

      // --- navigator, on the prototype where the real accessors live ---
      var navigatorProto = win.Navigator && win.Navigator.prototype
      defineGetter(navigatorProto, 'platform', profile.navigatorPlatform)
      defineGetter(navigatorProto, 'vendor', 'Google Inc.')

      // The desktop sets this on the session, so there the string already names
      // Android and this leaves it exactly as it was - the guard is what keeps
      // the two builds identical rather than merely similar.
      //
      // In a browser nothing sets it, and the result was a frame contradicting
      // itself out loud: `userAgentData` reporting Android next to a string
      // reporting macOS. A page still cannot set the *request* header, and that
      // is not what this is for. It is for the reader inside the page, which is
      // where the bundle looks - `UAParser(navigator.userAgent)` is its own
      // fallback for resolving the platform.
      if (profile.userAgent && !/Android/.test(win.navigator.userAgent)) {
        defineGetter(navigatorProto, 'userAgent', profile.userAgent)
        // appVersion is the same string without the product token, and a
        // validator that reads one and not the other is not unusual
        defineGetter(navigatorProto, 'appVersion', profile.userAgent.replace(/^Mozilla\//, ''))
      }
      if (inputTraits) defineGetter(navigatorProto, 'maxTouchPoints', 5)
      defineGetter(navigatorProto, 'hardwareConcurrency', profile.cores)
      defineGetter(navigatorProto, 'deviceMemory', profile.memory)
      defineGetter(navigatorProto, 'connection', {
        downlink: 10,
        effectiveType: '4g',
        rtt: 50,
        saveData: false,
        type: 'cellular'
      })

      // Chrome on Android exposes no plugins; desktop ships the PDF viewer ones
      var emptyList = win.navigator.plugins
      try {
        emptyList = Object.create(win.PluginArray ? win.PluginArray.prototype : Object.prototype)
        defineGetter(emptyList, 'length', 0)
        defineMethod(emptyList, 'item', function () { return null })
        defineMethod(emptyList, 'namedItem', function () { return null })
        defineMethod(emptyList, 'refresh', function () {})
      } catch (error) {}
      defineGetter(navigatorProto, 'plugins', emptyList)
      defineGetter(navigatorProto, 'mimeTypes', emptyList)

      // --- userAgentData: patch the real class so the instance stays real ---
      var brands = [
        { brand: 'Chromium', version: profile.chromeMajor },
        { brand: 'Google Chrome', version: profile.chromeMajor },
        { brand: 'Not?A_Brand', version: '24' }
      ]
      var highEntropy = {
        architecture: 'arm',
        bitness: '64',
        brands: brands,
        fullVersionList: [
          { brand: 'Chromium', version: profile.chromeVersion },
          { brand: 'Google Chrome', version: profile.chromeVersion },
          { brand: 'Not?A_Brand', version: '24.0.0.0' }
        ],
        mobile: true,
        model: profile.model,
        platform: 'Android',
        platformVersion: profile.androidVersion + '.0.0',
        uaFullVersion: profile.chromeVersion
      }

      var uaDataProto = win.NavigatorUAData && win.NavigatorUAData.prototype
      if (uaDataProto) {
        // the instance keeps its real class, so both its prototype chain and
        // Object.prototype.toString still say NavigatorUAData
        defineGetter(uaDataProto, 'brands', brands)
        defineGetter(uaDataProto, 'mobile', true)
        defineGetter(uaDataProto, 'platform', 'Android')
        defineMethod(uaDataProto, 'getHighEntropyValues', function (hints) {
          var picked = {}
          var wanted = hints || []
          for (var i = 0; i < wanted.length; i++) {
            if (highEntropy[wanted[i]] !== undefined) picked[wanted[i]] = highEntropy[wanted[i]]
          }
          picked.brands = brands
          picked.mobile = true
          picked.platform = 'Android'
          return win.Promise.resolve(picked)
        })
        defineMethod(uaDataProto, 'toJSON', function () {
          return { brands: brands, mobile: true, platform: 'Android' }
        })
      }

      // --- Cordova's device plugin, which the bundle prefers over the UA ---
      win.device = {
        available: true,
        // PLATFORM_VERSION_BUILD_LABEL from the cordova.js shipped inside the
        // store build of com.ankama.dofustouch, not a guess: this is what the
        // official Android client reports as device.cordova, and it is one of
        // the seven fields the bundle joins into its device identifier
        cordova: '14.0.1',
        platform: 'Android',
        version: profile.androidVersion,
        model: profile.model,
        manufacturer: profile.manufacturer,
        isVirtual: false,
        serial: 'unknown',
        uuid: profile.uuid || '0123456789abcdef'
      }

      // --- WebGL: both contexts, or WebGL2 keeps naming the host GPU ---
      var UNMASKED_VENDOR = 37445
      var UNMASKED_RENDERER = 37446
      var patchGl = function (contextProto) {
        if (!contextProto || !contextProto.getParameter) return
        var original = contextProto.getParameter
        var replacement = function getParameter(parameter) {
          if (parameter === UNMASKED_VENDOR) return profile.glVendor
          if (parameter === UNMASKED_RENDERER) return profile.glRenderer
          return original.apply(this, arguments)
        }
        defineMethod(contextProto, 'getParameter', replacement)
      }
      patchGl(win.WebGLRenderingContext && win.WebGLRenderingContext.prototype)
      patchGl(win.WebGL2RenderingContext && win.WebGL2RenderingContext.prototype)

      // --- touch ---
      // an event handler IDL attribute, so it is an own property of window with
      // a null default; `'ontouchstart' in window` is the usual way this is read
      if (inputTraits && !('ontouchstart' in win)) {
        try {
          win.ontouchstart = null
        } catch (error) {}
      }

      // --- media queries ---
      // a touch device reports a coarse pointer and no hover. These are the
      // cheapest capability checks there are, and CSS uses them directly, so the
      // wrapper answers only the pointer and hover families and hands every other
      // query to the real implementation.
      var originalMatchMedia = inputTraits && win.matchMedia
      if (originalMatchMedia) {
        var forced = {
          '(pointer: coarse)': true,
          '(pointer: fine)': false,
          '(any-pointer: coarse)': true,
          '(any-pointer: fine)': false,
          '(hover: none)': true,
          '(hover: hover)': false,
          '(any-hover: none)': true,
          '(any-hover: hover)': false
        }
        var replacement = function matchMedia(query) {
          var result = originalMatchMedia.call(this, query)
          var normalized = String(query).replace(/\s+/g, ' ').trim().toLowerCase()
          if (Object.prototype.hasOwnProperty.call(forced, normalized)) {
            defineGetter(result, 'matches', forced[normalized])
          }
          return result
        }
        defineMethod(win, 'matchMedia', replacement)
      }

      // --- WebGPU ---
      // the adapter names the real GPU, and it says Apple however carefully the
      // WebGL strings were set
      if (win.navigator.gpu && win.navigator.gpu.requestAdapter) {
        var fakeInfo = {
          vendor: profile.glVendor.toLowerCase(),
          architecture: profile.glRenderer.toLowerCase().replace(/\s+/g, '-'),
          device: '',
          description: profile.glRenderer
        }
        var gpuProto = Object.getPrototypeOf(win.navigator.gpu)
        var originalRequest = gpuProto.requestAdapter
        var wrappedRequest = function requestAdapter(options) {
          return originalRequest.call(this, options).then(function (adapter) {
            if (!adapter) return adapter
            defineGetter(adapter, 'info', fakeInfo)
            if (adapter.requestAdapterInfo) {
              defineMethod(adapter, 'requestAdapterInfo', function requestAdapterInfo() {
                return win.Promise.resolve(fakeInfo)
              })
            }
            return adapter
          })
        }
        defineMethod(gpuProto, 'requestAdapter', wrappedRequest)
      }

      // --- orientation ---
      if (inputTraits) {
        defineGetter(win, 'orientation', 0)
        if (win.screen && win.screen.orientation) {
          var orientationProto = win.ScreenOrientation ? win.ScreenOrientation.prototype : win.screen.orientation
          defineGetter(orientationProto, 'type', 'portrait-primary')
          defineGetter(orientationProto, 'angle', 0)
        }
      }

      // NOTE: screen.width/height and devicePixelRatio stay untouched. They
      // would match the claimed device, but the game lays out its interface from
      // them while the real window is desktop-sized, and a 412x915 screen under a
      // 1280x720 window breaks the UI.

      if (!(options && options.cordovaSurface === false)) installCordovaSurface(win)

      installFonts(win)
      installFrameHook(win, profile)
      installWorker(win, profile)
    } catch (error) {
      if (root.top && root.top.console) root.top.console.log('lindo: platform install failed', error)
    }
  }

  root.installLindoPlatform = install
})(window)
