/**
 * Cross-checks between what the headers claim and what the scripting
 * environment claims.
 *
 * These are the checks a spoof survives least often, because passing them
 * requires every value to come from one source. Each one on its own would be
 * easy to satisfy; satisfying all of them at once is the actual bar.
 */

import { parseBrandList, parseUserAgent } from './http.mjs'

const verdict = (id, fixable, ok, observed, expected) => ({
  id,
  layer: 'coherence',
  family: 'C',
  verdict: observed === undefined || observed === null ? 'MISSING' : ok ? 'PASS' : 'FAIL',
  observed: observed ?? null,
  expected,
  fixable
})

const header = (ctx, name) => {
  const found = ctx.http.headers.find(([key]) => key.toLowerCase() === name)
  return found ? found[1] : undefined
}

const unquote = (value) => (typeof value === 'string' ? value.replace(/^"|"$/g, '') : value)

/**
 * Which GPU family each device actually ships. A Pixel 8 reporting an Adreno is
 * not a small mistake: the model and the renderer come from different vendors
 * entirely, and the pair is public knowledge.
 */
const DEVICE_GPU = [
  { model: /^Pixel (6|7|8|9)/, gpu: /mali/i },
  { model: /^SM-S9\d{2}/, gpu: /adreno|xclipse/i },
  { model: /^SM-A5\d{2}/, gpu: /mali/i },
  { model: /^2201123G$/, gpu: /adreno/i }
]

export const COHERENCE_SIGNALS = [
  {
    id: 'c.chrome.version',
    run: (ctx) => {
      const ua = parseUserAgent(header(ctx, 'user-agent'))
      const brands = parseBrandList(header(ctx, 'sec-ch-ua'))
      const uadBrands = ctx.js.uaData?.brands ?? []
      if (!ua || !brands) return verdict('c.chrome.version', 'client', false, 'unparseable', 'same major everywhere')

      const chVersions = Object.entries(brands)
        .filter(([brand]) => !/not[\s\S]?a[\s\S]?brand/i.test(brand))
        .map(([, version]) => version)
      const uadVersions = uadBrands
        .filter((entry) => !/not[\s\S]?a[\s\S]?brand/i.test(entry.brand))
        .map((entry) => entry.version)

      const all = [ua.chromeMajor, ...chVersions, ...uadVersions]
      const ok = all.every((version) => version === ua.chromeMajor)
      return verdict('c.chrome.version', 'client', ok, all.join('/'), `all ${ua.chromeMajor}`)
    }
  },
  {
    id: 'c.model',
    run: (ctx) => {
      const ua = parseUserAgent(header(ctx, 'user-agent'))
      const values = [
        ua?.model,
        unquote(header(ctx, 'sec-ch-ua-model')),
        ctx.js.device?.model,
        ctx.js.uaDataHighEntropy?.model
      ].filter((value) => value !== undefined && value !== '')
      const ok = values.length > 1 && new Set(values).size === 1
      return verdict('c.model', 'client', ok, values.join('/') || undefined, 'one model everywhere')
    }
  },
  {
    id: 'c.android.version',
    run: (ctx) => {
      const ua = parseUserAgent(header(ctx, 'user-agent'))
      const major = (value) => (typeof value === 'string' ? value.split('.')[0] : undefined)
      const values = [
        major(ua?.androidVersion),
        major(unquote(header(ctx, 'sec-ch-ua-platform-version'))),
        major(ctx.js.device?.version),
        major(ctx.js.uaDataHighEntropy?.platformVersion)
      ].filter((value) => value !== undefined)
      const ok = values.length > 1 && new Set(values).size === 1
      return verdict('c.android.version', 'client', ok, values.join('/') || undefined, 'one Android major everywhere')
    }
  },
  {
    id: 'c.gpu.model',
    run: (ctx) => {
      const ua = parseUserAgent(header(ctx, 'user-agent'))
      const renderer = ctx.js.webgl2?.renderer ?? ctx.js.webgl1?.renderer
      if (!ua || !renderer) return verdict('c.gpu.model', 'client', false, renderer, 'GPU matching the model')
      // a desktop part is wrong whatever the model claims to be - the table
      // below only refines which mobile GPU is expected, it is not what decides
      // that the renderer is mobile at all
      if (/apple|angle|intel|nvidia|geforce|radeon|llvmpipe|swiftshader/i.test(renderer)) {
        return verdict('c.gpu.model', 'client', false, `${ua.model} -> ${renderer}`, 'a mobile GPU')
      }
      const rule = DEVICE_GPU.find((entry) => entry.model.test(ua.model))
      // an unknown model is not a failure: the table only covers what the
      // profile can currently produce
      const ok = !rule || rule.gpu.test(renderer)
      return verdict('c.gpu.model', 'client', ok, `${ua.model} -> ${renderer}`, 'GPU consistent with the model')
    }
  },
  {
    id: 'c.ua.vs.js',
    run: (ctx) => {
      const headerUa = header(ctx, 'user-agent')
      const ok = headerUa !== undefined && ctx.js.userAgent !== undefined && headerUa === ctx.js.userAgent
      return verdict('c.ua.vs.js', 'client', ok, `${headerUa} | ${ctx.js.userAgent}`, 'header and navigator agree')
    }
  }
]
