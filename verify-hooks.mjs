/**
 * Hook-order guard for PetWidget.
 *
 * React requires every hook in a component to run unconditionally, so no
 * `use*` call may appear after the component's first early `return`. This reads
 * the component body out of the source and checks the ordering directly.
 */
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./client.js', import.meta.url), 'utf8');

let failures = 0;
const fail = (message) => {
  failures++;
  console.log('FAIL  ' + message);
};

/* 1. PetWidget's hooks must precede its first early return. */
const start = source.indexOf('function PetWidget(props) {');
if (start < 0) fail('PetWidget not found');
const body = source.slice(start, source.indexOf('\n    /* ──────────────────────────────── locales', start));
const firstEarlyReturn = body.search(/\n\s+if \([^)]*\) \{\s*\n\s+return /);
const hookCalls = [...body.matchAll(/\b(use[A-Z]\w*)\(/g)].map((m) => ({ name: m[1], at: m.index }));
const afterReturn = hookCalls.filter((call) => firstEarlyReturn >= 0 && call.at > firstEarlyReturn);
if (afterReturn.length > 0) {
  fail(`hooks called after the first early return: ${afterReturn.map((c) => c.name).join(', ')}`);
} else {
  console.log(`PASS  all ${hookCalls.length} hook calls in PetWidget precede the first early return`);
}

/* 2. Hook families used must be imported from React, or be this module's own. */
const imported = ['useState', 'useEffect', 'useRef', 'useCallback', 'useMemo', 'useSyncExternalStore'];
const local = ['usePet', 'usePosition', 'useDrag', 'useSchedule', 'useAgentStatus', 'useCostLedger'];
const used = new Set(hookCalls.map((call) => call.name));
const unknown = [...used].filter((name) => !imported.includes(name) && !local.includes(name));
if (unknown.length > 0) fail(`hook(s) used but neither destructured from React nor defined here: ${unknown.join(', ')}`);
else console.log('PASS  every hook used is either a React seed export or a hook defined in this module');

/* 3. Custom hooks declared in this module must themselves only call hooks
 *    unconditionally at their top level (no hook inside a branch). */
for (const name of ['usePosition', 'useDrag', 'usePet', 'useSchedule', 'useAgentStatus', 'useCostLedger']) {
  const at = source.indexOf(`const ${name} = `);
  if (at < 0) {
    fail(`custom hook ${name} not found`);
    continue;
  }
  const end = source.indexOf('\n    };', at);
  const hookBody = source.slice(at, end);
  const nested = [...hookBody.matchAll(/\b(useState|useEffect|useRef|useCallback|useMemo|useSyncExternalStore)\(/g)];
  console.log(`  ${name}: ${nested.length} React hook call(s), ${(hookBody.match(/useCallback/g) || []).length} memoized`);
}

/* 4. The effect that installs document pointer listeners must clean up. */
const dragStart = source.indexOf('const useDrag = (onDrop) => {');
const dragBody = source.slice(dragStart, source.indexOf('\n    };', dragStart));
const removes = (dragBody.match(/removeEventListener/g) || []).length;
const adds = (dragBody.match(/addEventListener/g) || []).length;
if (removes !== adds || adds === 0) fail(`useDrag listener balance: ${adds} added, ${removes} removed`);
else console.log(`PASS  useDrag removes all ${adds} document listeners it adds`);

/* 5. Timers created must be cleared. */
const intervalSets = (source.match(/setInterval\(/g) || []).length;
const intervalClears = (source.match(/clearInterval\(/g) || []).length;
if (intervalClears === 0) fail(`setInterval used ${intervalSets}x with no clearInterval`);
else console.log(`PASS  setInterval(${intervalSets}) paired with clearInterval(${intervalClears})`);
const timeouts = (source.match(/setTimeout\(/g) || []).length;
const timeoutClears = (source.match(/clearTimeout\(/g) || []).length;
if (timeouts > 0 && timeoutClears === 0) fail(`setTimeout used ${timeouts}x with no clearTimeout`);
else console.log(`PASS  setTimeout(${timeouts}) paired with clearTimeout(${timeoutClears})`);

console.log(failures === 0 ? '\nHOOK/LEAK GUARD PASSED' : `\n${failures} GUARD FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
