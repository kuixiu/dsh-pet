/**
 * Persistence harness for @kuixiu/dsh-pet/client.js.
 *
 * Reproduces the observed defect first ("undefined · 肚子饿了" and
 * "undefined · undefined · undefined" in the widget), then asserts the repaired
 * contract: a loaded pet always carries every field, whatever the stored JSON.
 *
 * Runs the real `emptyPet` / `sanitizePet` / `loadPet` / `savePet` / `decayed`
 * code extracted from client.js against a stub localStorage.
 */
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./client.js', import.meta.url), 'utf8');

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
};
const note = (label, value) => console.log(`NOTE  ${label}: ${JSON.stringify(value)}`);

/* ── stub localStorage ────────────────────────────────────────────────────── */
let store = {};
const localStorageStub = {
  getItem: (key) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
  setItem: (key, value) => {
    store[key] = String(value);
  },
  removeItem: (key) => {
    delete store[key];
  },
};

/* ── extract the pet-model section ────────────────────────────────────────── */
// Pieces in source order: drag helpers, then the pet model (emptyPet .. moodLevel).
const markers = {
  dragStart: source.indexOf('const DRAG_EDGE ='),
  dragEnd: source.indexOf('const useDrag = (onDrop)'),
  modelStart: source.indexOf("const DEFAULT_PET_NAME = '小橘';"),
  decayedStart: source.indexOf('const decayRate ='),
  usePetStart: source.indexOf('const usePet = () =>'),
  modelEnd: source.indexOf('const STYLE_ID ='),
};
const missingMarker = Object.entries(markers).find(([, index]) => index < 0);
if (missingMarker) {
  console.error(`EXTRACT FAIL: marker ${missingMarker[0]} not found`);
  process.exit(1);
}
const { dragStart, dragEnd, modelStart, decayedStart, usePetStart, modelEnd } = markers;
const storeKeyMatch = source.match(/const STORE_KEY = '([^']+)'/);
if (!storeKeyMatch) {
  console.error('EXTRACT FAIL: STORE_KEY not found');
  process.exit(1);
}
let api;
try {
  api = new Function(
    'localStorage',
    'STORE_KEY',
    'useState',
    'useRef',
    'useEffect',
    `${source.slice(modelStart, decayedStart)}
     ${source.slice(decayedStart, usePetStart)}
     ${source.slice(usePetStart, modelEnd)}
     return { STATS, emptyPet, clamp, finiteOr, cleanPetName, sanitizePet, loadPet, savePet, decayed, moodLevel, DEFAULT_PET_NAME, PET_NAME_MAX, QUOTE_RATES, DEFAULT_QUOTE_RATE, quoteRateOf, quoteRateFromPet };`,
  )(
    localStorageStub,
    storeKeyMatch[1],
    (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    (value) => ({ current: value }),
    () => {},
  );
} catch (error) {
  console.error('EVAL FAIL:', error.message);
  process.exit(1);
}
const { STATS, emptyPet, sanitizePet, loadPet, savePet, decayed, moodLevel, cleanPetName, DEFAULT_PET_NAME, PET_NAME_MAX, QUOTE_RATES, DEFAULT_QUOTE_RATE, quoteRateOf, quoteRateFromPet } = api;
const STORE_KEY = storeKeyMatch[1];

/* ── 1. the defect, reproduced against the pre-fix merge ──────────────────── */
const brokenMerge = (parsed) => Object.assign(emptyPet(), parsed, { version: 1 });
const legacy = { satiety: 40, mood: 20, energy: 60, updatedAt: Date.now() };
const before = brokenMerge(legacy);
note('pre-fix merge of a partial record yields name', before.name);
note('pre-fix merge of a partial record yields fed', before.fed);
const explicitNulls = brokenMerge({ ...legacy, name: null, fed: null, patted: null, played: null });
note('pre-fix merge with explicit nulls yields name', explicitNulls.name);
console.log('  (the widget would render `${pet.name}` as "undefined" / "null" here)');

/* ── 2. emptyPet is complete ──────────────────────────────────────────────── */
const fresh = emptyPet();
check('emptyPet has a name', typeof fresh.name === 'string' && fresh.name.length > 0, true);
check('emptyPet counters are numbers', [fresh.fed, fresh.patted, fresh.played].every((n) => typeof n === 'number'), true);
check('emptyPet stats are numeric', [fresh.satiety, fresh.mood, fresh.energy].every((n) => typeof n === 'number'), true);

/* ── 3. sanitizePet always yields a complete, renderable record ───────────── */
const COMPLETE = (pet) =>
  typeof pet.name === 'string' &&
  pet.name.length > 0 &&
  [pet.satiety, pet.mood, pet.energy, pet.fed, pet.patted, pet.played, pet.bornAt, pet.updatedAt].every(
    (n) => typeof n === 'number' && Number.isFinite(n),
  ) &&
  typeof pet.holidayOverride === 'boolean' &&
  typeof pet.showStatus === 'boolean' &&
  typeof pet.quotesEnabled === 'boolean';

const cases = [
  ['undefined', undefined],
  ['null', null],
  ['empty object', {}],
  ['partial record (the observed case)', { satiety: 40, mood: 20, energy: 60 }],
  ['explicit nulls', { name: null, fed: null, patted: null, played: null, satiety: null, mood: null, energy: null }],
  ['wrong types', { name: 42, fed: 'x', patted: [], played: {}, satiety: 'a', mood: NaN, energy: Infinity }],
  ['empty name string', { name: '   ' }],
  ['out-of-range stats', { satiety: 999, mood: -50, energy: 1e9 }],
  ['negative counters', { fed: -3, patted: -1, played: -9 }],
  ['non-finite timestamps', { bornAt: NaN, updatedAt: Infinity }],
  ['a string record', 'nope'],
  ['an array record', [1, 2, 3]],
  ['a complete record', emptyPet()],
];

for (const [label, input] of cases) {
  const out = sanitizePet(input);
  check(`sanitizePet(${label}) -> complete record`, COMPLETE(out), true);
}

/* ── 4. sanitizePet preserves legitimate values ───────────────────────────── */
const kept = sanitizePet({
  name: '鲸鱼二号',
  satiety: 12.7,
  mood: 0,
  energy: 100,
  fed: 7,
  patted: 3,
  played: 2,
  holidayOverride: true,
  showStatus: false,
  bornAt: 1700000000000,
  updatedAt: 1700000000000,
});
check('keeps a custom name', kept.name, '鲸鱼二号');
check('keeps satiety', kept.satiety, 12.7);
check('keeps mood 0', kept.mood, 0);
check('keeps energy 100', kept.energy, 100);
check('keeps counters', [kept.fed, kept.patted, kept.played], [7, 3, 2]);
check('keeps holidayOverride', kept.holidayOverride, true);
check('keeps showStatus false', kept.showStatus, false);
check('keeps quotesEnabled', sanitizePet({ quotesEnabled: false }).quotesEnabled, false);
check('quotesEnabled defaults to true', sanitizePet({}).quotesEnabled, true);

/* ── the display name: 小橘 by default, and freely renameable ─────────────── */
check('the default display name is 小橘', DEFAULT_PET_NAME, '小橘');
check('emptyPet carries the default name', emptyPet().name, '小橘');
check('a fresh record is named 小橘', sanitizePet({}).name, '小橘');
check('a stored custom name is kept', sanitizePet({ name: '小橘 的小鲸鱼' }).name, '小橘 的小鲸鱼');
check('a bare handle is kept', sanitizePet({ name: '@kuixiu' }).name, '@kuixiu');
check('an emoji name is kept', sanitizePet({ name: '🐱 kuixiu' }).name, '🐱 kuixiu');

// Names are cleaned rather than rejected, so pasted junk cannot break the label.
check('a name is trimmed', cleanPetName('  小橘  '), '小橘');
check('newlines collapse to spaces', cleanPetName('小橘\n的小猫'), '小橘 的小猫');
check('tabs collapse to spaces', cleanPetName('小橘\tcat'), '小橘 cat');
check('a name is length-capped', cleanPetName('x'.repeat(100)).length, PET_NAME_MAX);
check('a whitespace-only name cleans to empty', cleanPetName('   '), '');
check('a non-string name cleans to empty', cleanPetName(42), '');
check('a null name cleans to empty', cleanPetName(null), '');
// An empty stored name must fall back to the default, never render blank.
check('an empty stored name falls back to the default', sanitizePet({ name: '' }).name, '小橘');
check('a whitespace stored name falls back to the default', sanitizePet({ name: '   ' }).name, '小橘');
check('a newline-only stored name falls back to the default', sanitizePet({ name: '\n\n' }).name, '小橘');
check('an over-long stored name is capped', sanitizePet({ name: 'y'.repeat(80) }).name.length, PET_NAME_MAX);
// The name must survive a save/load round trip.
store = {};
savePet({ ...emptyPet(), name: '小橘 测试' });
check('a renamed pet survives a round trip', loadPet().name, '小橘 测试');
check('the default name is persisted for a fresh pet', (() => { store = {}; savePet(emptyPet()); return loadPet().name; })(), '小橘');

/* ── the quote frequency setting ──────────────────────────────────────────── */
check('the four rates are exposed in order', Object.keys(QUOTE_RATES), ['off', 'rare', 'normal', 'chatty']);
check('the default rate is normal', DEFAULT_QUOTE_RATE, 'normal');
check('off never speaks', QUOTE_RATES.off.gapMs, 0);
check('off never polls', QUOTE_RATES.off.pollMs, 0);
check('the rates are strictly ordered by gap', [QUOTE_RATES.chatty.gapMs, QUOTE_RATES.normal.gapMs, QUOTE_RATES.rare.gapMs].every((gap, i, all) => i === 0 || all[i - 1] < gap), true);
check('every rate has a poll interval below its gap', ['rare', 'normal', 'chatty'].every((key) => QUOTE_RATES[key].pollMs < QUOTE_RATES[key].gapMs), true);
check('every rate has a label key', Object.values(QUOTE_RATES).every((rate) => typeof rate.key === 'string' && rate.key.startsWith('quote.freq.')), true);
check('a valid rate is kept', quoteRateOf('chatty'), 'chatty');
check('an unknown rate falls back to the default', quoteRateOf('nonsense'), DEFAULT_QUOTE_RATE);
check('a missing rate falls back to the default', quoteRateOf(undefined), DEFAULT_QUOTE_RATE);
check('a non-string rate falls back to the default', quoteRateOf(7), DEFAULT_QUOTE_RATE);
check('a stored rate is normalised', sanitizePet({ quoteRate: 'rare' }).quoteRate, 'rare');
check('a corrupt stored rate is repaired', sanitizePet({ quoteRate: 'fastest' }).quoteRate, DEFAULT_QUOTE_RATE);
check('a fresh record carries the default rate', sanitizePet({}).quoteRate, DEFAULT_QUOTE_RATE);
// The old boolean setting still means something after the upgrade.
check('legacy quotesEnabled:false maps to off', quoteRateFromPet({ quotesEnabled: false }), 'off');
check('legacy quotesEnabled:true maps to the default rate', quoteRateFromPet({ quotesEnabled: true }), DEFAULT_QUOTE_RATE);
check('an explicit rate wins over the legacy flag', quoteRateFromPet({ quotesEnabled: false, quoteRate: 'chatty' }), 'chatty');
check('a renamed pet keeps its rate through storage', (() => { store = {}; savePet({ ...emptyPet(), quoteRate: 'rare' }); return loadPet().quoteRate; })(), 'rare');
check('keeps bornAt', kept.bornAt, 1700000000000);

/* ── 5. loadPet through the real localStorage path ────────────────────────── */
store = {};
check('empty storage -> a complete pet named @kuixiu', loadPet().name, DEFAULT_PET_NAME);

store[STORE_KEY] = JSON.stringify({ satiety: 40, mood: 20, energy: 60 });
check('partial stored record -> name repaired', loadPet().name, DEFAULT_PET_NAME);
check('partial stored record -> counters repaired', [loadPet().fed, loadPet().patted, loadPet().played], [0, 0, 0]);

store[STORE_KEY] = JSON.stringify({ name: null, fed: null, patted: null, played: null, satiety: null });
check('null-laden stored record -> name repaired', loadPet().name, DEFAULT_PET_NAME);
check('null-laden stored record -> satiety repaired', loadPet().satiety, 72);

store[STORE_KEY] = '{ this is not json';
check('corrupt JSON -> defaults', loadPet().name, DEFAULT_PET_NAME);

store[STORE_KEY] = 'null';
check('stored null -> defaults', loadPet().name, DEFAULT_PET_NAME);

store[STORE_KEY] = '"a string"';
check('stored string -> defaults', loadPet().name, DEFAULT_PET_NAME);

store[STORE_KEY] = JSON.stringify({ name: '球球', fed: 5, satiety: 33, mood: 90, energy: 10 });
const loaded = loadPet();
check('round-trips a valid custom record', [loaded.name, loaded.fed, loaded.satiety], ['球球', 5, 33]);

/* ── 6. save/load round-trip keeps every field ────────────────────────────── */
store = {};
savePet({ ...emptyPet(), name: '圆圆', fed: 2, patted: 1, played: 3 });
const roundTripped = loadPet();
check('round-trip name', roundTripped.name, '圆圆');
check('round-trip counters', [roundTripped.fed, roundTripped.patted, roundTripped.played], [2, 1, 3]);
check('round-trip record is complete', COMPLETE(roundTripped), true);

/* ── 7. decay never produces NaN, even from a malformed record ────────────── */
const now = 1700000000000;
const decayedOut = decayed(sanitizePet({ satiety: 40, mood: 30, energy: 20, updatedAt: now - 60 * 60 * 1000 }), now);
check('decay produces finite stats', [decayedOut.satiety, decayedOut.mood, decayedOut.energy].every(Number.isFinite), true);
check('decay lowered satiety', decayedOut.satiety < 40, true);
check('decay raised energy', decayedOut.energy > 20, true);

// decays clamped at the bounds over a long absence
const longGone = decayed(sanitizePet({ satiety: 100, mood: 100, energy: 0, updatedAt: now - 30 * 24 * 60 * 60 * 1000 }), now);
check('long absence clamps mood at 0', longGone.mood, 0);
check('long absence keeps energy at 100', longGone.energy, 100);
check('long absence stays finite', [longGone.satiety, longGone.mood, longGone.energy].every(Number.isFinite), true);

/* ── 8. stats drive a valid expression, never a missing mood ──────────────── */
for (const mood of [0, 34, 35, 69, 70, 100]) {
  const level = moodLevel({ mood });
  if (!['happy', 'ok', 'sad'].includes(level)) {
    failures++;
    console.log(`FAIL  moodLevel({ mood: ${mood} }) returned ${level}`);
  }
}
console.log('PASS  moodLevel always returns a known expression');
check('STATS keys are the three model fields', STATS.map((s) => s.key), ['satiety', 'mood', 'energy']);

/* ── 9. decay must never emit NaN — the "饱食度 NaN" regression ───────────── */
// `decayed` owns the three stats and `updatedAt`; the remaining fields are the
// caller's job (that is what `sanitizePet` is for), so only the owned set is
// asserted here.
const OWNED = ['satiety', 'mood', 'energy', 'updatedAt'];
const ownedFinite = (pet) => OWNED.every((field) => typeof pet[field] === 'number' && Number.isFinite(pet[field]));

const decayNow = 1700000000000;
const decayCases = [
  ['a non-finite updatedAt (the reported NaN cause)', { updatedAt: NaN, satiety: 50, mood: 50, energy: 50 }],
  ['an Infinity updatedAt', { updatedAt: Infinity, satiety: 50, mood: 50, energy: 50 }],
  ['a null updatedAt', { updatedAt: null, satiety: 50, mood: 50, energy: 50 }],
  ['a missing updatedAt', { satiety: 50, mood: 50, energy: 50 }],
  ['NaN stats', { updatedAt: decayNow, satiety: NaN, mood: NaN, energy: NaN }],
  ['null stats', { updatedAt: decayNow, satiety: null, mood: null, energy: null }],
  ['string stats', { updatedAt: decayNow, satiety: '50', mood: 'x', energy: {} }],
  ['an updatedAt in the future', { updatedAt: decayNow + 10 * 60 * 60 * 1000, satiety: 50, mood: 50, energy: 50 }],
  ['everything malformed', { updatedAt: 'nope', satiety: [], mood: {}, energy: undefined }],
];
for (const [label, input] of decayCases) {
  check(`decayed(${label}) -> finite owned fields`, ownedFinite(decayed(input, decayNow)), true);
}
check('decayed(NaN updatedAt) -> no NaN satiety', Number.isFinite(decayed(decayCases[0][1], decayNow).satiety), true);
check(
  'decayed(NaN updatedAt) treats the record as fresh, no decay applied',
  decayed({ updatedAt: NaN, satiety: 50, mood: 50, energy: 50 }, decayNow).satiety,
  50,
);
// Out-of-range values are clamped into [0, 100] by the decay path too.
const clamped = decayed({ updatedAt: decayNow - 60 * 60 * 1000, satiety: 999, mood: -999, energy: 999 }, decayNow);
check('decayed clamps out-of-range stats', [clamped.satiety, clamped.mood, clamped.energy], [100, 0, 100]);

// The exact composition `mutate` performs must also stay finite end to end.
const ALL_FIELDS = ['satiety', 'mood', 'energy', 'fed', 'patted', 'played', 'bornAt', 'updatedAt'];
const allFinite = (pet) => ALL_FIELDS.every((field) => typeof pet[field] === 'number' && Number.isFinite(pet[field]));
const composeMutate = (current, patch, now) => {
  const base = decayed(current, now);
  const merged = Object.assign({}, base, patch !== null && typeof patch === 'object' ? patch : {}, { updatedAt: now });
  return sanitizePet(merged);
};
const badCurrent = { updatedAt: NaN, satiety: NaN, mood: NaN, energy: NaN, name: null, fed: undefined };
check('mutate over a corrupt record stays finite', allFinite(composeMutate(badCurrent, { mood: 10 }, decayNow)), true);
check(
  'mutate over a corrupt record keeps the pet named',
  composeMutate(badCurrent, { mood: 10 }, decayNow).name,
  DEFAULT_PET_NAME,
);
check(
  'a patch that introduces NaN is repaired',
  allFinite(composeMutate(sanitizePet({}), { satiety: NaN, mood: Infinity }, decayNow)),
  true,
);
// A normal interaction still works.
const fed = composeMutate(sanitizePet({ satiety: 50, mood: 50, energy: 50, fed: 1 }), { satiety: 68, fed: 2 }, decayNow);
check('a normal feed patch applies', [fed.satiety, fed.fed], [68, 2]);

/* ── 10. drag geometry (pure helpers used by useDrag) ─────────────────────── */
if (dragStart < 0 || dragEnd < 0) {
  failures++;
  console.log('FAIL  drag helpers not found');
} else {
  const drag = new Function(
    `${source.slice(dragStart, dragEnd)} return { DRAG_EDGE, dragClamp, dragMoved, DRAG_THRESHOLD };`,
  )();
  const { DRAG_EDGE, dragClamp, dragMoved, DRAG_THRESHOLD } = drag;

  check('dragMoved ignores a 0px jitter', dragMoved(0, 0), false);
  check('dragMoved ignores a sub-threshold move', dragMoved(1, 1), false);
  check('dragMoved accepts a threshold move', dragMoved(DRAG_THRESHOLD, 0), true);
  check('dragMoved accepts a diagonal move', dragMoved(10, -10), true);

  const viewport = { w: 1280, h: 800 };
  const size = { w: 100, h: 90 };
  const inside = dragClamp(400, 400, size.w, size.h, viewport.w, viewport.h);
  check('an in-bounds drag is unchanged', inside, { left: 400, top: 400 });
  const pastLeft = dragClamp(-500, -500, size.w, size.h, viewport.w, viewport.h);
  check('a drag past the top-left clamps to the edge', pastLeft, { left: DRAG_EDGE, top: DRAG_EDGE });
  const pastRight = dragClamp(99999, 99999, size.w, size.h, viewport.w, viewport.h);
  check('a drag past the bottom-right clamps inside', pastRight, {
    left: viewport.w - size.w - DRAG_EDGE,
    top: viewport.h - size.h - DRAG_EDGE,
  });
  // A viewport smaller than the widget must not produce a negative position.
  const tiny = dragClamp(500, 500, 100, 90, 60, 50);
  check('a viewport smaller than the widget stays >= EDGE', tiny.left >= DRAG_EDGE && tiny.top >= DRAG_EDGE, true);
  check('clamped positions are always finite', [tiny.left, tiny.top, pastRight.left, pastRight.top].every(Number.isFinite), true);
  console.log('PASS  drag geometry is bounded and finite');
}

console.log(failures === 0 ? '\nPERSISTENCE HARNESS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
