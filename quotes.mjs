/**
 * Quote harness for @kuixiu/dsh-pet/client.js.
 *
 * Extracts the inline quote bank and the two pure selection helpers from the
 * real source, then checks the things that make the feature pleasant rather
 * than annoying: every line exists in both languages and is short enough for a
 * single-line bubble, ids are unique, the band follows the moment, and the pick
 * avoids repeating itself.
 */
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./client.js', import.meta.url), 'utf8');

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
};
const fail = (label) => {
  failures++;
  console.log(`FAIL  ${label}`);
};

/* ── extract the bank + selectors ─────────────────────────────────────────── */
const bankStart = source.indexOf('const QUOTES = {');
const bankEnd = source.indexOf('/** Flat id -> [en, zh] index');
const bandStart = source.indexOf('const quoteBand =');
const chooseEnd = source.indexOf('const quoteText = (id, isEnglish) => {');
for (const [label, index] of [
  ['QUOTES', bankStart],
  ['QUOTE_BY_ID index', bankEnd],
  ['quoteBand', bandStart],
  ['chooseQuote end', chooseEnd],
]) {
  if (index < 0) {
    console.error(`EXTRACT FAIL: marker ${label} not found`);
    process.exit(1);
  }
}
let api;
try {
  api = new Function(
    `${source.slice(bankStart, bankEnd)}
     ${source.slice(bankStart + source.slice(bankStart).indexOf('/** Flat id -> [en, zh] index'), bandStart)}
     ${source.slice(bandStart, chooseEnd)}
     return { QUOTES, QUOTE_BY_ID, quoteBand, chooseQuote, pickQuoteIndex, QUOTE_SHOW_MS };`,
  )();
} catch (error) {
  console.error('EVAL FAIL:', error.message);
  process.exit(1);
}
const { QUOTES, QUOTE_BY_ID, quoteBand, chooseQuote, pickQuoteIndex, QUOTE_SHOW_MS } = api;

/* ── the bank ─────────────────────────────────────────────────────────────── */
const BANDS = ['idle', 'done', 'stuck', 'night'];
check('the bank has the four expected bands', Object.keys(QUOTES), BANDS);

let total = 0;
const ids = [];
for (const band of BANDS) {
  const pool = QUOTES[band];
  if (!Array.isArray(pool) || pool.length < 4) fail(`${band} needs at least 4 lines (has ${pool?.length})`);
  for (const entry of pool) {
    if (!Array.isArray(entry) || entry.length !== 3) {
      fail(`${band} has a malformed entry: ${JSON.stringify(entry)}`);
      continue;
    }
    const [id, en, zh] = entry;
    ids.push(id);
    total++;
    if (typeof id !== 'string' || id === '') fail(`${band} has an empty id`);
    if (typeof en !== 'string' || en.trim() === '') fail(`${id} has no English line`);
    if (typeof zh !== 'string' || zh.trim() === '') fail(`${id} has no Chinese line`);
    // The bubble is a narrow pill above the cat: a long line wraps badly.
    if (en.length > 60) fail(`${id} English line is too long (${en.length} chars)`);
    if (zh.length > 28) fail(`${id} Chinese line is too long (${zh.length} chars)`);
    if (en === zh) fail(`${id} English and Chinese are identical`);
  }
}
console.log(`  ${total} lines across ${BANDS.length} bands`);
check('all ids are unique', ids.length, new Set(ids).size);
check('every id resolves in the index', ids.every((id) => QUOTE_BY_ID[id] !== undefined), true);
check('the index size matches the bank', Object.keys(QUOTE_BY_ID).length, total);

/* ── band selection ───────────────────────────────────────────────────────── */
check('a finished turn picks done', quoteBand('done', false, 14), 'done');
check('celebrating picks done', quoteBand('idle', true, 14), 'done');
check('a finished turn beats the late hour', quoteBand('done', false, 2), 'done');
check('waiting picks the reassuring band', quoteBand('waiting', false, 14), 'stuck');
check('waiting beats the late hour', quoteBand('waiting', false, 2), 'stuck');
check('idle at 10:00 picks idle', quoteBand('idle', false, 10), 'idle');
check('idle at 23:00 picks night', quoteBand('idle', false, 23), 'night');
check('idle at 02:00 picks night', quoteBand('idle', false, 2), 'night');
check('idle at 05:00 is no longer night', quoteBand('idle', false, 5), 'idle');
check('idle at 22:59 is not night', quoteBand('idle', false, 22), 'idle');
check('running falls through to idle/night', quoteBand('running', false, 14), 'idle');

/* ── picking ──────────────────────────────────────────────────────────────── */
check('pickQuoteIndex maps draw 0 to the first entry', pickQuoteIndex(4, -1, 0), 0);
check('pickQuoteIndex maps draw 0.5 to the middle', pickQuoteIndex(4, -1, 0.5), 2);
check('pickQuoteIndex clamps draw 1 to the last entry', pickQuoteIndex(4, -1, 1), 0);
check('pickQuoteIndex advances past the previous entry', pickQuoteIndex(4, 1, 0.25), 2);
check('pickQuoteIndex wraps from the last entry', pickQuoteIndex(4, 3, 0.75), 0);
check('pickQuoteIndex on an empty pool is -1', pickQuoteIndex(0, -1, 0.5), -1);
check('pickQuoteIndex on a single-entry pool is 0', pickQuoteIndex(1, 0, 0.9), 0);
// A hostile/absent draw must still land inside the pool.
for (const draw of [undefined, null, NaN, -3, 7.5, 'x']) {
  const index = pickQuoteIndex(5, -1, draw);
  if (!Number.isInteger(index) || index < 0 || index > 4) fail(`pickQuoteIndex(5,-1,${String(draw)}) = ${index}`);
}
console.log('PASS  pickQuoteIndex stays in range for hostile draws');

// The chosen id always exists in the requested band.
for (const band of BANDS) {
  const id = chooseQuote(band, null, 0.42);
  const pool = QUOTES[band].map((entry) => entry[0]);
  if (!pool.includes(id)) fail(`chooseQuote(${band}) returned ${id}, not in that band`);
}
console.log('PASS  chooseQuote always returns an id from the requested band');

check('an unknown band falls back to idle', QUOTES[chooseQuote('nonsense', null, 0).replace(/-\d+$/, '')] !== undefined, true);
const unknownBand = chooseQuote('does-not-exist', null, 0);
if (!QUOTES.idle.map((entry) => entry[0]).includes(unknownBand)) {
  fail(`an unknown band should fall back to idle, got ${unknownBand}`);
} else {
  console.log('PASS  an unknown band falls back to idle');
}

// Consecutive draws with the same index must not repeat the previous line.
let previous = null;
let repeats = 0;
for (let i = 0; i < 200; i++) {
  const id = chooseQuote('idle', previous, (i % 12) / 12);
  if (id === previous) repeats++;
  previous = id;
}
check('no immediate repeats over 200 draws', repeats, 0);

/* ── timing constants ─────────────────────────────────────────────────────── */
check('a line stays up for a few seconds', QUOTE_SHOW_MS >= 5000 && QUOTE_SHOW_MS <= 15000, true);

console.log(failures === 0 ? '\nQUOTE HARNESS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
