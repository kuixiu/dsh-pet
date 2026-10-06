/**
 * Cost harness for @kuixiu/dsh-pet/client.js.
 *
 * Extracts the real rate card and the real ledger fold from the source, then
 * checks the money against hand-computed values from the official price list:
 *
 *   deepseek-flash  cache-hit input ¥0.02 / cache-miss ¥1 / output ¥4  (per 1M)
 *   deepseek-v4-pro cache-hit input ¥0.15 / cache-miss ¥4.5 / output ¥13.5
 *   off-peak = exactly half of peak
 */
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./client.js', import.meta.url), 'utf8');

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
};

/* ── extract the pricing + ledger section ─────────────────────────────────── */
const scheduleStart = source.indexOf('const SCHEDULE = {');
const scheduleEnd = source.indexOf('const formatDuration');
const helperStart = source.indexOf('const clamp = ');
const helperEnd = source.indexOf('const DEFAULT_NAME =');
const costStart = source.indexOf('const RATES = {');
// The whole client module is wrapped in `window.__ModuleLoader__.load({...})`, so
// a slice must end on a complete top-level statement or the body stays
// unbalanced — which silently produced a malformed `priceBuckets` before.
const costEnd = source.indexOf('\n    const ACTIVITY_MOOD = {');
for (const [label, index] of [
  ['SCHEDULE', scheduleStart],
  ['scheduleEnd', scheduleEnd],
  ['clamp', helperStart],
  ['helperEnd', helperEnd],
  ['RATES', costStart],
  ['costEnd', costEnd],
]) {
  if (index < 0) {
    console.error(`EXTRACT FAIL: marker ${label} not found`);
    process.exit(1);
  }
}

/**
 * Build one function body from a source slice.
 *
 * The slice must end on a complete top-level statement: the whole client module
 * is wrapped in `window.__ModuleLoader__.load({...})`, so cutting at an arbitrary
 * later marker left the body unbalanced and silently produced a malformed
 * `priceBuckets` whose costs were all NaN. A bare parse check cannot catch this
 * (the already-evaluated body parses fine), so the boundary is pinned to an
 * exact statement below and the recovered functions are asserted to be
 * callable and finite by the checks that follow.
 */
const sliceBody = (label, text, suffix) => `${text}\n${suffix}`;

const localStorageStub = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
let api;
try {
  // Three separate evaluations avoid one combined body per slice (the schedule
  // slice already contains a top-level `return`).
  const helpers = new Function(
    sliceBody('helpers', source.slice(helperStart, helperEnd), 'return { clamp, finiteOr, scoreOr, nameOr, countOr, boolOr };'),
  )();
  const schedule = new Function(
    sliceBody('schedule', source.slice(scheduleStart, scheduleEnd), 'return { SCHEDULE, HOLIDAYS_2026, isPeak };'),
  )();
  api = new Function(
    'localStorage',
    'finiteOr',
    'isPeak',
    'SCHEDULE',
    'HOLIDAYS_2026',
    sliceBody(
      'cost',
      source.slice(costStart, costEnd),
      `return { RATES, ratesFor, tokenTotal, priceBuckets, multiplierAt, zeroBuckets,
              bucketsDelta, bucketsEqual, foldLedger, ledgerTotal, formatCost,
              emptyLedger, usageOf, routeModelOf };`,
    ),
  )(localStorageStub, helpers.finiteOr, schedule.isPeak, schedule.SCHEDULE, schedule.HOLIDAYS_2026);
} catch (error) {
  console.error('EVAL FAIL:', error.message);
  process.exit(1);
}
const {
  RATES,
  ratesFor,
  tokenTotal,
  priceBuckets,
  multiplierAt,
  zeroBuckets,
  bucketsDelta,
  bucketsEqual,
  foldLedger,
  ledgerTotal,
  formatCost,
  emptyLedger,
  usageOf,
  routeModelOf,
  isPeak,
} = api;

const M = 1_000_000;
console.log('DIAG RATES.per =', api.RATES.per, '| typeof finiteOr in scope =', typeof api.ratesFor('deepseek-flash'));
const buckets = (cacheRead, cacheWrite, uncachedInput, output) => ({
  cacheReadTokens: cacheRead,
  cacheWriteTokens: cacheWrite,
  uncachedInputTokens: uncachedInput,
  outputTokens: output,
});
const round6 = (n) => Math.round(n * 1e6) / 1e6;

/* ── rate card sanity ─────────────────────────────────────────────────────── */
check('rate card records a revision date', RATES.revision, '2026-10-06');
check('rate card is CNY', RATES.currency, 'CNY');
check('rate card is per 1M tokens', RATES.per, M);
check('flash rates match the published list', RATES.models['deepseek-flash'], {
  cacheRead: 0.02,
  uncachedInput: 1.0,
  cacheWrite: 1.0,
  output: 4.0,
});
check('v4-pro rates match the published list', RATES.models['deepseek-v4-pro'], {
  cacheRead: 0.15,
  uncachedInput: 4.5,
  cacheWrite: 4.5,
  output: 13.5,
});

/* ── model resolution ─────────────────────────────────────────────────────── */
check('exact model resolves', ratesFor('deepseek-flash')?.output, 4.0);
check('dated v4-pro snapshot resolves by prefix', ratesFor('DeepSeek-V4-Pro-0813')?.output, 13.5);
check('case is ignored', ratesFor('DEEPSEEK-FLASH')?.cacheRead, 0.02);
check('an unknown model has no rate card', ratesFor('gpt-4o'), undefined);
check('an empty model has no rate card', ratesFor(''), undefined);
check('a non-string model has no rate card', ratesFor(42), undefined);

/* ── one bucket at a time, exactly per 1M tokens ──────────────────────────── */
const flash = 'deepseek-flash';
check('1M cache-read flash = ¥0.02', round6(priceBuckets(buckets(M, 0, 0, 0), flash, 1).cost), 0.02);
check('1M uncached-input flash = ¥1', round6(priceBuckets(buckets(0, 0, M, 0), flash, 1).cost), 1);
check('1M output flash = ¥4', round6(priceBuckets(buckets(0, 0, 0, M), flash, 1).cost), 4);
check('1M cache-write flash = ¥1', round6(priceBuckets(buckets(0, M, 0, 0), flash, 1).cost), 1);
const pro = 'deepseek-v4-pro';
check('1M cache-read pro = ¥0.15', round6(priceBuckets(buckets(M, 0, 0, 0), pro, 1).cost), 0.15);
check('1M uncached-input pro = ¥4.5', round6(priceBuckets(buckets(0, 0, M, 0), pro, 1).cost), 4.5);
check('1M output pro = ¥13.5', round6(priceBuckets(buckets(0, 0, 0, M), pro, 1).cost), 13.5);

/* ── the whole-bucket sum ─────────────────────────────────────────────────── */
// 1M of each: 0.02 + 1 + 1 + 4 = 6.02
check('all four flash buckets at 1M = ¥6.02', round6(priceBuckets(buckets(M, M, M, M), flash, 1).cost), 6.02);
// A realistic turn: 200k cache-read, 20k cache-write, 30k uncached, 8k output.
// 200000/1e6*0.02 = 0.004 ; 20000/1e6*1 = 0.02 ; 30000/1e6*1 = 0.03 ; 8000/1e6*4 = 0.032
check(
  'a realistic flash turn costs ¥0.086',
  round6(priceBuckets(buckets(200_000, 20_000, 30_000, 8_000), flash, 1).cost),
  round6(0.004 + 0.02 + 0.03 + 0.032),
);
check(
  'the same turn off-peak costs exactly half',
  round6(priceBuckets(buckets(200_000, 20_000, 30_000, 8_000), flash, 0.5).cost * 2),
  round6(0.004 + 0.02 + 0.03 + 0.032),
);
check('an unknown model is reported unpriced', priceBuckets(buckets(M, 0, 0, 0), 'nope', 1), {
  cost: 0,
  priced: false,
  total: M,
});
check('tokenTotal sums the four buckets', tokenTotal(buckets(1, 2, 3, 4)), 10);
check('tokenTotal tolerates undefined fields', tokenTotal({ outputTokens: 5 }), 5);
check('zeroBuckets recognises an empty delta', zeroBuckets(buckets(0, 0, 0, 0)), true);
check('zeroBuckets rejects a non-empty delta', zeroBuckets(buckets(0, 0, 1, 0)), false);

/* ── the multiplier follows the schedule ──────────────────────────────────── */
const bj = (y, mo, d, hh, mm) => Date.UTC(y, mo - 1, d, hh - 8, mm);
check('a Monday 10:00 Beijing reading is peak', multiplierAt(bj(2026, 3, 2, 10, 0)), 1);
check('a Monday 13:00 Beijing reading is off-peak', multiplierAt(bj(2026, 3, 2, 13, 0)), 0.5);
check('a Saturday reading is off-peak', multiplierAt(bj(2026, 3, 7, 10, 0)), 0.5);

/* ── bucket deltas ────────────────────────────────────────────────────────── */
check('delta of identical buckets is zero', zeroBuckets(bucketsDelta(buckets(1, 1, 1, 1), buckets(1, 1, 1, 1))), true);
check('delta is per bucket', bucketsDelta(buckets(100, 0, 50, 20), buckets(160, 0, 70, 30)), {
  uncachedInputTokens: 20,
  outputTokens: 10,
  cacheReadTokens: 60,
  cacheWriteTokens: 0,
});
check('a shrinking bucket means a new generation', bucketsDelta(buckets(100, 0, 0, 0), buckets(10, 0, 0, 0)), undefined);

/* ── the ledger fold ──────────────────────────────────────────────────────── */
const now = bj(2026, 3, 2, 10, 0); // a peak instant
const first = foldLedger(emptyLedger(), 's1', buckets(1000, 0, 0, 0), flash, now);
check('the first reading of a session only sets the baseline', first.turnCost, 0);
check('the first reading banks no money', round6(ledgerTotal(first.ledger)), 0);
check('the baseline records the session id', first.ledger.sessionId, 's1');
check('the first reading anchors the turn baseline', first.ledger.turnBaseline, 0);

const second = foldLedger(first.ledger, 's1', buckets(1000 + M, 0, 0, 0), flash, now);
check('the next reading charges only its delta (¥0.02)', round6(second.turnCost), 0.02);
check('the peak bucket holds it', round6(second.ledger.peak), 0.02);
check('the off-peak bucket stays empty', second.ledger.offpeak, 0);
check('the total equals peak + off-peak', round6(ledgerTotal(second.ledger)), 0.02);

// The same delta observed off-peak lands in the off-peak bucket.
const offPeakNow = bj(2026, 3, 2, 13, 0);const third = foldLedger(second.ledger, 's1', buckets(1000 + 2 * M, 0, 0, 0), flash, offPeakNow);
check('an off-peak delta costs half (¥0.01)', round6(third.turnCost), 0.01);
check('it lands in the off-peak bucket', round6(third.ledger.offpeak), 0.01);
check('the peak bucket is untouched', round6(third.ledger.peak), 0.02);
check('the total is peak + off-peak', round6(ledgerTotal(third.ledger)), 0.03);

// A new session's larger totals must not double-charge the new session's history.
const switched = foldLedger(third.ledger, 's2', buckets(5 * M, 0, 0, 0), flash, now);
check('switching session re-baselines without charging', switched.turnCost, 0);
check('the running total is preserved across the switch', round6(ledgerTotal(switched.ledger)), 0.03);
check('the ledger now tracks the new session', switched.ledger.sessionId, 's2');

// Re-reading the same totals repeatedly must never charge again.
let repeat = switched.ledger;
for (let i = 0; i < 5; i++) repeat = foldLedger(repeat, 's2', buckets(5 * M, 0, 0, 0), flash, now).ledger;
check('identical re-reads never charge', round6(ledgerTotal(repeat)), 0.03);

// An unknown model still accumulates nothing rather than inventing money.
const unknown = foldLedger(emptyLedger(), 's3', buckets(0, 0, 0, 0), 'gpt-4o', now);
const unknown2 = foldLedger(unknown.ledger, 's3', buckets(M, 0, 0, 0), 'gpt-4o', now);
check('an unknown model charges nothing', unknown2.turnCost, 0);
check('an unknown model is flagged unpriced', unknown2.ledger.unpriced, true);

/* ── a turn is a SUM of calls, not one call ───────────────────────────────── */
// The projection grows on every model call inside a turn. The reported defect
// was that each increase announced its own amount; the fix pins a baseline when
// the turn starts and reports `total - baseline` once, at the turn boundary.
const turnTotal = (ledger) => ledgerTotal(ledger) - (ledger.turnBaseline ?? 0);

// Simulate one turn made of three model calls of a different size each.
const perCall = [
  buckets(100_000, 0, 10_000, 2_000), // call 1
  buckets(180_000, 0, 14_000, 6_000), // call 2
  buckets(260_000, 0, 20_000, 9_000), // call 3
];
const expectedPerCall = perCall.slice(1).map((next, index) => {
  const previous = perCall[index];
  const delta = {};
  for (const field of ['uncachedInputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens']) {
    delta[field] = next[field] - previous[field];
  }
  return priceBuckets(delta, flash, 1).cost;
});
const expectedTurn = expectedPerCall.reduce((sum, value) => sum + value, 0);
console.log(`  per-call amounts: ${expectedPerCall.map((v) => round6(v)).join(', ')} -> turn ${round6(expectedTurn)}`);

// Turn start: the baseline is pinned at the running total. `perCall[0]` only
// adopts the baseline (history is never billed), so it contributes no money.
let turnLedger = foldLedger(emptyLedger(), 'turn', perCall[0], flash, now).ledger;
turnLedger = Object.assign({}, turnLedger, { turnBaseline: ledgerTotal(turnLedger) });
check('right after the first call the turn total is 0', round6(turnTotal(turnLedger)), 0);

// Calls 2 and 3 land; the turn figure must be their SUM, not one call's amount.
let latest = turnLedger;
for (const call of perCall.slice(1)) latest = foldLedger(latest, 'turn', call, flash, now).ledger;
const reportedTurn = turnTotal(latest);
check('the turn total sums every charged call', round6(reportedTurn), round6(expectedTurn));
check(
  'the turn total is not just the last call',
  round6(reportedTurn) !== round6(expectedPerCall[expectedPerCall.length - 1]),
  true,
);
check(
  'the turn total is larger than any single call',
  expectedPerCall.every((value) => round6(reportedTurn) > round6(value)),
  true,
);
check('the session total also equals the summed calls', round6(ledgerTotal(latest)), round6(expectedTurn));

// Banking and the turn figure must agree: money is never counted twice.
check('banked total equals the summed call amounts', round6(ledgerTotal(latest)), round6(expectedTurn));

/* ── the baseline survives a reload and does not invent money ─────────────── */
// A reload mid-turn keeps the banked total and the baseline, so the turn figure
// stays a delta rather than replaying the whole session.
/* ── a reload does not replay the session's history ───────────────────────── */
// `perCall[0]` stands for history that predates the page, so it is adopted as
// the baseline and never billed; only work observed after the reload counts.
const midTurn = foldLedger(emptyLedger(), 'reload', perCall[0], flash, now).ledger;
const reloaded = Object.assign({}, midTurn, { turnBaseline: ledgerTotal(midTurn) });
const afterReload = foldLedger(reloaded, 'reload', perCall[1], flash, now).ledger;
console.log(
  `  reload: adopted history=${round6(priceBuckets(perCall[0], flash, 1).cost)} then charged=${round6(expectedPerCall[0])} banked=${round6(ledgerTotal(afterReload))}`,
);
check('a reloaded mid-turn ledger reports only the new call', round6(turnTotal(afterReload)), round6(expectedPerCall[0]));
check('the reloaded session total bills only what was observed', round6(ledgerTotal(afterReload)), round6(expectedPerCall[0]));
check('a reload never replays pre-page history', round6(ledgerTotal(afterReload)) < round6(priceBuckets(perCall[0], flash, 1).cost + expectedPerCall[0]), true);

// A new session re-anchors the baseline so the turn figure cannot go stale, and
// its history is adopted rather than re-charged.
const switchedTurn = foldLedger(afterReload, 'other-session', buckets(9 * M, 0, 0, 0), flash, now);
check('a new session reports no turn cost', switchedTurn.turnCost, 0);
check('a new session re-anchors the baseline', round6(switchedTurn.ledger.turnBaseline), round6(ledgerTotal(afterReload)));
check('the preserved total carries across the switch', round6(ledgerTotal(switchedTurn.ledger)), round6(ledgerTotal(afterReload)));
check('a turn total can never be negative', turnTotal(switchedTurn.ledger) >= 0, true);
// Switching BACK must not re-charge that session's whole history.
const backAgain = foldLedger(switchedTurn.ledger, 'reload', perCall[2], flash, now);
check('switching back does not re-charge history', round6(ledgerTotal(backAgain.ledger)), round6(ledgerTotal(switchedTurn.ledger)));
check('switching back reports no turn cost', backAgain.turnCost, 0);

/* ── formatting ───────────────────────────────────────────────────────────── */
check('zero formats as ¥0.00', formatCost(0, 'CNY'), '¥0.00');
check('a sub-cent amount keeps 4 decimals', formatCost(0.0086, 'CNY'), '¥0.0086');
check('a mid amount keeps 3 decimals', formatCost(0.086, 'CNY'), '¥0.086');
check('a larger amount keeps 2 decimals', formatCost(1.2345, 'CNY'), '¥1.23');
check('thousands are grouped', formatCost(1234.5, 'CNY').replace(/\u00a0/g, ' '), '¥1,234.50');
check('USD uses its own symbol', formatCost(0.5, 'USD'), '$0.500');
check('a non-finite amount is treated as zero', formatCost(NaN, 'CNY'), '¥0.00');

/* ── reading the projection ───────────────────────────────────────────────── */
check('usageOf reads the projection buckets', usageOf({ projectionValues: { tokenUsage: buckets(1, 2, 3, 4) } }), {
  uncachedInputTokens: 3,
  outputTokens: 4,
  cacheReadTokens: 1,
  cacheWriteTokens: 2,
});
check('usageOf is undefined without the projection', usageOf({ projectionValues: {} }), undefined);
check('usageOf tolerates a missing row', usageOf(undefined), undefined);
check('usageOf repairs malformed bucket values', usageOf({ projectionValues: { tokenUsage: { cacheReadTokens: NaN, outputTokens: '9', uncachedInputTokens: null, cacheWriteTokens: 4 } } }), {
  uncachedInputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 4,
});
check('routeModelOf defaults to the flash card', routeModelOf({}), 'deepseek-flash');

console.log(failures === 0 ? '\nCOST HARNESS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
