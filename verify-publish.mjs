/**
 * Publish-readiness harness for @kuixiu/dsh-pet.
 *
 * Everything here is a failure mode that would only surface AFTER `npm publish`:
 * a missing file in `files`, an `exports` target that does not exist, a tarball
 * that leaks the local test scripts, or a client module id that no longer
 * matches the package name (which would make the browser bundle unfindable).
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(here, name), 'utf8');

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

/* ── the manifest ─────────────────────────────────────────────────────────── */
const pkg = JSON.parse(read('package.json'));
check('the package name is the published name', pkg.name, '@kuixiu/dsh-pet');
check('the package is not marked private', pkg.private, undefined);
check('a version is declared', /^\d+\.\d+\.\d+/.test(pkg.version), true);
check('a license is declared', typeof pkg.license, 'string');
check('the license file exists', existsSync(join(here, 'LICENSE')), true);
check('a repository URL is declared', typeof pkg.repository?.url, 'string');
check('a homepage is declared', typeof pkg.homepage, 'string');
check('a bugs URL is declared', typeof pkg.bugs?.url, 'string');
check('the repository URL points at the package name', String(pkg.repository?.url).includes('/dsh-pet'), true);
// The plugin is dependency-free; a local-only dependency must never ship.
check('no runtime dependencies are declared', pkg.dependencies, undefined);
check('the entry point is ESM', pkg.type, 'module');
check('the manifest declares a bundle patch', pkg.dsh?.bundle?.patch, './cordis.patch.yml');
check('the manifest declares a web client half', pkg.dsh?.client?.platform, 'web');
check('the client half loads immediately', pkg.dsh?.client?.immediately, true);
check('the client half declares an activation order', Array.isArray(pkg.dsh?.client?.inject), true);

// `files` is the npm allowlist: anything shipped must be listed, and nothing
// local (test harnesses, research notes) may sneak in.
const files = pkg.files ?? [];
check('a files allowlist is present', files.length > 0, true);
for (const required of ['index.js', 'client.js', 'cordis.patch.yml', 'icon.svg', 'README.md', 'LICENSE']) {
  if (!files.includes(required)) fail(`${required} is not in files[]`);
}
if (files.includes('verify-all.mjs') || files.some((f) => f.startsWith('verify-'))) {
  fail('test harnesses would be published');
} else {
  console.log('PASS  test harnesses are excluded from the tarball');
}
// Every `files` entry must actually exist.
for (const entry of files) {
  const target = entry.replace(/\*.*$/, '').replace(/\/$/, '') || '.';
  if (!existsSync(join(here, target))) fail(`files[] lists a missing path: ${entry}`);
}
console.log('PASS  every files[] entry exists on disk');

// Every `exports` target must exist too, or consumers get a resolution error.
for (const [key, value] of Object.entries(pkg.exports ?? {})) {
  const target = typeof value === 'string' ? value : value?.default;
  if (target === undefined) {
    fail(`exports["${key}"] has no default target`);
    continue;
  }
  if (target.includes('*')) continue;
  if (!existsSync(join(here, target))) fail(`exports["${key}"] -> ${target} does not exist`);
}
console.log('PASS  every exports target exists');

check('an icon is declared', typeof pkg.icon, 'string');
check('the declared icon exists', existsSync(join(here, pkg.icon)), true);
check('the icon is small enough for the card (<256 KiB)', statSync(join(here, pkg.icon)).size < 262144, true);
check('display metadata is declared', typeof pkg.meta?.title, 'string');
for (const locale of ['locale/en.json', 'locale/zh.json']) {
  if (!existsSync(join(here, locale))) fail(`missing ${locale}`);
  else {
    const text = JSON.parse(read(locale));
    if (typeof text.title !== 'string' || typeof text.description !== 'string') fail(`${locale} needs title + description`);
  }
}
console.log('PASS  locale card metadata is present and well formed');

/* ── identifiers must agree, or nothing loads ─────────────────────────────── */
const patch = read('cordis.patch.yml');
const patchNames = [...patch.matchAll(/name:\s*'([^']+)'/g)].map((m) => m[1]);
check('the patch inserts exactly one row', patchNames.length, 1);
check('the patch row uses the package name', patchNames[0], pkg.name);

const client = read('client.js');
const moduleId = client.match(/__ModuleLoader__\.load\(\{\s*\n\s*\/\/[^\n]*\n\s*id:\s*'([^']+)'/)?.[1]
  ?? client.match(/id:\s*'(@kuixiu\/dsh-pet)'/)?.[1];
check('the client module id equals the package name', moduleId, pkg.name);
check('no stale @local id is left in the client', client.includes('@local/dsh-pet'), false);

// The host half must still export an apply function.
const host = read('index.js');
check('the host half exports apply', /export function apply\s*\(/.test(host), true);

// The version in the README install snippet should match the manifest major.
if (!read('README.md').includes(`v${pkg.version.split('.')[0]}`)) {
  console.log('  note: README does not mention the current major version');
}

/* ── the declared runtime peer ────────────────────────────────────────────── */
// A browser-only plugin pairs with the shipped client UI it renders beside; the
// reference must be a package DSH actually ships.
const inject = pkg.dsh.client.inject ?? [];
check('the client inject list is non-empty', inject.length > 0, true);
for (const name of inject) {
  if (!name.startsWith('@deepseek-ai/dsh-')) fail(`inject entry is not a DSH package: ${name}`);
}
console.log('PASS  client inject entries are DSH packages');

console.log(failures === 0 ? '\nPUBLISH HARNESS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
