/**
 * Logic harness for the live agent-status layer of @kuixiu/dsh-pet/client.js.
 *
 * Extracts `activeSessionOf` / `deriveActivity` / `statusMood` / `safeHook` from
 * the real source and runs them against synthetic Session catalog and status
 * shapes, copied from the shipped `@deepseek-ai/dsh-client-ui-session` source:
 *
 *   useSessions(s => s)      -> { ids: string[], byId: { [id]: summary } }
 *   useSessionStatus(s => s) -> Map<id, { running?, pendingInteraction?, completionUnread? }>
 *
 * The hooks themselves are React-bound, so `useAgentStatus` is covered by the
 * hook-order guard instead; this file covers the pure decision logic.
 */
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./client.js', import.meta.url), 'utf8');

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
};

/* ── extract the pure helpers ─────────────────────────────────────────────── */
const start = source.indexOf('const IDENTITY_SELECTOR =');
const end = source.indexOf('const ACTIVITY_MOOD =');
if (start < 0 || end < 0) {
  console.error('EXTRACT FAIL: activity section not found');
  process.exit(1);
}
const moodStart = source.indexOf('/** Single source of truth for the pet');
const moodEnd = source.indexOf('const ACTIVITY_LABEL =');
if (moodStart < 0 || moodEnd < 0) {
  console.error('EXTRACT FAIL: mood section not found');
  process.exit(1);
}

let api;
try {
  api = new Function(
    `${source.slice(start, end)}
     ${source.slice(end, moodStart)}
     ${source.slice(moodStart, moodEnd)}
     ${source.slice(moodEnd, source.indexOf('\n    };', moodEnd) + '\n    };'.length)}
     return { safeHook, activeSessionOf, hasActiveSession, deriveActivity, statusMood, ACTIVITY_MOOD, ACTIVITY_LABEL };`,
  )();
} catch (error) {
  console.error('EVAL FAIL:', error.message);
  process.exit(1);
}
const { safeHook, activeSessionOf, hasActiveSession, deriveActivity, statusMood, ACTIVITY_MOOD, ACTIVITY_LABEL } = api;

/* ── fixture builders ─────────────────────────────────────────────────────── */
const MAIN = 'session-main';
const OTHER = 'session-other';
const listOf = (runningById, retained) => ({
  ids: Object.keys(runningById),
  byId: Object.fromEntries(
    Object.entries(runningById).map(([id, running]) => [
      id,
      { id, running, retainedBy: retained !== undefined && retained === id ? { mainView: 1 } : {} },
    ]),
  ),
});
const statusMap = (entries) => new Map(Object.entries(entries));

/* ── safeHook ─────────────────────────────────────────────────────────────── */
check('safeHook(undefined) returns undefined, not a throw', safeHook(undefined)('x'), undefined);

const throwing = () => {
  throw new Error('hook unavailable');
};
check('safeHook swallows a throwing hook', safeHook(throwing)('x'), undefined);
check('safeHook passes a working hook through', safeHook((value) => value + 1)(41), 42);

/* ── activeSessionOf ──────────────────────────────────────────────────────── */
check('activeSessionOf(undefined)', activeSessionOf(undefined), undefined);
check('activeSessionOf(null)', activeSessionOf(null), undefined);
check('activeSessionOf({})', activeSessionOf({}), undefined);
check(
  'picks the session the main view retains',
  activeSessionOf(listOf({ [OTHER]: false, [MAIN]: true }, MAIN))?.id,
  MAIN,
);
check(
  'falls back to the first row when nothing is retained',
  activeSessionOf(listOf({ [OTHER]: false }, undefined))?.id,
  OTHER,
);

/* ── hasActiveSession ─────────────────────────────────────────────────────── */
check('hasActiveSession(undefined)', hasActiveSession(undefined), false);
check('hasActiveSession({})', hasActiveSession({}), false);
check('hasActiveSession(empty catalog)', hasActiveSession({ ids: [], byId: {} }), false);
check('hasActiveSession(one row)', hasActiveSession(listOf({ [MAIN]: false }, MAIN)), true);

/* ── deriveActivity ───────────────────────────────────────────────────────── */
check('no session catalog -> idle', deriveActivity(undefined, statusMap({})), 'idle');
check('empty catalog -> idle', deriveActivity({ ids: [], byId: {} }, statusMap({})), 'idle');
check(
  'running from the status Map -> running',
  deriveActivity(listOf({ [MAIN]: true }, MAIN), statusMap({ [MAIN]: { running: true } })),
  'running',
);
check(
  'running from the catalog row when the Map is empty -> running',
  deriveActivity(listOf({ [MAIN]: true }, MAIN), statusMap({})),
  'running',
);
check(
  'pendingInteraction wins over running -> waiting',
  deriveActivity(
    listOf({ [MAIN]: true }, MAIN),
    statusMap({ [MAIN]: { running: true, pendingInteraction: { kind: 'approval' } } }),
  ),
  'waiting',
);
check(
  'pendingInteraction alone -> waiting',
  deriveActivity(listOf({ [MAIN]: false }, MAIN), statusMap({ [MAIN]: { pendingInteraction: { kind: 'question' } } })),
  'waiting',
);
check(
  'completionUnread and not running -> done',
  deriveActivity(listOf({ [MAIN]: false }, MAIN), statusMap({ [MAIN]: { running: false, completionUnread: true } })),
  'done',
);
check(
  'idle session with no flags -> idle',
  deriveActivity(listOf({ [MAIN]: false }, MAIN), statusMap({ [MAIN]: { running: false } })),
  'idle',
);
// A status Map without a `get` must not throw.
check('status Map missing the session -> idle', deriveActivity(listOf({ [MAIN]: false }, MAIN), statusMap({})), 'idle');
check('statuses not a Map -> idle', deriveActivity(listOf({ [MAIN]: false }, MAIN), {}), 'idle');
check('null statuses -> idle', deriveActivity(listOf({ [MAIN]: false }, MAIN), null), 'idle');
// The status Map may key by `sessionId` while the catalog row uses `id`.
check(
  'sessionId-keyed rows are read too',
  deriveActivity({ ids: [MAIN], byId: { [MAIN]: { sessionId: MAIN, running: true, retainedBy: { mainView: 1 } } } }, statusMap({})),
  'running',
);
// A busy session that is NOT the active one must not drive the pet.
check(
  'a busy non-active session is ignored (active row drives)',
  deriveActivity(listOf({ [OTHER]: true, [MAIN]: true }, MAIN), statusMap({ [OTHER]: { running: true }, [MAIN]: { running: true } })),
  'running',
);
check(
  'a busy non-active session leaves the active idle session idle',
  deriveActivity(listOf({ [OTHER]: true, [MAIN]: false }, MAIN), statusMap({ [OTHER]: { running: true }, [MAIN]: {} })),
  'idle',
);
// Missing `retainedBy` must not throw and must still pick a session.
check(
  'rows without retainedBy do not throw',
  deriveActivity({ ids: [MAIN], byId: { [MAIN]: { id: MAIN, running: true } } }, statusMap({})),
  'running',
);

/* ── statusMood ───────────────────────────────────────────────────────────── */
check('celebrating wins', statusMood('running', true, 'sad'), 'happy');
check('running -> working', statusMood('running', false, 'ok'), 'working');
check('waiting -> sad', statusMood('waiting', false, 'happy'), 'sad');
check('done -> happy', statusMood('done', false, 'ok'), 'happy');
check('idle keeps the pet stat mood', statusMood('idle', false, 'sad'), 'sad');
check('idle keeps a happy pet mood', statusMood('idle', false, 'happy'), 'happy');
check('unknown activity keeps the pet stat mood', statusMood('mystery', false, 'ok'), 'ok');

/* ── label tables stay consistent ─────────────────────────────────────────── */
for (const activity of ['idle', 'running', 'waiting', 'done']) {
  check(`ACTIVITY_LABEL has ${activity}`, typeof ACTIVITY_LABEL[activity], 'string');
  check(`ACTIVITY_MOOD has ${activity}`, typeof ACTIVITY_MOOD[activity], 'string');
}
check('every mapped mood is a known expression', Object.values(ACTIVITY_MOOD).every((m) => ['ok', 'sad', 'happy', 'working'].includes(m)), true);

console.log(failures === 0 ? '\nAGENT STATUS HARNESS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
