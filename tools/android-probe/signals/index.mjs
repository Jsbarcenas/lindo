import { COHERENCE_SIGNALS } from './coherence.mjs'
import { HTTP_SIGNALS } from './http.mjs'
import { JS_SIGNALS } from './js.mjs'

export const ALL_SIGNALS = [...HTTP_SIGNALS, ...JS_SIGNALS, ...COHERENCE_SIGNALS]

/**
 * Runs every evaluator over one capture.
 *
 * An evaluator that throws becomes an ERROR row rather than taking the run down:
 * a report missing one signal is still worth having, and silently dropping it
 * would read as "not checked" when it was in fact broken.
 */
export const evaluateAll = (ctx) =>
  ALL_SIGNALS.map((signal) => {
    try {
      return signal.run(ctx)
    } catch (error) {
      return {
        id: signal.id,
        layer: 'harness',
        family: '-',
        verdict: 'ERROR',
        observed: error.message,
        expected: 'evaluator to run',
        fixable: 'no'
      }
    }
  })

export const summarize = (results) => ({
  pass: results.filter((result) => result.verdict === 'PASS').length,
  fail: results.filter((result) => result.verdict === 'FAIL').length,
  missing: results.filter((result) => result.verdict === 'MISSING').length,
  error: results.filter((result) => result.verdict === 'ERROR').length
})
