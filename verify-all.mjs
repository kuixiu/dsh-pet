/**
 * One-shot verification for @kuixiu/dsh-pet.
 *
 * Usage: node verify-all.mjs
 *
 * Runs the three self-contained harnesses. Each exits non-zero on failure, so
 * this script is also usable as a pre-install gate.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const suites = [
  ['schedule + syntax', 'verify-schedule.mjs'],
  ['live agent status', 'verify-agent-status.mjs'],
  ['persistence + repair', 'verify-persistence.mjs'],
  ['token cost + ledger', 'verify-cost.mjs'],
  ['quote bank + picking', 'quotes.mjs'],
  ['widget render', 'verify-render.mjs'],
  ['locale dictionaries', 'verify-locale.mjs'],
  ['hook order + leaks', 'verify-hooks.mjs'],
  ['publish readiness', 'verify-publish.mjs'],
];

let failed = 0;
for (const [label, file] of suites) {
  process.stdout.write(`\n===== ${label} (${file}) =====\n`);
  const result = spawnSync(process.execPath, [join(here, file)], { stdio: 'inherit' });
  if (result.status !== 0) failed++;
}

console.log(`\n===== ${failed === 0 ? 'ALL SUITES PASSED' : `${failed} SUITE(S) FAILED`} =====`);
process.exit(failed === 0 ? 0 : 1);
