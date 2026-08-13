/**
 * Two captures to grade the evaluators against.
 *
 * `REAL_ANDROID` is what a Pixel 8 running Chrome 139 produces; `HOST_MACOS` is
 * what this project produced before any of the platform work. An evaluator that
 * cannot separate these two is not measuring anything, which is why every one of
 * them is checked against both.
 */

export const REAL_ANDROID = {
  http: {
    httpVersion: '1.1',
    headers: [
      ['Host', '127.0.0.1:8420'],
      ['sec-ch-ua', '"Chromium";v="139", "Google Chrome";v="139", "Not?A_Brand";v="24"'],
      ['sec-ch-ua-mobile', '?1'],
      ['sec-ch-ua-platform', '"Android"'],
      ['sec-ch-ua-model', '"Pixel 8"'],
      ['sec-ch-ua-platform-version', '"15.0.0"'],
      ['sec-ch-ua-arch', '"arm"'],
      ['sec-ch-ua-bitness', '"64"'],
      [
        'User-Agent',
        'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.7258.123 Mobile Safari/537.36'
      ],
      ['Accept-Language', 'es-ES,es;q=0.9'],
      ['Sec-Fetch-Site', 'same-origin'],
      ['Sec-Fetch-Mode', 'cors'],
      ['Sec-Fetch-Dest', 'empty']
    ]
  },
  js: {
    userAgent:
      'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.7258.123 Mobile Safari/537.36',
    platform: 'Linux armv8l',
    vendor: 'Google Inc.',
    maxTouchPoints: 5,
    hardwareConcurrency: 9,
    deviceMemory: 8,
    webdriver: false,
    pluginCount: 0,
    uaData: {
      brands: [
        { brand: 'Chromium', version: '139' },
        { brand: 'Google Chrome', version: '139' },
        { brand: 'Not?A_Brand', version: '24' }
      ],
      mobile: true,
      platform: 'Android'
    },
    uaDataTag: '[object NavigatorUAData]',
    uaDataHighEntropy: { platform: 'Android', model: 'Pixel 8', platformVersion: '15.0.0', architecture: 'arm', bitness: '64' },
    device: {
      platform: 'Android',
      version: '15',
      model: 'Pixel 8',
      manufacturer: 'Google',
      uuid: 'aaaaaaaaaaaaaaaa',
      cordova: '12.0.1',
      isVirtual: false,
      serial: 'unknown'
    },
    cordovaPlugins: ['Keyboard', 'screenorientation'],
    cordovaGlobals: {
      expected: ['StatusBar', 'store', 'Adjust', 'IonicDeeplink'],
      present: ['StatusBar', 'store', 'Adjust', 'IonicDeeplink']
    },
    webgl1: { vendor: 'ARM', renderer: 'Mali-G715-Immortalis MC11' },
    webgl2: { vendor: 'ARM', renderer: 'Mali-G715-Immortalis MC11' },
    gpuAdapter: null,
    voices: ['Google español'],
    fonts: ['Roboto', 'Noto Sans'],
    hasOnTouchStart: true,
    hasTouchEvent: true,
    pointerCoarse: true,
    hoverNone: true,
    hasPerformanceMemory: true,
    ownNavigatorProps: [],
    getParameterSource: 'function getParameter() { [native code] }',
    nonNativeFunctions: [],
    iframePlatform: 'Linux armv8l',
    parentPlatform: 'Linux armv8l',
    workerPlatform: 'Linux armv8l',
    stackSample: 'Error: probe\n    at https://example.test/probe.js:1:1'
  }
}

export const HOST_MACOS = {
  http: {
    httpVersion: '1.1',
    headers: [
      ['Host', '127.0.0.1:8420'],
      [
        'User-Agent',
        'Mozilla/5.0 (Linux; Android 8.1.0; moto e5 play) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Mobile Safari/537.36 DofusTouch Client 3.11.0'
      ],
      ['Accept-Language', 'es-ES,es;q=0.9']
      // sec-ch-ua* and Sec-Fetch-* deleted by the old header handler
    ]
  },
  js: {
    userAgent:
      'Mozilla/5.0 (Linux; Android 8.1.0; moto e5 play) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Mobile Safari/537.36 DofusTouch Client 3.11.0',
    platform: 'MacIntel',
    vendor: 'Google Inc.',
    maxTouchPoints: 0,
    hardwareConcurrency: 10,
    deviceMemory: 8,
    webdriver: false,
    pluginCount: 5,
    uaData: {
      brands: [{ brand: 'Chromium', version: '140' }],
      mobile: false,
      platform: 'macOS'
    },
    uaDataTag: '[object NavigatorUAData]',
    uaDataHighEntropy: { platform: 'macOS', model: '', platformVersion: '15.6.0' },
    device: null,
    cordovaPlugins: null,
    cordovaGlobals: { expected: ['StatusBar', 'store', 'Adjust', 'IonicDeeplink'], present: [] },
    webgl1: { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro)' },
    webgl2: { vendor: 'Google Inc. (Apple)', renderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Pro)' },
    gpuAdapter: { vendor: 'apple', architecture: 'metal-3' },
    voices: ['Alex', 'Samantha', 'Daniel'],
    fonts: ['Helvetica Neue', 'Lucida Grande', 'Geneva'],
    hasOnTouchStart: true,
    hasTouchEvent: true,
    pointerCoarse: false,
    hoverNone: false,
    hasPerformanceMemory: true,
    ownNavigatorProps: [],
    getParameterSource: 'function getParameter() { [native code] }',
    nonNativeFunctions: [],
    iframePlatform: 'MacIntel',
    parentPlatform: 'MacIntel',
    workerPlatform: 'MacIntel',
    stackSample: 'Error: probe\n    at file:///Users/x/app.asar/probe.js:1:1'
  }
}

/**
 * The shape the current overrides produce: the values are right but they were
 * installed on the window, so a new realm and a worker still see the host, and
 * navigator carries own properties it should not have.
 */
export const SPOOFED_DETECTABLY = {
  http: REAL_ANDROID.http,
  js: {
    ...REAL_ANDROID.js,
    // a plain object literal stands in for NavigatorUAData, so the brand check
    // on the class passes but the tag gives it away
    uaDataTag: '[object Object]',
    ownNavigatorProps: ['platform', 'vendor', 'maxTouchPoints', 'userAgentData'],
    getParameterSource: 'function (parameter) { if (parameter === 37445) return ...; }',
    nonNativeFunctions: ['WebGLRenderingContext.prototype.getParameter'],
    iframePlatform: 'MacIntel',
    parentPlatform: 'MacIntel',
    workerPlatform: 'MacIntel'
  }
}
