/**
 * Syntax + logic harness for @kuixiu/dsh-pet/client.js.
 *
 * 1. Parses the client module with `new Function(...)` to prove there is no
 *    syntax error (browser-only globals are stubbed).
 * 2. Extracts the schedule section from the real source and evaluates it, so the
 *    assertions below run against the shipped code rather than a reimplementation.
 *
 * The expected values encode the official rule:
 *   peak = Beijing Mon-Fri 09:00-12:00 and 14:00-18:00, excluding Chinese public
 *   holidays; weekends and holidays are off-peak all day.
 */
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./client.js', import.meta.url), 'utf8');

/* ── 1. syntax check: the same wrapper the page uses ───────────────────────── */
let captured = null;
const windowStub = {
  __ModuleLoader__: {
    load(entry) {
      captured = entry;
    },
  },
};
try {
  new Function('window', source)(windowStub);
} catch (error) {
  console.error('SYNTAX FAIL:', error.message);
  process.exit(1);
}
if (captured === null || captured.id !== '@kuixiu/dsh-pet') {
  console.error('SYNTAX FAIL: loader entry not registered under the package name');
  process.exit(1);
}

let plugin;
try {
  plugin = captured.factory((name) => {
    if (name === 'react') {
      const stub = () => null;
      return {
        createElement: stub,
        useState: stub,
        useEffect: stub,
        useRef: stub,
        useCallback: stub,
        useMemo: stub,
        useSyncExternalStore: stub,
      };
    }
    throw new Error(`unexpected require: ${name}`);
  });
} catch (error) {
  console.error('FACTORY FAIL:', error.message);
  process.exit(1);
}
if (typeof plugin.apply !== 'function' || !Array.isArray(plugin.inject)) {
  console.error('FACTORY FAIL: plugin shape is not { inject, apply }');
  process.exit(1);
}
console.log('syntax OK: id, factory, inject =', JSON.stringify(plugin.inject));

/* ── 2. extract and evaluate the real schedule section ────────────────────── */
const start = source.indexOf('const SCHEDULE = {');
const end = source.indexOf('/* ─────────────────────────── one shared clock');
if (start < 0 || end < 0) {
  console.error('EXTRACT FAIL: schedule section not found');
  process.exit(1);
}
const section = source.slice(start, end);
let api;
try {
  api = new Function(
    `${section}
     return { SCHEDULE, HOLIDAYS_2026, beijingParts, beijingDisplay, isPeak, nextTransition, computeScheduleState, formatDuration };`,
  )();
} catch (error) {
  console.error('EVAL FAIL:', error.message);
  process.exit(1);
}
const { SCHEDULE, HOLIDAYS_2026, beijingParts, beijingDisplay, isPeak, nextTransition, computeScheduleState, formatDuration } = api;

/* ── 3. assertions ───────────────────────────────────────────────────────── */
let failures = 0;
const check = (label, actual, expected) => {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${actual}${ok ? '' : ` (expected ${expected})`}`);
};

const NO_HOLIDAYS = [];
const bj = (y, m, d, hh, mm) => Date.UTC(y, m - 1, d, hh - 8, mm); // Beijing wall clock -> instant

/* weekday baseline: 2026-03-02 Monday, 2026-03-06 Friday, 2026-03-07 Saturday */
check('2026-03-02 is Monday', new Date(bj(2026, 3, 2, 12, 0)).getUTCDay(), 1);
check('2026-03-07 is Saturday', new Date(bj(2026, 3, 7, 12, 0)).getUTCDay(), 6);

// Beijing peak windows, half-open.
check('Mon 08:59 Beijing off-peak', isPeak(bj(2026, 3, 2, 8, 59), NO_HOLIDAYS), false);
check('Mon 09:00 Beijing peak', isPeak(bj(2026, 3, 2, 9, 0), NO_HOLIDAYS), true);
check('Mon 11:59 Beijing peak', isPeak(bj(2026, 3, 2, 11, 59), NO_HOLIDAYS), true);
check('Mon 12:00 Beijing off-peak', isPeak(bj(2026, 3, 2, 12, 0), NO_HOLIDAYS), false);
check('Mon 13:59 Beijing off-peak', isPeak(bj(2026, 3, 2, 13, 59), NO_HOLIDAYS), false);
check('Mon 14:00 Beijing peak', isPeak(bj(2026, 3, 2, 14, 0), NO_HOLIDAYS), true);
check('Mon 17:59 Beijing peak', isPeak(bj(2026, 3, 2, 17, 59), NO_HOLIDAYS), true);
check('Mon 18:00 Beijing off-peak', isPeak(bj(2026, 3, 2, 18, 0), NO_HOLIDAYS), false);
check('Mon 23:59 Beijing off-peak', isPeak(bj(2026, 3, 2, 23, 59), NO_HOLIDAYS), false);

// The UTC equivalents of the same instants.
check('Mon 01:00 UTC peak', isPeak(Date.UTC(2026, 2, 2, 1, 0), NO_HOLIDAYS), true);
check('Mon 06:00 UTC peak', isPeak(Date.UTC(2026, 2, 2, 6, 0), NO_HOLIDAYS), true);
check('Mon 04:00 UTC off-peak', isPeak(Date.UTC(2026, 2, 2, 4, 0), NO_HOLIDAYS), false);

// Weekend, including the 调休 make-up weekend days DeepSeek bills off-peak.
check('Sat 10:00 Beijing off-peak', isPeak(bj(2026, 3, 7, 10, 0), NO_HOLIDAYS), false);
check('Sun 15:00 Beijing off-peak', isPeak(bj(2026, 3, 8, 15, 0), NO_HOLIDAYS), false);
check('[BUG GUARD] Sat 2026-09-20 (make-up workday) 10:00 Beijing off-peak', isPeak(bj(2026, 9, 20, 10, 0), NO_HOLIDAYS), false);
check('[BUG GUARD] Sat 2026-10-10 (make-up workday) 15:00 Beijing off-peak', isPeak(bj(2026, 10, 10, 15, 0), NO_HOLIDAYS), false);

// Chinese public holidays never peak, even on a weekday inside a window.
check('National Day Thu 2026-10-01 10:00 Beijing off-peak', isPeak(bj(2026, 10, 1, 10, 0), HOLIDAYS_2026), false);
check('National Day Tue 2026-10-06 15:00 Beijing off-peak', isPeak(bj(2026, 10, 6, 15, 0), HOLIDAYS_2026), false);
check('Spring Festival 2026-02-17 10:00 Beijing off-peak', isPeak(bj(2026, 2, 17, 10, 0), HOLIDAYS_2026), false);
check('Labour Day 2026-05-01 15:00 Beijing off-peak', isPeak(bj(2026, 5, 1, 15, 0), HOLIDAYS_2026), false);
check('Mid-Autumn 2026-09-25 10:00 Beijing off-peak', isPeak(bj(2026, 9, 25, 10, 0), HOLIDAYS_2026), false);
// A non-holiday weekday in the same month still peaks.
check('2026-10-08 (Thu, not a holiday) 10:00 Beijing peak', isPeak(bj(2026, 10, 8, 10, 0), HOLIDAYS_2026), true);

// 2026-10-06 18:04 Beijing — the instant this plugin was written — is off-peak.
check('now (2026-10-06 18:04 Beijing) off-peak', isPeak(Date.UTC(2026, 9, 6, 10, 4), HOLIDAYS_2026), false);

// The holiday table's weekday membership is exactly the announced set.
const holidayWeekdays = HOLIDAYS_2026.map((date) => `${date} ${new Date(`${date}T00:00:00Z`).getUTCDay()}`);
console.log('  holiday weekdays (0=Sun):', holidayWeekdays.join(', '));
check('holiday set size', HOLIDAYS_2026.length, 19);
check('no holiday entry falls on a weekend', holidayWeekdays.some((v) => v.endsWith(' 0') || v.endsWith(' 6')), false);

// Beijing date/clock reads.
check('beijingParts date at UTC 2026-10-06T10:04Z', beijingParts(Date.UTC(2026, 9, 6, 10, 4)).date, '2026-10-06');
check('beijingParts minute at UTC 2026-10-06T10:04Z', beijingParts(Date.UTC(2026, 9, 6, 10, 4)).minute, 18 * 60 + 4);
check('beijingDisplay at UTC 2026-10-06T10:04Z', beijingDisplay(Date.UTC(2026, 9, 6, 10, 4)), '2026-10-06 18:04');
// UTC 16:00 is Beijing 00:00 of the NEXT day: the regression the UTC weekday test had.
check('UTC 2026-03-02T16:30Z is Beijing 2026-03-03', beijingParts(Date.UTC(2026, 2, 2, 16, 30)).date, '2026-03-03');
check('UTC 2026-03-02T16:30Z is off-peak', isPeak(Date.UTC(2026, 2, 2, 16, 30), NO_HOLIDAYS), false);

// Transition scans.
check(
  'Mon 10:00 Beijing -> next change Mon 12:00 Beijing',
  new Date(nextTransition(bj(2026, 3, 2, 10, 0), NO_HOLIDAYS)).toISOString(),
  new Date(bj(2026, 3, 2, 12, 0)).toISOString(),
);
check(
  'Mon 12:30 Beijing -> next change Mon 14:00 Beijing',
  new Date(nextTransition(bj(2026, 3, 2, 12, 30), NO_HOLIDAYS)).toISOString(),
  new Date(bj(2026, 3, 2, 14, 0)).toISOString(),
);
check(
  'Fri 18:30 Beijing -> next change Mon 09:00 Beijing (skips the weekend)',
  new Date(nextTransition(bj(2026, 3, 6, 18, 30), NO_HOLIDAYS)).toISOString(),
  new Date(bj(2026, 3, 9, 9, 0)).toISOString(),
);
check(
  'Thu 2026-09-24 18:30 Beijing -> next change Mon 2026-09-28 09:00 Beijing (skips Mid-Autumn + weekend)',
  new Date(nextTransition(bj(2026, 9, 24, 18, 30), HOLIDAYS_2026)).toISOString(),
  new Date(bj(2026, 9, 28, 9, 0)).toISOString(),
);
check(
  'Wed 2026-09-30 18:30 Beijing -> next change Thu 2026-10-08 09:00 Beijing (skips National Day)',
  new Date(nextTransition(bj(2026, 9, 30, 18, 30), HOLIDAYS_2026)).toISOString(),
  new Date(bj(2026, 10, 8, 9, 0)).toISOString(),
);

// Every sampled transition must flip the phase and land on an exact minute.
let flips = 0;
let bad = null;
for (let i = 0; i < 20 * 24 * 60; i += 13) {
  const at = bj(2026, 9, 20, 0, 0) + i * 60000;
  const to = nextTransition(at, HOLIDAYS_2026);
  if (to === null || isPeak(at, HOLIDAYS_2026) === isPeak(to, HOLIDAYS_2026) || to % 60000 !== 0) {
    bad = new Date(at).toISOString();
    break;
  }
  flips++;
}
check(`sampled transitions all flip the phase (${flips} samples)`, bad, null);

// Snapshot shape used by the widget.
const snapshot = computeScheduleState(bj(2026, 3, 2, 10, 30));
check('snapshot phase Mon 10:30 Beijing', snapshot.phase, 'peak');
check('snapshot beijingText Mon 10:30 Beijing', snapshot.beijingText, '10:30');
check('snapshot beijingDate', snapshot.beijingDate, '2026-03-02');
check('snapshot holiday false on 2026-03-02', snapshot.holiday, false);
check('snapshot weekend false on 2026-03-02', snapshot.weekend, false);
check('snapshot nextAt Mon 10:30 Beijing', new Date(snapshot.nextAt).toISOString(), new Date(bj(2026, 3, 2, 12, 0)).toISOString());

const holidaySnapshot = computeScheduleState(bj(2026, 10, 6, 18, 4));
check('snapshot phase on National Day', holidaySnapshot.phase, 'offpeak');
check('snapshot holiday true on National Day', holidaySnapshot.holiday, true);
check('snapshot beijingDate on National Day', holidaySnapshot.beijingDate, '2026-10-06');

// Countdown formatting.
check('formatDuration 4h', formatDuration(4 * 3600 * 1000), '04:00:00');
check('formatDuration 59m59s', formatDuration(59 * 60 * 1000 + 59000), '59:59');
check('formatDuration negative clamps', formatDuration(-5000), '00:00');

check('schedule discount is 50%', SCHEDULE.discount, 50);
check('schedule verified date recorded', SCHEDULE.verified, '2026-10-06');

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
