/**
 * HTTP-layer evaluators: what the server can tell without running any script.
 *
 * Input is the raw header list in arrival order, because the order itself is a
 * signal and an object would lose it.
 */

const get = (headers, name) => {
  const found = headers.find(([key]) => key.toLowerCase() === name.toLowerCase())
  return found ? found[1] : undefined
}

const verdict = (id, family, fixable, ok, observed, expected) => ({
  id,
  layer: 'http',
  family,
  verdict: observed === undefined ? 'MISSING' : ok ? 'PASS' : 'FAIL',
  observed: observed ?? null,
  expected,
  fixable
})

/**
 * The User-Agent shape of the client we are imitating.
 *
 * Written from the real thing, not from an idea of what Android looks like.
 * Dofus Touch is a Cordova app, so it runs in the system WebView and its string
 * carries what every WebView carries: a `Build/<id>` fragment, the `wv` token,
 * and `Version/4.0` between the engine and the Chrome version. The earlier
 * version of this pattern described Chrome-on-Android instead and therefore
 * **rejected the genuine article** - it graded a capture taken straight from the
 * official client as a failure, which is the worst way for a catalogue to be
 * wrong. All three are optional so a plain Chrome-on-Android string, which is
 * what the desktop and web builds synthesise, still parses.
 *
 * Still deliberately stricter than the game's own UAParser: that one resolves
 * every string carrying "Android" to the Android OS, including `Dalvik/...`,
 * which is the platform HTTP stack rather than a browser. A checker looking at a
 * browser request has every reason to expect a browser User-Agent.
 */
const CHROME_ANDROID_UA =
  /^Mozilla\/5\.0 \(Linux; Android (\d+(?:\.\d+)*); ([^)]+?)(?: Build\/[^);]+)?(?:; wv)?\) AppleWebKit\/537\.36 \(KHTML, like Gecko\)(?: Version\/[\d.]+)? Chrome\/(\d+)\.[\d.]+ Mobile Safari\/537\.36/

export const parseUserAgent = (ua) => {
  if (!ua) return null
  const match = CHROME_ANDROID_UA.exec(ua)
  if (!match) return null
  return { androidVersion: match[1], model: match[2], chromeMajor: match[3] }
}

/** the version numbers inside a Sec-CH-UA brand list, keyed by brand */
export const parseBrandList = (value) => {
  if (!value) return null
  const brands = {}
  for (const part of value.split(',')) {
    const match = /"([^"]+)";\s*v="([^"]+)"/.exec(part.trim())
    if (match) brands[match[1]] = match[2]
  }
  return Object.keys(brands).length ? brands : null
}

/** Chrome sends a deliberately absurd brand so servers cannot hardcode the list */
const isGreaseBrand = (brand) => /not[\s\S]?a[\s\S]?brand/i.test(brand)

export const HTTP_SIGNALS = [
  {
    id: 'http.ua',
    run: (ctx) => {
      const ua = get(ctx.http.headers, 'user-agent')
      const parsed = parseUserAgent(ua)
      return verdict('http.ua', 'D', 'client', parsed !== null, ua, 'Chrome on Android User-Agent')
    }
  },
  {
    id: 'http.ch.platform',
    run: (ctx) => {
      const value = get(ctx.http.headers, 'sec-ch-ua-platform')
      return verdict('http.ch.platform', 'D', 'client', value === '"Android"', value, '"Android"')
    }
  },
  {
    id: 'http.ch.mobile',
    run: (ctx) => {
      const value = get(ctx.http.headers, 'sec-ch-ua-mobile')
      return verdict('http.ch.mobile', 'D', 'client', value === '?1', value, '?1')
    }
  },
  {
    id: 'http.ch.brands',
    run: (ctx) => {
      const value = get(ctx.http.headers, 'sec-ch-ua')
      const brands = parseBrandList(value)
      const hasGrease = brands ? Object.keys(brands).some(isGreaseBrand) : false
      return verdict('http.ch.brands', 'M', 'client', hasGrease, value, 'brand list including a GREASE entry')
    }
  },
  {
    id: 'http.ch.highentropy',
    run: (ctx) => {
      // only sent once the server has asked for them with Accept-CH, so a
      // failure here can also mean the probe page forgot to ask
      const wanted = ['sec-ch-ua-model', 'sec-ch-ua-platform-version', 'sec-ch-ua-arch', 'sec-ch-ua-bitness']
      const missing = wanted.filter((name) => get(ctx.http.headers, name) === undefined)
      const observed = wanted.map((name) => `${name}=${get(ctx.http.headers, name) ?? '-'}`).join(' ')
      return verdict('http.ch.highentropy', 'D', 'client', missing.length === 0, observed, wanted.join(', '))
    }
  },
  {
    id: 'http.ch.arch',
    run: (ctx) => {
      const arch = get(ctx.http.headers, 'sec-ch-ua-arch')
      const bitness = get(ctx.http.headers, 'sec-ch-ua-bitness')
      // an Apple Silicon host also reports arm, so neither field alone is worth
      // anything - they are only meaningful together with the platform
      const ok = arch === '"arm"' && bitness === '"64"'
      return verdict('http.ch.arch', 'C', 'client', ok, `arch=${arch ?? '-'} bitness=${bitness ?? '-'}`, 'arm / 64')
    }
  },
  {
    id: 'http.sec.fetch',
    run: (ctx) => {
      const present = ['sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest'].filter(
        (name) => get(ctx.http.headers, name) !== undefined
      )
      // stripping them is its own tell: every current browser sends them
      return verdict('http.sec.fetch', 'M', 'client', present.length === 3, present.join(','), 'all three present')
    }
  },
  {
    id: 'http.header.order',
    run: (ctx) => {
      // Chrome on Android puts sec-ch-ua* immediately after the pseudo-headers
      // and before user-agent; desktop Chrome does the same, so this only
      // catches a client that rebuilt the header set by hand.
      const names = ctx.http.headers.map(([key]) => key.toLowerCase())
      const uaIndex = names.indexOf('user-agent')
      const chIndex = names.indexOf('sec-ch-ua')
      const ok = chIndex === -1 ? false : chIndex < uaIndex
      return verdict('http.header.order', 'M', 'network', ok, names.join(','), 'sec-ch-ua before user-agent')
    }
  },
  {
    id: 'http.accept.lang',
    run: (ctx) => {
      const value = get(ctx.http.headers, 'accept-language')
      return verdict('http.accept.lang', 'C', 'client', Boolean(value), value, 'present')
    }
  }
]
