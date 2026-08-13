/**
 * Acceptance for the evaluators.
 *
 *   node --test tools/android-probe/
 *
 * The bar from the plan: every evaluator has to PASS a real Android capture and
 * FAIL a macOS one. An evaluator that passes both is not measuring anything, and
 * that is the failure mode worth guarding - it produces a clean report that
 * means nothing at all.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { ALL_SIGNALS, evaluateAll, summarize } from './signals/index.mjs'
import { HOST_MACOS, REAL_ANDROID, SPOOFED_DETECTABLY } from './fixtures.mjs'

const byId = (results) => new Map(results.map((result) => [result.id, result]))

test('a real Android capture passes every signal', () => {
  const results = evaluateAll(REAL_ANDROID)
  const bad = results.filter((result) => result.verdict !== 'PASS')
  assert.deepEqual(
    bad.map((result) => `${result.id}=${result.verdict}(${result.observed})`),
    [],
    'nothing should flag on a genuine device'
  )
})

test('a macOS host fails the signals that can see it', () => {
  const results = byId(evaluateAll(HOST_MACOS))
  for (const id of [
    'http.ch.platform',
    'http.ch.mobile',
    'http.ch.highentropy',
    'http.sec.fetch',
    'js.uad.platform',
    'js.platform',
    'js.touch',
    'js.plugins',
    'js.device',
    'js.webgl',
    'js.webgpu',
    'js.voices',
    'js.mq',
    'm.iframe.escape',
    'm.worker.escape',
    'c.chrome.version',
    'c.model'
  ]) {
    const result = results.get(id)
    assert.ok(result, `${id} missing from the catalog`)
    assert.notEqual(result.verdict, 'PASS', `${id} should not pass on a macOS host`)
  }
})

test('the current overrides are caught by the tamper checks', () => {
  const results = byId(evaluateAll(SPOOFED_DETECTABLY))

  // the values themselves are now right...
  assert.equal(results.get('js.platform').verdict, 'PASS')
  assert.equal(results.get('js.uad.platform').verdict, 'PASS')
  assert.equal(results.get('js.webgl').verdict, 'PASS')

  // ...and every one of these still gives the spoof away
  for (const id of ['m.descriptor.navigator', 'm.tostring.getparameter', 'm.tostring.generic', 'm.iframe.escape', 'm.worker.escape']) {
    assert.equal(results.get(id).verdict, 'FAIL', `${id} should catch a window-only override`)
  }
})

/**
 * Signals that give the same verdict on both fixtures **by design**, with the
 * reason. Anything not listed here has to discriminate, or it is dead weight
 * producing a clean-looking report.
 */
const INERT_BY_DESIGN = {
  'http.ua': 'the old setup already sent a valid Android User-Agent - it was never the leak',
  'http.accept.lang': 'the language says nothing about the platform',
  'js.vendor': 'Chrome reports "Google Inc." on every platform',
  'js.webdriver': 'an automation check, not a platform one',
  'js.perfmemory': 'every Chromium exposes performance.memory, so it separates nothing - it is kept to catch it being removed',
  'c.ua.vs.js': 'the header and navigator agreed before the work started too'
}

test('every D and C signal separates a real device from the bare host', () => {
  const android = byId(evaluateAll(REAL_ANDROID))
  const macos = byId(evaluateAll(HOST_MACOS))

  const inert = ALL_SIGNALS.filter((signal) => {
    const family = android.get(signal.id).family
    if (family === 'M') return false // graded against the spoofed fixture instead
    return android.get(signal.id).verdict === macos.get(signal.id).verdict
  }).map((signal) => signal.id)

  assert.deepEqual(inert.sort(), Object.keys(INERT_BY_DESIGN).sort(), 'a signal stopped discriminating, or a new inert one was added')
})

test('every M signal separates a real device from a detectably spoofed one', () => {
  const android = byId(evaluateAll(REAL_ANDROID))
  const spoofed = byId(evaluateAll(SPOOFED_DETECTABLY))

  const inert = ALL_SIGNALS.filter((signal) => android.get(signal.id).family === 'M')
    .filter((signal) => android.get(signal.id).verdict === spoofed.get(signal.id).verdict)
    .map((signal) => signal.id)

  // the header ones read the request, which a window-only override cannot
  // affect; m.stack depends on where the code is served from, not on the spoof
  assert.deepEqual(
    inert.sort(),
    ['http.ch.brands', 'http.header.order', 'http.sec.fetch', 'm.stack'],
    'an M signal stopped catching the spoof'
  )
})

test('evaluators never take a run down', () => {
  const results = evaluateAll({ http: { headers: [], httpVersion: '1.1' }, js: {} })
  assert.equal(summarize(results).error, 0, 'an empty capture must produce verdicts, not throws')
  assert.equal(results.length, ALL_SIGNALS.length)
})
