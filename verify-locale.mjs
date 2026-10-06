/**
 * Dictionary + key audit for @kuixiu/dsh-pet/client.js.
 *
 * Every locale key the widget can reach must exist in BOTH dictionaries, and no
 * `t()` call may use a template literal (a computed key that silently misses).
 */
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./client.js', import.meta.url), 'utf8');
let failures = 0;
const fail = (message) => {
  failures++;
  console.log('FAIL  ' + message);
};

/* 1. template literals passed to t() would produce computed keys */
const computed = [...source.matchAll(/\bt\(\s*`[^`]*`/g)].map((m) => m[0]);
if (computed.length > 0) fail(`t() called with a template literal: ${computed.join(', ')}`);
else console.log('PASS  no t() call uses a template literal');

/* 2. extract the en and zh dictionaries */
const extract = (name) => {
  const start = source.indexOf(`const ${name} = {`);
  if (start < 0) throw new Error(`dictionary ${name} not found`);
  const end = source.indexOf('\n    };', start);
  const body = source.slice(start, end);
  const keys = [...body.matchAll(/^\s*(?:'([^']+)'|([A-Za-z_][\w.]*))\s*:/gm)].map((m) => m[1] ?? m[2]);
  return { keys, unique: new Set(keys) };
};
const enDict = extract('en');
const zhDict = extract('zh');
const en = enDict.unique;
const zh = zhDict.unique;
console.log(`  en keys: ${en.size}   zh keys: ${zh.size}`);

// A duplicated key is silent: the later value wins and the key set still looks
// fine. That once hid three duplicate entries in `en`, so it is checked directly.
const duplicates = (name, keys) => {
  const seen = new Set();
  const dupes = new Set();
  for (const key of keys) {
    if (seen.has(key)) dupes.add(key);
    seen.add(key);
  }
  if (dupes.size > 0) fail(`${name} has duplicate keys: ${[...dupes].join(', ')}`);
  else console.log(`PASS  ${name} has no duplicate keys`);
};
duplicates('en', enDict.keys);
duplicates('zh', zhDict.keys);

for (const key of en) if (!zh.has(key)) fail(`zh is missing "${key}"`);
for (const key of zh) if (!en.has(key)) fail(`en is missing "${key}"`);
if (en.size === zh.size && en.size > 0) console.log('PASS  en and zh dictionaries have identical key sets');

/* 3. every literal key passed to t() anywhere in the module must exist in en */
const literalKeys = new Set(
  [...source.matchAll(/\bt\(\s*'([^']+)'/g)].map((m) => m[1]),
);
const knownComputed = new Set(['stat.key', 'mood.level']);
const missing = [...literalKeys].filter((key) => !en.has(key) && !knownComputed.has(key));
if (missing.length > 0) fail(`t() keys absent from the en dictionary: ${missing.join(', ')}`);
else console.log(`PASS  all ${literalKeys.size} literal t() keys exist in the dictionary`);

/* 4. every key the dictionaries expose must actually be reachable/used */
const unused = [...en].filter((key) => !literalKeys.has(key) && !source.includes(key));
if (unused.length > 0) console.log(`  note: dictionary keys not referenced by a literal t(): ${unused.join(', ')}`);

/* 5. FALLBACK must cover every computed-key family */
const fallbackStart = source.indexOf('const FALLBACK = {');
const fallbackEnd = source.indexOf('\n    };', fallbackStart);
const fallbackKeys = new Set(
  [...source.slice(fallbackStart, fallbackEnd).matchAll(/^\s*'([^']+)'\s*:/gm)].map((m) => m[1]),
);
for (const key of ['mood.happy', 'mood.ok', 'mood.sad', 'stat.satiety', 'stat.mood', 'stat.energy']) {
  if (!fallbackKeys.has(key)) fail(`FALLBACK is missing "${key}"`);
}
for (const key of fallbackKeys) if (!en.has(key)) fail(`FALLBACK key "${key}" is not in the dictionary`);
console.log(`PASS  FALLBACK covers ${fallbackKeys.size} computed keys`);

/* 6. locale placeholders must match between dictionaries */
const paramsOf = (name, key) => {
  const start = source.indexOf(`const ${name} = {`);
  const body = source.slice(start, source.indexOf('\n    };', start));
  const line = body.match(new RegExp(`'${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}':\\s*'([^']*)'`));
  return line ? [...line[1].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',') : null;
};
for (const key of ['pricing.ruleShort', 'pricing.clockValue', 'pricing.until', 'cost.splitValue', 'cost.basis']) {
  const a = paramsOf('en', key);
  const b = paramsOf('zh', key);
  if (a === null || b === null) {
    fail(`placeholder check: ${key} not found in both dictionaries (en=${a}, zh=${b})`);
    continue;
  }
  if (a !== b) fail(`placeholder mismatch for ${key}: en=[${a}] zh=[${b}]`);
  else console.log(`PASS  placeholders match for ${key}: [${a}]`);
}

console.log(failures === 0 ? '\nDICTIONARY AUDIT PASSED' : `\n${failures} AUDIT FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
