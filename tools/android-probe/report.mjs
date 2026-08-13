/**
 * Prints a run, and diffs it against the previous one.
 *
 *   node tools/android-probe/report.mjs           latest run
 *   node tools/android-probe/report.mjs --diff    latest vs the one before it
 *   node tools/android-probe/report.mjs --final   grouped, with what is left uncovered
 *
 * The diff is the part that matters during the fix cycle: a correction that
 * turns one FAIL into a PASS while quietly breaking two others looks like
 * progress in the totals and like what it is here.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { evaluateAll, summarize } from './signals/index.mjs'

const RUNS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'runs')

const loadRuns = () => {
  if (!fs.existsSync(RUNS)) return []
  return fs
    .readdirSync(RUNS)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => ({ name, ...JSON.parse(fs.readFileSync(path.join(RUNS, name), 'utf8')) }))
}

const MARK = { PASS: '  ok  ', FAIL: ' FAIL ', MISSING: ' miss ', ERROR: ' ERR  ' }

const printRun = (run) => {
  console.log(`\n${run.name}  (${run.at})`)
  if (run.trusted === false) {
    console.log(`!! NOT taken from the game frame (${run.context?.href ?? 'unknown'}) - these verdicts describe`)
    console.log('   a document the overrides were never installed into, so they mean nothing.\n')
  }
  console.log(`PASS ${run.totals.pass} · FAIL ${run.totals.fail} · MISSING ${run.totals.missing} · ERROR ${run.totals.error}\n`)
  for (const family of ['M', 'D', 'C']) {
    const rows = run.results.filter((result) => result.family === family)
    if (!rows.length) continue
    console.log(`-- family ${family} ${{ M: '(looks tampered with)', D: '(reveals the host)', C: '(inconsistent)' }[family]}`)
    for (const row of rows) {
      console.log(`${MARK[row.verdict]} ${row.id.padEnd(26)} ${String(row.observed ?? '').slice(0, 80)}`)
    }
    console.log('')
  }
}

const printDiff = (previous, current) => {
  const before = new Map(previous.results.map((result) => [result.id, result.verdict]))
  const after = new Map(current.results.map((result) => [result.id, result.verdict]))
  const fixed = []
  const broken = []
  const added = []

  for (const [id, verdict] of after) {
    if (!before.has(id)) added.push(`${id} (${verdict})`)
    else if (before.get(id) !== 'PASS' && verdict === 'PASS') fixed.push(id)
    else if (before.get(id) === 'PASS' && verdict !== 'PASS') broken.push(`${id} -> ${verdict}`)
  }

  console.log(`\ndiff ${previous.name} -> ${current.name}`)
  console.log(`  fixed:    ${fixed.length ? fixed.join(', ') : '(none)'}`)
  console.log(`  REGRESSED:${broken.length ? ' ' + broken.join(', ') : ' (none)'}`)
  console.log(`  new:      ${added.length ? added.join(', ') : '(none)'}`)
  if (broken.length) {
    console.log('\n  a regression here means the last fix changed how the others are applied - revert before continuing')
  }
}

const printFinal = (run) => {
  printRun(run)
  const stuck = run.results.filter((result) => result.verdict === 'FAIL')
  const groups = {
    client: stuck.filter((result) => result.fixable === 'client'),
    network: stuck.filter((result) => result.fixable === 'network'),
    no: stuck.filter((result) => result.fixable === 'no')
  }
  console.log('-- what is left')
  console.log(`  still fixable client-side: ${groups.client.map((result) => result.id).join(', ') || '(none)'}`)
  console.log(`  network layer, out of reach from JS: ${groups.network.map((result) => result.id).join(', ') || '(none)'}`)
  console.log(`  accepted as not worth fixing: ${groups.no.map((result) => result.id).join(', ') || '(none)'}`)
  const missing = run.results.filter((result) => result.verdict === 'MISSING')
  console.log(`  MISSING (API absent - not necessarily a failure): ${missing.map((result) => result.id).join(', ') || '(none)'}`)

  // Without this the line above reads as "no network-layer problems found",
  // when what it means is that nothing looked. An unmeasured layer reported as
  // empty is worse than no report at all.
  console.log('\n-- NOT MEASURED (no evaluator exists, so no verdict either way)')
  console.log('  TLS fingerprint (JA3/JA4): cipher and extension order is Chrome desktop, not Chrome Android')
  console.log('  HTTP/2 SETTINGS frame and pseudo-header order')
  console.log('  TCP/IP stack fingerprint')
  console.log('  These need a capture below the HTTP layer. A checker reading any of them is')
  console.log('  unaffected by everything above.')
}

const runs = loadRuns()
if (!runs.length) {
  console.error('no runs yet - start the server and inject probe.js into the game frame')
  process.exit(1)
}

/**
 * Re-grades a stored capture with the current evaluators.
 *
 * Correcting an evaluator is as much a part of the cycle as correcting the
 * client, and when it happens the old verdicts are wrong rather than stale. The
 * capture holds everything the grading needs, so this re-reads it instead of
 * asking for the measurement to be taken again - which for the game frame means
 * a person driving the app by hand.
 */
const reevaluate = (run) => {
  const ctx = { http: run.capture.http, js: run.capture.js }
  const results = evaluateAll(ctx)
  const totals = summarize(results)
  const before = new Map(run.results.map((result) => [result.id, result.verdict]))

  console.log(`\nre-graded ${run.name} with the current evaluators`)
  console.log(`  was: PASS ${run.totals.pass} · FAIL ${run.totals.fail} · MISSING ${run.totals.missing}`)
  console.log(`  now: PASS ${totals.pass} · FAIL ${totals.fail} · MISSING ${totals.missing}`)
  const changed = results.filter((result) => before.get(result.id) !== result.verdict)
  for (const result of changed) {
    console.log(`  ${result.id}: ${before.get(result.id)} -> ${result.verdict}`)
  }
  if (!changed.length) console.log('  (no verdict changed)')

  fs.writeFileSync(path.join(RUNS, run.name), JSON.stringify({ ...run, name: undefined, totals, results }, null, 2))
}

const mode = process.argv[2]
if (mode === '--reeval') {
  reevaluate(runs[runs.length - 1])
} else if (mode === '--diff') {
  if (runs.length < 2) {
    console.error('need at least two runs to diff')
    process.exit(1)
  }
  printDiff(runs[runs.length - 2], runs[runs.length - 1])
} else if (mode === '--final') {
  printFinal(runs[runs.length - 1])
} else {
  printRun(runs[runs.length - 1])
}
