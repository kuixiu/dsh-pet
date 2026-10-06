/**
 * Render harness for @kuixiu/dsh-pet/client.js.
 *
 * The client module returns plain React elements, so a stub `createElement` is
 * enough to render the whole widget and walk the real element tree. This proves
 * what the panel actually shows — in particular that the simplified pricing
 * section kept every needed fact and dropped the verbose duplicates.
 *
 * State is stubbed as a plain array, so `useState`'s initial value is what the
 * render sees; `open` is seeded by setting the first state slot to true.
 */
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./client.js', import.meta.url), 'utf8');

let failures = 0;
const check = (label, actual, expected) => {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}: ${JSON.stringify(actual)}${ok ? '' : ` (expected ${JSON.stringify(expected)})`}`);
};

/* ── stubs ────────────────────────────────────────────────────────────────── */
const store = {};
globalThis.localStorage = {
  getItem: (key) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
  setItem: (key, value) => {
    store[key] = String(value);
  },
  removeItem: (key) => {
    delete store[key];
  },
};
// Node 24 exposes `navigator` as a getter-only global, so pass it into the
// module's scope instead of assigning it.
const navigatorStub = { language: 'zh-CN' };
globalThis.window = { innerWidth: 1280, innerHeight: 800, addEventListener() {}, removeEventListener() {} };
globalThis.document = { addEventListener() {}, removeEventListener() {} };

const dictionaries = {
  zh: {
    'panel.title': 'DeepSeek 电子宠物',
    close: '收起',
    reopen: '显示宠物',
    'badge.hint': '当前是高峰期还是低谷期 — 点击查看详情',
    'pet.hint': '摸摸小猫（可拖动位置）',
    'pricing.until': '至 {time}',
    'pricing.clock': '时间',
    'pricing.clockValue': '{bj} 北京 · {local} 本地 · {utc} UTC',
    'pricing.whyShort': '今天为法定节假日，全天低谷期。',
    'pricing.ruleShort': '高峰：北京时间周一至周五 9:00-12:00、14:00-18:00（不含节假日），其余时段半价（省 {discount}%）。',
    'pricing.holidayToggleShort': '强制按低谷期（今天放假）',
    'pricing.source': '价格依据：api-docs.deepseek.com · quick_start/pricing',
    'cost.total': '本次会话花费',
    'cost.turnTotal': '本轮合计',
    'cost.turnRunning': '本轮进行中',
    'cost.split': '高峰 / 低谷',
    'cost.splitValue': '{peak} / {offpeak}',
    'cost.tokens': '累计 tokens',
    'cost.basis': '按 tokenUsage 投影计算，{model} 价目，核对 {revision}。',
    'cost.unpriced': '无价目',
    'quote.toggle': '偶尔冒一句台词',
    'name.label': '名字',
    'name.save': '保存名字',
    'name.reset': '恢复默认名字',
    'quote.freq': '台词频率',
    'quote.freq.off': '关',
    'quote.freq.rare': '少',
    'quote.freq.normal': '中',
    'quote.freq.chatty': '多',
    'phase.peak': '高峰期',
    'phase.offpeak': '低谷期',
    'stat.satiety': '饱食度',
    'stat.mood': '心情',
    'stat.energy': '精力',
    'stat.bond': '喂食 · 摸头 · 玩耍',
    'status.now': '助手状态',
    'status.bubbleToggle': '显示助手状态气泡',
    'status.unavailable': '当前不可用',
    'status.noSession': '暂无会话',
    'status.idle': '空闲中',
    'status.running': '正在工作…',
    'status.waiting': '等待你操作',
    'status.done': '本轮完成',
    'mood.happy': '开心',
    'mood.ok': '还不错',
    'mood.sad': '肚子饿了',
    'mood.working': '专注中',
    'action.feed': '喂食',
    'action.pat': '摸头',
    'action.play': '玩耍',
    'action.rest': '睡觉',
    'action.resetPosition': '复位位置',
    'action.hide': '隐藏宠物',
  },
};
const seenKeys = new Set();
const t = (key, params) => {
  seenKeys.add(key);
  let out = dictionaries.zh[key];
  // A stat row passes its `labelKey` (`stat.satiety`) straight to `t`, so the
  // same string is the dictionary key; anything else is a genuine miss.
  if (typeof out !== 'string') out = `!!${key}`;
  if (params !== undefined) for (const [k, v] of Object.entries(params)) out = out.split(`{${k}}`).join(String(v));
  return out;
};

/* ── load the module ──────────────────────────────────────────────────────── */
let captured = null;
new Function('window', 'navigator', source)({ __ModuleLoader__: { load: (entry) => (captured = entry) } }, navigatorStub);

const states = [];
let cursor = 0;
const react = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
  useState: (initial) => {
    const index = cursor++;
    if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
    return [states[index], (next) => {
      states[index] = typeof next === 'function' ? next(states[index]) : next;
    }];
  },
  useRef: (value) => ({ current: value }),
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
  useEffect: () => {},
  useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot(),
};

const plugin = captured.factory((name) => {
  if (name === 'react') return react;
  throw new Error(`unexpected require: ${name}`);
});
check('the module exported { inject, apply }', [Array.isArray(plugin.inject), typeof plugin.apply], [true, 'function']);

/* ── register through the real apply ──────────────────────────────────────── */
let registered = null;
const ctx = {
  locale: { register: () => () => {} },
  effect: (fn) => {
    fn();
    return () => {};
  },
  slots: {
    inject: (_owner, callback) => callback(),
    register: (options, component) => {
      registered = { options, component };
      return () => {};
    },
  },
};
plugin.apply(ctx);
check('registered one shell.overlay entry', [registered.options.name, registered.options.id, registered.options.order], [
  'shell.overlay',
  'pet.bottom-right',
  60,
]);

/* ── tree helpers (children may be nested arrays, as `STATS.map(...)` is) ─── */
const elements = (node, out = []) => {
  if (node === null || node === undefined) return out;
  if (Array.isArray(node)) {
    for (const child of node) elements(child, out);
    return out;
  }
  if (typeof node !== 'object') return out;
  out.push(node);
  for (const child of node.children ?? []) elements(child, out);
  return out;
};
const classNameOf = (node) => (node !== null && typeof node === 'object' && node.props !== undefined ? node.props.className : undefined);
const byClass = (node, className) => elements(node).filter((n) => classNameOf(n) === className);
const inventory = (node) => {
  const counts = {};
  for (const child of elements(node)) {
    const name = classNameOf(child);
    if (typeof name === 'string') counts[name] = (counts[name] ?? 0) + 1;
  }
  return counts;
};
const textOf = (node) => {
  const out = [];
  const walk = (n) => {
    if (n === null || n === undefined) return;
    if (Array.isArray(n)) {
      for (const child of n) walk(child);
      return;
    }
    if (typeof n === 'string' || typeof n === 'number') {
      out.push(String(n));
      return;
    }
    if (typeof n !== 'object') return;
    for (const child of n.children ?? []) walk(child);
  };
  walk(node);
  return out.join(' | ');
};

/* ── render closed (default) ──────────────────────────────────────────────── */
const sessionsStub = (selector) => selector({ ids: ['s1'], byId: { s1: { id: 's1', running: false, retainedBy: { mainView: 1 } } } });
const statusStub = (selector) => selector(new Map([['s1', { running: false }]]));

const render = (seed) => {
  cursor = 0;
  states.length = 0;
  if (seed !== undefined) states[0] = seed;
  return registered.component({ t, useSessions: sessionsStub, useSessionStatus: statusStub });
};

const closedTree = render();
check('closed render has one root', byClass(closedTree, 'dshPet_root').length, 1);
check('closed render shows the pet button', byClass(closedTree, 'dshPet_pet').length, 1);
check('closed render shows the badge', byClass(closedTree, 'dshPet_badge').length, 1);
check('closed render has no panel', byClass(closedTree, 'dshPet_panel').length, 0);

/* ── render open and inspect the pricing section ──────────────────────────── */
const openTree = render(true);
console.log('\n  t() keys requested: ' + seenKeys.size + ', dictionary misses: ' + [...seenKeys].filter((k) => dictionaries.zh[k] === undefined).length);
const panels = byClass(openTree, 'dshPet_panel');
check('open render shows exactly one panel', panels.length, 1);
const panel = panels[0];
const text = textOf(panel);
console.log('\n  panel text: ' + text + '\n');
console.log('  panel classes: ' + JSON.stringify(inventory(panel)));
console.log('  stat rows: ' + byClass(panel, 'dshPet_barFill').length);

/* Kept facts. */
for (const kept of [
  '低谷期',
  '至 ', // pricing.until with the next boundary
  '时间',
  '北京',
  '本地',
  'UTC',
  '今天为法定节假日，全天低谷期。',
  '高峰：北京时间周一至周五',
  '强制按低谷期（今天放假）',
  '饱食度',
  '心情',
  '精力',
  '助手状态',
  '喂食',
  '摸头',
  '玩耍',
  '睡觉',
  '复位位置',
  '隐藏宠物',
  '本次会话花费',
  '本轮合计',
  '高峰 / 低谷',
  '台词频率',
  '关',
  '少',
  '中',
  '多',
]) {
  check(`keeps "${kept}"`, text.includes(kept), true);
}
check('no unresolved key leaked into the panel', /!!/.test(text), false);

/* Dropped verbosity. */
for (const dropped of ['当前时段', '下次切换', '原因', '规则核对日期', '你的本地时间', '北京时间（UTC+8）', 'UTC 时间']) {
  check(`dropped "${dropped}"`, text.includes(dropped), false);
}

/* The simplified layout: headline + countdown + one clock row. */
check('the headline row exists', byClass(panel, 'dshPet_headline').length, 2); // pricing + cost
check('the big countdown exists', byClass(panel, 'dshPet_countdown').length, 1);
// The pricing block has exactly one kv row (the clock); the pet block owns the others.
const pricingSectionForKv = elements(panel).find((n) => classNameOf(n) === 'dshPet_section' && elements(n).some((c) => classNameOf(c) === 'dshPet_headline'));
check('exactly one kv row remains in the pricing block', byClass(pricingSectionForKv, 'dshPet_kv').length, 1);
check('all three stat rows still render', byClass(panel, 'dshPet_barFill').length, 3);

/* ── the display name reaches the UI ──────────────────────────────────────── */
// The default and a stored custom name must both render, so a rename is visible
// in the label under the cat and pre-filled in the panel's input.
const defaultTree = render(true);
const defaultLabel = byClass(defaultTree, 'dshPet_name')[0];
check('the default label shows 小橘', textOf(defaultLabel).startsWith('小橘'), true);

// Seed a stored pet with a custom name and render again.
store['dsh-pet.state.v1'] = JSON.stringify({ name: '小橘 的小鲸鱼' });
const renamedTree = render(true);
const renamedLabel = byClass(renamedTree, 'dshPet_name')[0];
console.log('  label under the cat: ' + JSON.stringify(textOf(renamedLabel)));
check('a stored custom name renders in the label', textOf(renamedLabel).includes('小橘 的小鲸鱼'), true);
const nameInput = byClass(renamedTree, 'dshPet_nameInput')[0];
check('the panel pre-fills the stored name', nameInput.props.value, '小橘 的小鲸鱼');
check('the panel has a save button', byClass(renamedTree, 'dshPet_nameButton').length, 2);
delete store['dsh-pet.state.v1'];

/* ── the quote frequency control ──────────────────────────────────────────── */
const rateButtons = byClass(defaultTree, 'dshPet_rate');
check('the panel exposes four frequency options', rateButtons.length, 4);
check('the options read 关/少/中/多', rateButtons.map((b) => textOf(b)), ['关', '少', '中', '多']);
check('the default option is selected', rateButtons.filter((b) => b.props['data-selected'] === 'true').map((b) => textOf(b)), ['中']);

// A stored rate must be reflected as the selected option.
for (const [rate, label] of [['chatty', '多'], ['off', '关'], ['rare', '少']]) {
  store['dsh-pet.state.v1'] = JSON.stringify({ quoteRate: rate });
  const tree = render(true);
  const selected = byClass(tree, 'dshPet_rate').filter((b) => b.props['data-selected'] === 'true').map((b) => textOf(b));
  check(`a stored rate "${rate}" selects ${label}`, selected, [label]);
}
delete store['dsh-pet.state.v1'];

/* ── the one-liner bubble ─────────────────────────────────────────────────── */
// Render once to populate every state slot with its natural default, then swap
// in a quote so the effect-driven timer is simulated rather than the whole
// component state being clobbered.
const renderWithQuote = (id) => {
  cursor = 0;
  const saved = states.slice();
  states.length = 0;
  const tree = registered.component({ t, useSessions: sessionsStub, useSessionStatus: statusStub });
  // The line lives in the widget's own state; find it by re-rendering with it set.
  cursor = 0;
  for (let i = 0; i < states.length; i++) states[i] = saved[i] ?? states[i];
  return { tree, slots: states.slice() };
};

const first = renderWithQuote();
// `quote` is the last string-or-null state slot that the bubble reads; drive it
// by re-rendering with every other slot held at its default and that one set.
const quoteIndex = (() => {
  for (let i = 0; i < first.slots.length; i++) {
    const probe = first.slots.slice();
    probe[i] = 'idle-1';
    cursor = 0;
    const prior = states.slice();
    states.length = 0;
    for (let j = 0; j < probe.length; j++) states[j] = probe[j];
    const tree = registered.component({ t, useSessions: sessionsStub, useSessionStatus: statusStub });
    if (byClass(tree, 'dshPet_quote').length === 1) return i;
    if (byClass(tree, 'dshPet_spend').length > 0 || byClass(tree, 'dshPet_bubble').length > 0) {
      // A competing bubble was seeded by accident; keep looking.
    }
    states.length = 0;
    for (let j = 0; j < prior.length; j++) states[j] = prior[j];
  }
  return -1;
})();
console.log('  quote state slot index: ' + quoteIndex + ' of ' + first.slots.length);

if (quoteIndex >= 0) {
  const slots = first.slots.slice();
  slots[quoteIndex] = 'idle-1';
  cursor = 0;
  states.length = 0;
  for (let j = 0; j < slots.length; j++) states[j] = slots[j];
  const quoteTree = registered.component({ t, useSessions: sessionsStub, useSessionStatus: statusStub });
  const quoteNodes = byClass(quoteTree, 'dshPet_quote');
  check('the quote bubble renders when a line is set', quoteNodes.length, 1);
  const quoteRendered = textOf(quoteNodes[0]);
  console.log('  quote bubble text: ' + JSON.stringify(quoteRendered));
  check('the bubble shows a real line, not a key', /quote\.|!!/.test(quoteRendered), false);
  check('the bubble shows the bank line', quoteRendered.includes('一步一步来，也算数。'), true);
} else {
  failures++;
  console.log('FAIL  could not locate the quote state slot to exercise the bubble');
}

// It must not render when no line is set.
check('no bubble when no line is set', byClass(render(true), 'dshPet_quote').length, 0);

/* Count the pricing section's own text nodes as an objective verbosity score. */
const pricingSection = elements(panel).find(
  (n) =>
    classNameOf(n) === 'dshPet_section' &&
    elements(n).some((c) => classNameOf(c) === 'dshPet_headline'),
);
const pricingText = textOf(pricingSection).split(' | ').filter((s) => s.trim() !== '');
console.log(`  pricing block text nodes: ${pricingText.length} -> ${JSON.stringify(pricingText)}`);
check('the pricing block is at most 8 text nodes', pricingText.length <= 8, true);

console.log(failures === 0 ? '\nRENDER HARNESS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
