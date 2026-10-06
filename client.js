/**
 * `@kuixiu/dsh-pet` — bottom-right electronic pet with a DeepSeek
 * peak / off-peak pricing indicator.
 *
 * Delivered as a plain-JS dynamic Client module: the factory below is registered
 * into the browser module table under this package's name, and the returned
 * `apply` registers one `shell.overlay` entry. The overlay layer is a
 * click-through absolute layer, so the widget positions itself at the
 * bottom-right corner with `position: fixed` + `pointer-events: auto`.
 *
 * No Harness Client package is imported: React comes from the module table and
 * every color that is not artwork uses a `--dsw-alias-*` theme token.
 */
window.__ModuleLoader__.load({
  // MUST equal the package name: `client-modules` serves the browser bundle for
  // the row's package id, and this registration id is how it claims that slot.
  id: '@kuixiu/dsh-pet',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const {
      useState,
      useEffect,
      useRef,
      useCallback,
      useMemo,
      useSyncExternalStore,
    } = React;

    const NS = 'pet';
    const STORE_KEY = 'dsh-pet.state.v1';
    const POS_KEY = 'dsh-pet.position.v1';
    const TICK_MS = 1000;

    /* ─────────────────────────── DeepSeek pricing schedule ──────────────────────
     * Official rule (api-docs.deepseek.com/quick_start/pricing, EN + zh-cn):
     *   EN: "Off-peak rates are half of the peak rates. Peak hours are
     *        01:00 - 04:00 and 06:00 - 10:00 UTC, Monday through Friday,
     *        excluding Chinese public holidays. All other hours are off-peak,
     *        including weekends and Chinese public holidays in full."
     *   ZH: "北京时间周一至周五（不含中国法定节假日）9:00 - 12:00、14:00 - 18:00
     *        为高峰时段；其余时段，包括周末及中国法定节假日全天均为空闲时段。"
     *
     * Every decision below is therefore made in Asia/Shanghai (UTC+8), which is
     * the wording the Chinese page uses: a weekday test in UTC would disagree
     * with Beijing around the 16:00 UTC date boundary, and weekends must be
     * off-peak even when they are 调休 make-up working days.
     * `windows` are minutes since 00:00 Beijing time.
     *
     * The rate levels and the weekend/holiday treatment each changed during
     * 2026, so `HOLIDAYS_2026` is data with a `verified` date stamp rather than
     * being inferred, and the panel offers a manual override for the days this
     * table does not know about.
     * ────────────────────────────────────────────────────────────────────────── */
    const SCHEDULE = {
      verified: '2026-10-06',
      source: 'https://api-docs.deepseek.com/quick_start/pricing',
      discount: 50,
      windows: [
        { from: 9 * 60, to: 12 * 60 }, // 09:00 – 12:00 Beijing
        { from: 14 * 60, to: 18 * 60 }, // 14:00 – 18:00 Beijing
      ],
    };

    /**
     * Chinese public holidays announced for 2026 (国务院办公厅国办发明电〔2025〕7号).
     * Only weekday dates matter here: a Saturday or Sunday is already off-peak,
     * which also covers the 调休 make-up workdays (Sep 20 and Oct 10, 2026).
     * Covers the full announced 放假 window rather than only the statutory days,
     * which is the safer mapping for an "is it cheap right now" indicator.
     */
    const HOLIDAYS_2026 = [
      // 元旦
      '2026-01-01', '2026-01-02',
      // 春节
      '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-23',
      // 清明
      '2026-04-06',
      // 劳动节
      '2026-05-01', '2026-05-04', '2026-05-05',
      // 端午
      '2026-06-19',
      // 中秋
      '2026-09-25',
      // 国庆
      '2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07',
    ];

    const BEIJING = 'Asia/Shanghai';
    const stampFormatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: BEIJING,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const clockFormatter = new Intl.DateTimeFormat('zh-CN', {
      timeZone: BEIJING,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    /* ───────────────────────────── peak / off-peak math ─────────────────────── */
    /** Beijing calendar fields for one instant, from a single formatted read. */
    const beijingParts = (ms) => {
      const parts = {};
      for (const part of stampFormatter.formatToParts(new Date(ms))) {
        if (part.type !== 'literal') parts[part.type] = part.value;
      }
      if (parts.hour === '24') parts.hour = '00';
      const date = `${parts.year}-${parts.month}-${parts.day}`;
      return {
        date,
        minute: Number(parts.hour) * 60 + Number(parts.minute),
        weekday: new Date(`${date}T00:00:00Z`).getUTCDay(),
      };
    };

    /** Human-readable form of a Beijing timestamp, e.g. `2026-10-06 18:04`. */
    const beijingDisplay = (ms) => {
      const { date, minute } = beijingParts(ms);
      const pad = (n) => (n < 10 ? `0${n}` : String(n));
      return `${date} ${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
    };

    /**
     * Peak only on a Beijing weekday, outside the announced holiday set, inside
     * one of the two half-open windows.
     */
    const isPeak = (ms, holidays) => {
      const { date, minute, weekday } = beijingParts(ms);
      if (weekday === 0 || weekday === 6) return false;
      if (holidays.indexOf(date) >= 0) return false;
      for (const w of SCHEDULE.windows) if (minute >= w.from && minute < w.to) return true;
      return false;
    };

    /** Next minute at which `isPeak` flips, or null when none is found in 8 days. */
    const nextTransition = (fromMs, holidays) => {
      const origin = isPeak(fromMs, holidays);
      const base = Math.floor(fromMs / 60000) * 60000;
      for (let i = 1; i <= 8 * 24 * 60 + 5; i++) {
        const probe = base + i * 60000;
        if (isPeak(probe, holidays) !== origin) return probe;
      }
      return null;
    };

    const sameScheduleState = (a, b) =>
      a.phase === b.phase &&
      a.nextAt === b.nextAt &&
      a.beijingText === b.beijingText &&
      a.localText === b.localText &&
      a.isoText === b.isoText &&
      a.beijingDate === b.beijingDate &&
      a.weekend === b.weekend &&
      a.holiday === b.holiday;

    const computeScheduleState = (nowMs) => {
      const parts = beijingParts(nowMs);
      const holiday = HOLIDAYS_2026.indexOf(parts.date) >= 0;
      return {
        phase: isPeak(nowMs, HOLIDAYS_2026) ? 'peak' : 'offpeak',
        at: nowMs,
        nextAt: nextTransition(nowMs, HOLIDAYS_2026),
        beijingText: clockFormatter.format(new Date(nowMs)),
        beijingDate: parts.date,
        holiday,
        weekend: parts.weekday === 0 || parts.weekday === 6,
        localText: new Intl.DateTimeFormat(
          typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'zh-CN',
          { hour: '2-digit', minute: '2-digit', hour12: false },
        ).format(new Date(nowMs)),
        isoText: new Date(nowMs).toISOString().slice(11, 16),
      };
    };

    const formatDuration = (ms) => {
      const total = Math.max(0, Math.floor(ms / 1000));
      const hours = Math.floor(total / 3600);
      const minutes = Math.floor((total % 3600) / 60);
      const seconds = total % 60;
      const pad = (n) => (n < 10 ? `0${n}` : String(n));
      return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
    };

    /* ─────────────────────────── one shared clock + store ───────────────────── */

    const clock = (() => {
      let snapshot = computeScheduleState(Date.now());
      let timer = null;
      const listeners = new Set();
      const emit = () => {
        const next = computeScheduleState(Date.now());
        if (sameScheduleState(snapshot, next)) return;
        snapshot = next;
        for (const listener of listeners) listener();
      };
      return {
        getSnapshot: () => snapshot,
        subscribe(listener) {
          listeners.add(listener);
          if (listeners.size === 1) {
            emit();
            timer = setInterval(emit, TICK_MS);
          }
          return () => {
            listeners.delete(listener);
            if (listeners.size === 0 && timer !== null) {
              clearInterval(timer);
              timer = null;
            }
          };
        },
      };
    })();

    const useSchedule = () => useSyncExternalStore(clock.subscribe, clock.getSnapshot, clock.getSnapshot);

    /* ───────────────────────────── position memory ──────────────────────────── */

    /**
     * The pet may be dragged anywhere; the offset is remembered per browser.
     * `null` means the default bottom-right anchor, so the CSS default applies and
     * the pet still sits correctly if the viewport is resized smaller later.
     */
    const usePosition = () => {
      const [position, setPosition] = useState(() => {
        try {
          const raw = localStorage.getItem(POS_KEY);
          if (raw === null) return null;
          const parsed = JSON.parse(raw);
          if (parsed === null || typeof parsed !== 'object') return null;
          if (typeof parsed.left !== 'number' || typeof parsed.top !== 'number') return null;
          return { left: parsed.left, top: parsed.top };
        } catch (_error) {
          return null;
        }
      });

      const remember = useCallback((next) => {
        setPosition(next);
        try {
          if (next === null) localStorage.removeItem(POS_KEY);
          else localStorage.setItem(POS_KEY, JSON.stringify(next));
        } catch (_error) {
          /* position memory is a convenience, never a requirement */
        }
      }, []);

      return [position, remember];
    };

    /** Keep the widget inside the viewport, with a small edge gutter. */
    const DRAG_EDGE = 6;
    const dragClamp = (left, top, width, height, viewportWidth, viewportHeight) => ({
      left: Math.min(Math.max(DRAG_EDGE, left), Math.max(DRAG_EDGE, viewportWidth - width - DRAG_EDGE)),
      top: Math.min(Math.max(DRAG_EDGE, top), Math.max(DRAG_EDGE, viewportHeight - height - DRAG_EDGE)),
    });

    /** A pointer moved far enough to count as a drag rather than a click. */
    const DRAG_THRESHOLD = 4;
    const dragMoved = (dx, dy) => Math.abs(dx) + Math.abs(dy) >= DRAG_THRESHOLD;

    /**
     * Pointer drag with a click threshold, bounded to the current viewport.
     *
     * Listeners are installed on pointer-down and removed on release, so nothing
     * about the drag depends on an effect surviving a re-render — the previous
     * version keyed its `useEffect` on the `onDrop` identity and could end up
     * without live listeners. `onDrop` is kept in a ref for the same reason.
     * Any element calling `onPointerDown` becomes a drag handle.
     */
    const useDrag = (onDrop) => {
      const [drag, setDrag] = useState(null);
      const pointerRef = useRef(null);
      const movedRef = useRef(false);
      const onDropRef = useRef(onDrop);
      onDropRef.current = onDrop;

      /** Live drag rectangle for the widget root, or null when not dragging. */
      const onPointerDown = useCallback((event) => {
        if (event.button !== 0) return;
        const node = event.currentTarget;
        if (node === null || node === undefined) return;
        const rect = node.getBoundingClientRect();
        // Anchor to the widget root so the panel keeps its offset from the pet.
        const root = typeof node.closest === 'function' ? node.closest('.dshPet_root') : null;
        const anchor = root !== null && root !== undefined ? root.getBoundingClientRect() : rect;
        pointerRef.current = { x: event.clientX, y: event.clientY, rect: anchor };
        movedRef.current = false;

        const release = () => {
          document.removeEventListener('pointermove', onMove);
          document.removeEventListener('pointerup', onUp);
          document.removeEventListener('pointercancel', onUp);
          window.removeEventListener('blur', onUp);
        };
        function onMove(moveEvent) {
          const pointer = pointerRef.current;
          if (pointer === null) return;
          const dx = moveEvent.clientX - pointer.x;
          const dy = moveEvent.clientY - pointer.y;
          if (!movedRef.current && !dragMoved(dx, dy)) return;
          movedRef.current = true;
          setDrag(dragClamp(pointer.rect.left + dx, pointer.rect.top + dy, pointer.rect.width, pointer.rect.height, window.innerWidth, window.innerHeight));
        }
        function onUp() {
          const pointer = pointerRef.current;
          release();
          if (pointer === null) return;
          pointerRef.current = null;
          const moved = movedRef.current;
          movedRef.current = false;
          setDrag((current) => {
            if (moved && current !== null) onDropRef.current(current);
            return null;
          });
        }

        // Capture keeps the stream on this element even when the pointer leaves it.
        try {
          if (typeof node.setPointerCapture === 'function' && event.pointerId !== undefined) {
            node.setPointerCapture(event.pointerId);
          }
        } catch (_error) {
          /* capture is an optimization; the document listeners still work */
        }
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
        document.addEventListener('pointercancel', onUp);
        window.addEventListener('blur', onUp);
      }, []);

      /** True once, right after a real drag, so the trailing click is swallowed. */
      const consumeMoved = useCallback(() => {
        if (!movedRef.current) return false;
        movedRef.current = false;
        return true;
      }, []);

      return { drag, onPointerDown, consumeMoved };
    };

    /* ───────────────────────────────── pet model ────────────────────────────── */

    /**
     * The pet's default display name, in one place so the factory default, the
     * rename placeholder, the reset action and the persistence repair all agree.
     *
     * NOTE: this is the *display* name only. The package name (`@kuixiu/dsh-pet`),
     * the client module id and the slot entry id stay as they are — they are
     * identifiers, and changing the package name would break the profile's link.
     */
    const DEFAULT_PET_NAME = '小橘';
    const PET_NAME_MAX = 24;

    /**
     * Quote frequency, exposed in the panel as 关 / 少 / 中 / 多.
     *
     * `gapMs` is the minimum time between two lines; `pollMs` is how often the
     * idle check runs. `off` never speaks. The stored value is a plain string, so
     * an unknown one falls back instead of breaking.
     *
     * Declared next to the other pet fields because `sanitizePet` normalises it.
     */
    const QUOTE_RATES = {
      off: { gapMs: 0, pollMs: 0, key: 'quote.freq.off' },
      rare: { gapMs: 8 * 60 * 1000, pollMs: 60 * 1000, key: 'quote.freq.rare' },
      normal: { gapMs: 90 * 1000, pollMs: 30 * 1000, key: 'quote.freq.normal' },
      chatty: { gapMs: 25 * 1000, pollMs: 12 * 1000, key: 'quote.freq.chatty' },
    };
    const QUOTE_RATE_ORDER = ['off', 'rare', 'normal', 'chatty'];
    const DEFAULT_QUOTE_RATE = 'normal';

    const quoteRateOf = (value) => (typeof value === 'string' && QUOTE_RATES[value] !== undefined ? value : DEFAULT_QUOTE_RATE);

    /** Legacy boolean `quotesEnabled:false` maps onto the new rate. */
    const quoteRateFromPet = (pet) => {
      if (pet.quotesEnabled === false && pet.quoteRate === undefined) return 'off';
      return quoteRateOf(pet.quoteRate);
    };

    const STATS = [
      { key: 'satiety', labelKey: 'stat.satiety', token: '--dsw-alias-state-warn-primary' },
      { key: 'mood', labelKey: 'stat.mood', token: '--dsw-alias-state-success-primary' },
      { key: 'energy', labelKey: 'stat.energy', token: '--dsw-alias-brand-primary' },
    ];

    const emptyPet = () => ({
      version: 1,
      name: DEFAULT_PET_NAME,
      satiety: 72,
      mood: 80,
      energy: 90,
      bornAt: Date.now(),
      updatedAt: Date.now(),
      fed: 0,
      patted: 0,
      played: 0,
      holidayOverride: false,
      showStatus: true,
      quotesEnabled: true,
      quoteRate: DEFAULT_QUOTE_RATE,
    });

    const clamp = (value) => Math.min(100, Math.max(0, value));

    /** A finite number, or the fallback. Rejects null/undefined/NaN/Infinity. */
    const finiteOr = (value, fallback) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback);

    /** A finite number clamped into [0, 100], or the fallback. */
    const scoreOr = (value, fallback) => clamp(finiteOr(value, fallback));

    /** A non-blank string, or the fallback. */
    const nameOr = (value, fallback) => (typeof value === 'string' && value.trim() !== '' ? value : fallback);

    /** A display-safe name: trimmed, single-line, length-capped. */
    const cleanPetName = (value) => {
      if (typeof value !== 'string') return '';
      // Newlines would break the one-line label above the cat.
      const flat = value.replace(/[\r\n\t]+/g, ' ').trim();
      return flat.slice(0, PET_NAME_MAX);
    };

    /** A non-negative integer, or the fallback. */
    const countOr = (value, fallback) => Math.max(0, Math.round(finiteOr(value, fallback)));

    /** A real boolean, or the fallback. Never `null`/`undefined`/truthy strings. */
    const boolOr = (value, fallback) => (typeof value === 'boolean' ? value : fallback);

    const DEFAULT_NAME = () => DEFAULT_PET_NAME;

    /**
     * Repair any stored record into a complete, renderable pet.
     *
     * This is the important half of persistence: `Object.assign(emptyPet(), stored)`
     * lets an explicitly `null` — or `undefined` — stored field OVERWRITE the
     * default, which rendered as `undefined · 肚子饿了` and
     * `undefined · undefined · undefined` in the widget. Every field is therefore
     * picked and type-checked individually, and a non-object record is ignored.
     */
    const sanitizePet = (raw) => {
      const source = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
      const now = Date.now();
      const bornAt = finiteOr(source.bornAt, now);
      return {
        version: 1,
        name: nameOr(cleanPetName(source.name), DEFAULT_NAME()),
        satiety: scoreOr(source.satiety, 72),
        mood: scoreOr(source.mood, 80),
        energy: scoreOr(source.energy, 90),
        bornAt,
        // A timestamp in the future would make decay negative; it is clamped out.
        updatedAt: Math.min(finiteOr(source.updatedAt, now), now),
        fed: countOr(source.fed, 0),
        patted: countOr(source.patted, 0),
        played: countOr(source.played, 0),
        holidayOverride: boolOr(source.holidayOverride, false),
        showStatus: boolOr(source.showStatus, true),
        quotesEnabled: boolOr(source.quotesEnabled, true),
        quoteRate: quoteRateOf(source.quoteRate),
      };
    };

    const loadPet = () => {
      try {
        const raw = localStorage.getItem(STORE_KEY);
        if (raw === null) return emptyPet();
        return sanitizePet(JSON.parse(raw));
      } catch (_error) {
        return emptyPet();
      }
    };

    const savePet = (pet) => {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(pet));
      } catch (_error) {
        /* a blocked or full localStorage must never break rendering */
      }
    };

    /**
     * Decay that accumulates while the page was closed, bounded to 48 h.
     *
     * Every input is coerced to a finite number first. Without that, a
     * non-finite `updatedAt` makes `minutes` NaN, `NaN < 1` is false so the early
     * return never fires, and `clamp(NaN)` is STILL NaN — which wrote `NaN` into
     * satiety / mood / energy and rendered as three `NaN` rows in the panel.
     */
    const decayRate = { satiety: -0.5, mood: -0.25, energy: 0.25 };

    const decayed = (pet, nowMs) => {
      const now = finiteOr(nowMs, Date.now());
      const updatedAt = Math.min(finiteOr(pet.updatedAt, now), now);
      const minutes = Math.min(48 * 60, Math.max(0, (now - updatedAt) / 60000));

      const carried = {
        satiety: finiteOr(pet.satiety, 72),
        mood: finiteOr(pet.mood, 80),
        energy: finiteOr(pet.energy, 90),
      };
      if (!Number.isFinite(minutes) || minutes < 1) {
        return Object.assign({}, pet, carried, { updatedAt });
      }
      return Object.assign({}, pet, carried, {
        satiety: clamp(carried.satiety + minutes * decayRate.satiety),
        mood: clamp(carried.mood + minutes * decayRate.mood),
        energy: clamp(carried.energy + minutes * decayRate.energy),
        updatedAt: now,
      });
    };

    const usePet = () => {
      const [pet, setPet] = useState(() => decayed(loadPet(), Date.now()));

      useEffect(() => {
        savePet(pet);
      }, [pet]);

      const mutate = useCallback((fn) => {
        setPet((current) => {
          const base = decayed(current, Date.now());
          const patch = fn(base);
          const merged = Object.assign({}, base, patch !== null && typeof patch === 'object' ? patch : {}, {
            updatedAt: Date.now(),
          });
          // A patch may not introduce a NaN into a field the UI renders.
          return sanitizePet(merged);
        });
      }, []);

      return [pet, mutate];
    };

    const moodLevel = (pet) => (pet.mood >= 70 ? 'happy' : pet.mood >= 35 ? 'ok' : 'sad');

    /* ─────────────────────────────────── styles ─────────────────────────────── */

    const STYLE_ID = '@kuixiu/dsh-pet/pet.css';

    const CSS = `
.dshPet_root{position:fixed;right:20px;bottom:20px;z-index:30;display:flex;flex-direction:column;align-items:flex-end;gap:8px;pointer-events:none;font-family:inherit}
.dshPet_root>*{pointer-events:auto}
.dshPet_compact{display:flex;flex-direction:column;align-items:center;gap:2px}
.dshPet_pet{border:0;background:none;padding:0;cursor:grab;display:block;line-height:0;border-radius:16px;transition:transform .18s ease;touch-action:none;user-select:none;-webkit-user-select:none}
.dshPet_root[data-dragging=true]{cursor:grabbing}
.dshPet_root[data-dragging=true] .dshPet_pet{transition:none;cursor:grabbing;transform:none}
.dshPet_pet:hover{transform:translateY(-3px)}
.dshPet_pet:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:3px}
.dshPet_name{font-size:11px;line-height:14px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.dshPet_badge{display:inline-flex;align-items:center;gap:6px;border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-overlay);border-radius:999px;padding:4px 10px;font-size:12px;line-height:16px;color:var(--dsw-alias-label-primary);cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.08);transition:background .15s ease}
.dshPet_badge:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2))}
.dshPet_badge:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dshPet_dot{width:8px;height:8px;border-radius:50%;flex:none;background:var(--dsw-alias-state-success-primary)}
.dshPet_dot[data-phase=peak]{background:var(--dsw-alias-state-warn-primary)}
.dshPet_dot[data-pulse=true]{animation:dshPet_pulse 2s ease-in-out infinite}
.dshPet_count{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary)}
.dshPet_panel{width:248px;box-sizing:border-box;border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-overlay);border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.16);padding:12px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:10px}
.dshPet_head{display:flex;align-items:center;gap:8px}
.dshPet_title{font-size:13px;font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshPet_close{width:22px;height:22px;flex:none;border:0;background:none;border-radius:6px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));cursor:pointer;font-size:14px;line-height:1;display:inline-flex;align-items:center;justify-content:center}
.dshPet_close:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-primary)}
.dshPet_headline{display:flex;align-items:center;gap:7px}
.dshPet_phaseName{font-size:14px;font-weight:600;line-height:20px}
.dshPet_headlineCount{margin-left:auto;font-size:11px;line-height:15px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;white-space:nowrap}
.dshPet_countdown{font-size:24px;font-weight:600;line-height:30px;font-variant-numeric:tabular-nums;letter-spacing:.5px}
.dshPet_section{display:flex;flex-direction:column;gap:6px}
.dshPet_rowLabel{display:flex;align-items:baseline;justify-content:space-between;gap:8px;font-size:11px;line-height:15px;color:var(--dsw-alias-label-secondary)}
.dshPet_statValue{font-variant-numeric:tabular-nums}
.dshPet_bar{height:6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}
.dshPet_barFill{height:100%;border-radius:999px;transition:width .4s ease}
.dshPet_kv{display:flex;justify-content:space-between;gap:8px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary)}
.dshPet_kv b{font-weight:600;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}
.dshPet_actions{display:flex;gap:6px}
.dshPet_action{flex:1;border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:9px;padding:6px 0;font-size:12px;line-height:16px;cursor:pointer;font-family:inherit}
.dshPet_action:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2))}
.dshPet_action:disabled{cursor:default;opacity:.45}
.dshPet_action:disabled:hover{background:var(--dsw-alias-bg-layer-1)}
.dshPet_action:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dshPet_note{font-size:10px;line-height:14px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary))}
.dshPet_note a{color:inherit}
.dshPet_holiday{display:flex;align-items:center;gap:6px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dshPet_holiday input{margin:0;accent-color:var(--dsw-alias-brand-primary)}
.dshPet_offer{width:44px;height:44px;border:.5px dashed var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-secondary);cursor:grab;font-size:20px;line-height:1;box-shadow:0 2px 8px rgba(0,0,0,.08);touch-action:none;user-select:none;-webkit-user-select:none}
.dshPet_offer:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2))}
.dshPet_root[data-dragging=true] .dshPet_offer{cursor:grabbing}
.dshPet_offer:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
@keyframes dshPet_pulse{0%,100%{opacity:1}50%{opacity:.35}}
.dshPet_quote{position:relative;max-width:210px;margin-bottom:2px;border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-overlay);border-radius:14px 14px 4px 14px;padding:6px 10px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-primary);text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.08);animation:dshPet_quoteIn .32s ease-out 1}
.dshPet_quote[data-quote=night]{color:var(--dsw-alias-label-secondary)}
.dshPet_quote[data-quote=stuck]{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}
.dshPet_quote[data-quote=done]{border-color:var(--dsw-alias-state-success-primary)}
@keyframes dshPet_quoteIn{0%{opacity:0;transform:translateY(5px) scale(.94)}100%{opacity:1;transform:none}}
.dshPet_rateGroup{display:inline-flex;gap:3px}
.dshPet_rate{border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);border-radius:6px;cursor:pointer;font:inherit;font-size:11px;line-height:14px;padding:1px 7px}
.dshPet_rate:hover{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-primary)}
.dshPet_rate[data-selected=true]{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff}
.dshPet_rate:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dshPet_nameInput{border:.5px solid var(--dsw-alias-border-l4,var(--dsw-alias-border-l2));border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:11px;line-height:16px;min-width:0;flex:1;height:22px;padding:0 6px;outline:none}
.dshPet_nameInput:focus{border-color:var(--dsw-alias-brand-primary)}
.dshPet_nameInput::placeholder{color:var(--dsw-alias-label-caption,var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary)))}
.dshPet_nameEdit{display:inline-flex;align-items:center;gap:4px;flex:1;justify-content:flex-end;max-width:150px}
.dshPet_nameButton{width:20px;height:20px;flex:none;border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);border-radius:6px;cursor:pointer;font-size:11px;line-height:1;padding:0;display:inline-flex;align-items:center;justify-content:center}
.dshPet_nameButton:hover:enabled{background:var(--dsw-alias-interactive-bg-hover,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-primary)}
.dshPet_nameButton:disabled{cursor:default;opacity:.4}
.dshPet_spend{display:inline-flex;align-items:center;gap:6px;margin-bottom:2px;border-radius:999px;padding:3px 10px;font-size:11px;line-height:15px;background:var(--dsw-alias-bg-overlay);border:.5px solid var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary);white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.08)}
.dshPet_spendLabel{color:var(--dsw-alias-label-secondary)}
.dshPet_spendValue{font-variant-numeric:tabular-nums}
.dshPet_bubble{display:inline-flex;align-items:center;gap:6px;max-width:220px;margin-bottom:2px;border:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-overlay);border-radius:999px;padding:3px 10px;font-size:11px;line-height:15px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-shadow:0 2px 8px rgba(0,0,0,.08)}
.dshPet_bubbleDot{width:6px;height:6px;border-radius:50%;flex:none;background:var(--dsw-alias-brand-primary);animation:dshPet_pulse 1.6s ease-in-out infinite}
.dshPet_bubble[data-activity=waiting]{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}
.dshPet_bubble[data-activity=waiting] .dshPet_bubbleDot{background:var(--dsw-alias-state-warn-primary)}
.dshPet_bubble[data-activity=done]{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}
.dshPet_bubble[data-activity=done] .dshPet_bubbleDot{background:var(--dsw-alias-state-success-primary);animation:none}
@keyframes dshPet_bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
@keyframes dshPet_tail{0%,100%{transform:rotate(-7deg)}50%{transform:rotate(9deg)}}
@keyframes dshPet_earL{0%,86%,100%{transform:rotate(0)}90%{transform:rotate(-11deg)}94%{transform:rotate(0)}}
@keyframes dshPet_earR{0%,88%,100%{transform:rotate(0)}92%{transform:rotate(11deg)}96%{transform:rotate(0)}}
@keyframes dshPet_blink{0%,90%,100%{transform:scaleY(1)}94%{transform:scaleY(.12)}}
@keyframes dshPet_pop{0%{transform:translateY(0) scale(1)}40%{transform:translateY(-9px) scale(1.06)}100%{transform:translateY(0) scale(1)}}
@keyframes dshPet_float{0%{opacity:0;transform:translateY(2px) scale(.7)}30%{opacity:1}100%{opacity:0;transform:translateY(-22px) scale(1.15)}}
@media (prefers-reduced-motion:reduce){.dshPet_pet *,.dshPet_dot{animation:none!important}}
`;

    /* ──────────────────────────────── the pet ───────────────────────────────── */

    const FUR = '#f6c98f';
    const FUR_DARK = '#e0a866';
    const BELLY = '#fff4e4';
    const INK = '#3d2b1f';

    function Heart(props) {
      return h(
        'path',
        Object.assign(
          {
            d: 'M0 3.2c0-1.2.9-2 1.9-2 .8 0 1.4.5 1.6 1 .2-.5.8-1 1.6-1 1 0 1.9.8 1.9 2 0 2-3.5 4.2-3.5 4.2S0 5.2 0 3.2z',
            fill: 'var(--dsw-alias-state-error-primary)',
          },
          props,
        ),
      );
    }

    /**
     * Q-version kitten. Every animated group carries its own transform-origin so
     * the CSS keyframes above stay declarative.
     */
    function Cat(props) {
      const size = props.size || 92;
      const mood = props.mood || 'ok';
      const cheer = props.cheer === true;
      const eyeY = mood === 'sad' ? 46.5 : 45;
      const lidDrop = mood === 'sad' ? 4 : 0;
      const focused = mood === 'working';
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 96 96',
          role: 'img',
          'aria-label': props.label,
          style: { display: 'block', overflow: 'visible' },
        },
        h(
          'g',
          {
            style: {
              transformOrigin: '48px 80px',
              animation: 'dshPet_bob 3.4s ease-in-out infinite',
            },
          },
          // tail
          h(
            'g',
            { style: { transformOrigin: '70px 66px', animation: 'dshPet_tail 2.2s ease-in-out infinite' } },
            h('path', {
              d: 'M69 68c9 1 14-4 13-11-0.7-5-5-7-8-5-2.4 1.6-2.2 5 0.6 5.6 2.6.6 4.4-2 5.4-4.2',
              fill: 'none',
              stroke: FUR_DARK,
              strokeWidth: 6,
              strokeLinecap: 'round',
            }),
          ),
          // body
          h('ellipse', { cx: 48, cy: 70, rx: 22, ry: 17, fill: FUR }),
          h('ellipse', { cx: 48, cy: 73, rx: 13, ry: 11, fill: BELLY }),
          // front paws
          h('ellipse', { cx: 36, cy: 83, rx: 7.5, ry: 5, fill: BELLY }),
          h('ellipse', { cx: 60, cy: 83, rx: 7.5, ry: 5, fill: BELLY }),
          // head
          h(
            'g',
            cheer
              ? { style: { transformOrigin: '48px 46px', animation: 'dshPet_pop .7s ease-out 1' } }
              : null,
            // ears
            h(
              'g',
              { style: { transformOrigin: '32px 34px', animation: 'dshPet_earL 6.5s ease-in-out infinite' } },
              h('path', { d: 'M34 33 27 14l17 8z', fill: FUR }),
              h('path', { d: 'M34 31 30 20l10 5z', fill: '#f7a8b8' }),
            ),
            h(
              'g',
              { style: { transformOrigin: '64px 34px', animation: 'dshPet_earR 6.5s ease-in-out infinite' } },
              h('path', { d: 'M62 33 69 14l-17 8z', fill: FUR }),
              h('path', { d: 'M62 31 66 20l-10 5z', fill: '#f7a8b8' }),
            ),
            h('ellipse', { cx: 48, cy: 46, rx: 25, ry: 22, fill: FUR }),
            h('ellipse', { cx: 48, cy: 54, rx: 15, ry: 10, fill: BELLY }),
            // eyes
            h(
              'g',
              { style: { transformOrigin: `${eyeY}px`, animation: 'dshPet_blink 4.6s ease-in-out infinite' } },
              h('ellipse', { cx: 38, cy: eyeY, rx: 4.6, ry: 5.2, fill: INK }),
              h('ellipse', { cx: 58, cy: eyeY, rx: 4.6, ry: 5.2, fill: INK }),
              h('circle', { cx: 39.6, cy: eyeY - 1.8, r: 1.5, fill: '#ffffff' }),
              h('circle', { cx: 59.6, cy: eyeY - 1.8, r: 1.5, fill: '#ffffff' }),
            ),
            lidDrop > 0
              ? h('rect', { x: 32, y: eyeY - 5.4, width: 12.5, height: lidDrop, fill: FUR })
              : null,
            lidDrop > 0
              ? h('rect', { x: 52, y: eyeY - 5.4, width: 12.5, height: lidDrop, fill: FUR })
              : null,
            // blush
            h('ellipse', { cx: 31, cy: 53, rx: 5, ry: 3, fill: '#f7a8b8', opacity: 0.6 }),
            h('ellipse', { cx: 65, cy: 53, rx: 5, ry: 3, fill: '#f7a8b8', opacity: 0.6 }),
            // nose + mouth
            h('path', { d: 'M45.4 51.6h5.2L48 54.4z', fill: '#e46a76' }),
            mood === 'happy'
              ? h('path', {
                  d: 'M42.5 56q5.5 5 11 0',
                  fill: 'none',
                  stroke: INK,
                  strokeWidth: 1.7,
                  strokeLinecap: 'round',
                })
              : focused
                ? h(
                    'g',
                    null,
                    h('path', {
                      d: 'M45 55.5q3 3.4 6 0',
                      fill: 'none',
                      stroke: INK,
                      strokeWidth: 1.7,
                      strokeLinecap: 'round',
                    }),
                    h('circle', { cx: 36, cy: 41, r: 1.3, fill: '#ffffff' }),
                    h('circle', { cx: 56, cy: 41, r: 1.3, fill: '#ffffff' }),
                  )
                : h('path', {
                    d: 'M43.5 58.5q4.5-3.4 9 0',
                    fill: 'none',
                    stroke: INK,
                    strokeWidth: 1.7,
                    strokeLinecap: 'round',
                  }),
            // whiskers
            h('path', { d: 'M22 50h9M22 56h9M65 50h9M65 56h9', stroke: FUR_DARK, strokeWidth: 1.2, strokeLinecap: 'round' }),
          ),
        ),
        // floating heart on interaction
        cheer
          ? h('g', { style: { animation: 'dshPet_float 1s ease-out 1', transformOrigin: '72px 26px' } }, h(Heart, { transform: 'translate(70 22) scale(1.5)' }))
          : null,
      );
    }

    /* ──────────────────────────── live agent status ─────────────────────────── */

    /**
     * `@deepseek-ai/dsh-client-ui-session` installs its Session catalog and
     * unified status through `ctx.slots.provideRoot`, and that package's README
     * states every slot component receives a root-keyed hook "whatever its
     * scope". So this root-scoped overlay entry really does get `useSessions`
     * and `useSessionStatus`, and no session-scoped slot is required.
     *
     * Shapes taken from the shipped source:
     *   useSessions(s => s)            -> { ids: string[], byId: { [id]: summary } }
     *                                     summary.running, summary.retainedBy.mainView
     *   useSessionStatus(s => s)       -> Map<sessionId, {
     *                                       running?: boolean,
     *                                       pendingInteraction?: { kind },
     *                                       completionUnread?: boolean }>
     *
     * A missing hook must never crash the entry (a throwing component blanks its
     * slot), so a missing hook degrades to a trivial selector instead of calling
     * something that does not exist.
     */
    const IDENTITY_SELECTOR = (value) => value;
    const safeHook = (hook) => (...args) => {
      if (typeof hook === 'function') {
        try {
          return hook(...args);
        } catch (_error) {
          return undefined;
        }
      }
      return undefined;
    };

    /** The Session the main view retains; that is the one the user is driving. */
    const activeSessionOf = (list) => {
      if (list === undefined || list === null || list.byId === undefined || list.byId === null) return undefined;
      const rows = Object.values(list.byId);
      return (rows.find((row) => row !== null && row !== undefined && (row.retainedBy?.mainView ?? 0) > 0) ?? rows[0]);
    };

    /**
     * The pet's reading of the agent: waiting for your answer, thinking/running,
     * freshly finished, or idle. Deliberately only uses facts that exist in the
     * status Map (running / pendingInteraction / completionUnread); no error text
     * is invented, because the root hooks carry no error field.
     */
    const deriveActivity = (list, statuses) => {
      const active = activeSessionOf(list);
      if (active === undefined) return 'idle';
      const sessionId = active.id ?? active.sessionId;
      const state = statuses !== undefined && statuses !== null && typeof statuses.get === 'function' ? statuses.get(sessionId) : undefined;
      const running = state?.running === true || active.running === true;
      if (state?.pendingInteraction !== undefined && state?.pendingInteraction !== null) return 'waiting';
      if (running) return 'running';
      if (state?.completionUnread === true) return 'done';
      return 'idle';
    };

    /** True when the catalog actually holds a Session whose status we can read. */
    const hasActiveSession = (list) => activeSessionOf(list) !== undefined;

    /* ────────────────────────── token usage → real cost ─────────────────────── */

    /**
     * Rate card, per 1M tokens, from the official pricing pages (EN + zh-cn).
     * The peak/off-peak split is uniform at 50%, which `SCHEDULE.discount`
     * already records, so only peak rates are listed here.
     */
    const RATES = {
      revision: '2026-10-06',
      currency: 'CNY',
      per: 1_000_000,
      // Keyed by the model prefix reported by the usage route, so a dated
      // snapshot such as `DeepSeek-V4-Pro-0813` resolves to `deepseek-v4-pro`.
      models: {
        'deepseek-flash': {
          cacheRead: 0.02,
          uncachedInput: 1.0,
          cacheWrite: 1.0, // no separate cache-write price is published
          output: 4.0,
        },
        'deepseek-v4-pro': {
          cacheRead: 0.15,
          uncachedInput: 4.5,
          cacheWrite: 4.5,
          output: 13.5,
        },
      },
    };

    const CURRENCY_SYMBOL = { CNY: '¥', USD: '$' };
    const NUMBER_LOCALE = { CNY: 'zh-CN', USD: 'en-US' };

    /** Resolve a reported route model (`deepseek-v4-pro-0813`) to a rate card. */
    const ratesFor = (model) => {
      if (typeof model !== 'string' || model === '') return undefined;
      const normalized = model.toLowerCase();
      const exact = RATES.models[normalized];
      if (exact !== undefined) return exact;
      const prefix = Object.keys(RATES.models).find((key) => normalized.startsWith(key));
      return prefix === undefined ? undefined : RATES.models[prefix];
    };

    const tokenTotal = (buckets) =>
      (buckets?.uncachedInputTokens ?? 0) +
      (buckets?.cacheReadTokens ?? 0) +
      (buckets?.cacheWriteTokens ?? 0) +
      (buckets?.outputTokens ?? 0);

    /**
     * Price one set of billing buckets. `multiplier` carries the peak/off-peak
     * discount of the moment the delta was observed.
     *
     * Returns `{ cost, priced, total }`: `priced` is false when the route model
     * has no rate card, so an unknown model reports "unpriced" instead of a
     * fabricated number.
     */
    const priceBuckets = (buckets, model, multiplier) => {
      const rates = ratesFor(model);
      const total = tokenTotal(buckets);
      if (rates === undefined) return { cost: 0, priced: false, total };
      // `rates` is the model card; the per-token divisor lives on the card's
      // parent (`RATES.per`), NOT on `rates` — reading `rates.per` here made
      // every cost `NaN`.
      const scale = RATES.per === 0 ? 0 : (Number.isFinite(multiplier) ? multiplier : 1) / RATES.per;
      const cost =
        (finiteOr(buckets?.cacheReadTokens, 0) * rates.cacheRead +
          finiteOr(buckets?.uncachedInputTokens, 0) * rates.uncachedInput +
          finiteOr(buckets?.cacheWriteTokens, 0) * rates.cacheWrite +
          finiteOr(buckets?.outputTokens, 0) * rates.output) *
        scale;
      return { cost, priced: true, total };
    };

    /** Peak (1) or off-peak multiplier for an instant, from the schedule. */
    const multiplierAt = (ms) => (isPeak(ms, HOLIDAYS_2026) ? 1 : (100 - SCHEDULE.discount) / 100);

    /** True when every billing bucket is zero. */
    const zeroBuckets = (buckets) =>
      finiteOr(buckets?.uncachedInputTokens, 0) === 0 &&
      finiteOr(buckets?.cacheReadTokens, 0) === 0 &&
      finiteOr(buckets?.cacheWriteTokens, 0) === 0 &&
      finiteOr(buckets?.outputTokens, 0) === 0;

    /** Billing buckets from a sessions-catalog row's `tokenUsage` projection. */
    const usageOf = (row) => {
      const usage = row?.projectionValues?.tokenUsage;
      if (usage === null || typeof usage !== 'object') return undefined;
      return {
        uncachedInputTokens: finiteOr(usage.uncachedInputTokens, 0),
        outputTokens: finiteOr(usage.outputTokens, 0),
        cacheReadTokens: finiteOr(usage.cacheReadTokens, 0),
        cacheWriteTokens: finiteOr(usage.cacheWriteTokens, 0),
      };
    };

    const bucketsEqual = (left, right) =>
      left !== undefined &&
      right !== undefined &&
      left.uncachedInputTokens === right.uncachedInputTokens &&
      left.outputTokens === right.outputTokens &&
      left.cacheReadTokens === right.cacheReadTokens &&
      left.cacheWriteTokens === right.cacheWriteTokens;

    /** The model reported by the session's last usage route, if any. */
    const routeModelOf = (row) => {
      const routes = row?.projectionValues?.tokenUsageRoutes;
      if (Array.isArray(routes) && routes.length > 0 && typeof routes[0]?.model === 'string') return routes[0].model;
      return 'deepseek-flash';
    };

    /* ─────────────────────────── session cost ledger ────────────────────────── */

    const COST_KEY = 'dsh-pet.cost.v1';

    const emptyLedger = () => ({
      sessionId: null,
      totals: null,
      peak: 0,
      offpeak: 0,
      model: null,
      updatedAt: 0,
      unpriced: false,
      // Running cost when the current turn started; the turn total is
      // `ledgerTotal(ledger) - turnBaseline`.
      turnBaseline: 0,
    });

    const loadLedger = () => {
      try {
        const raw = localStorage.getItem(COST_KEY);
        if (raw === null) return emptyLedger();
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return emptyLedger();
        return {
          sessionId: typeof parsed.sessionId === 'string' ? parsed.sessionId : null,
          totals: parsed.totals !== null && typeof parsed.totals === 'object' ? parsed.totals : null,
          peak: finiteOr(parsed.peak, 0),
          offpeak: finiteOr(parsed.offpeak, 0),
          model: typeof parsed.model === 'string' ? parsed.model : null,
          updatedAt: finiteOr(parsed.updatedAt, 0),
          unpriced: parsed.unpriced === true,
          turnBaseline: finiteOr(parsed.turnBaseline, 0),
        };
      } catch (_error) {
        return emptyLedger();
      }
    };

    const saveLedger = (ledger) => {
      try {
        localStorage.setItem(COST_KEY, JSON.stringify(ledger));
      } catch (_error) {
        /* a blocked localStorage must never break rendering */
      }
    };

    const cloneBuckets = (buckets) => ({
      uncachedInputTokens: finiteOr(buckets?.uncachedInputTokens, 0),
      outputTokens: finiteOr(buckets?.outputTokens, 0),
      cacheReadTokens: finiteOr(buckets?.cacheReadTokens, 0),
      cacheWriteTokens: finiteOr(buckets?.cacheWriteTokens, 0),
    });

    /** Money banked so far: peak plus off-peak. */
    const ledgerTotal = (ledger) => finiteOr(ledger.peak, 0) + finiteOr(ledger.offpeak, 0);

    /** Monotonic per-bucket delta; a shrink means a new session generation. */
    const bucketsDelta = (previous, next) => {
      const fields = ['uncachedInputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'];
      for (const field of fields) if (finiteOr(next?.[field], 0) < finiteOr(previous?.[field], 0)) return undefined;
      const delta = {};
      for (const field of fields) delta[field] = finiteOr(next?.[field], 0) - finiteOr(previous?.[field], 0);
      return delta;
    };

    /**
     * Fold one new projection reading into the ledger.
     *
     * `tokenUsage` is a cumulative whole-log projection that grows on EVERY model
     * call, so a per-reading delta is a per-call amount, not a turn total. Each
     * delta is still banked into the peak/off-peak buckets exactly once (that is
     * what makes the session total correct); the per-turn figure is derived
     * separately from `turnBaseline`.
     */
    const foldLedger = (ledger, sessionId, buckets, model, nowMs) => {
      const runningTotal = ledgerTotal(ledger);
      if (buckets === undefined) return { ledger, turnCost: null, priced: false, total: 0 };
      if (ledger.sessionId !== sessionId || ledger.totals === null) {
        // A session the ledger is not tracking, or one whose totals were never
        // read: ADOPT the current reading as the baseline instead of charging it.
        //
        // Charging here looks tempting — it would catch a brand-new session's
        // first model call — but the projection is cumulative for the whole
        // durable log, so a session switch or a reload would then re-charge that
        // session's entire history. Under-reporting one reading is a bounded,
        // honest loss; double-charging is not. Totals logged before this page
        // opened are therefore never billed.
        return {
          ledger: Object.assign({}, ledger, {
            sessionId,
            totals: cloneBuckets(buckets),
            turnBaseline: runningTotal,
            model,
            updatedAt: nowMs,
            unpriced: ratesFor(model) === undefined,
          }),
          turnCost: 0,
          priced: ratesFor(model) !== undefined,
          total: 0,
        };
      }
      const delta = bucketsDelta(ledger.totals, buckets);
      if (delta === undefined) {
        // A bucket shrank: the session is a fresh generation, so only re-anchor.
        return {
          ledger: Object.assign({}, ledger, {
            sessionId,
            totals: cloneBuckets(buckets),
            turnBaseline: runningTotal,
            model,
            updatedAt: nowMs,
            unpriced: ratesFor(model) === undefined,
          }),
          turnCost: 0,
          priced: ratesFor(model) !== undefined,
          total: 0,
        };
      }
      const priced = zeroBuckets(delta)
        ? { cost: 0, priced: ratesFor(model) !== undefined, total: 0 }
        : priceBuckets(delta, model, multiplierAt(nowMs));
      const offPeak = multiplierAt(nowMs) < 1;
      const next = Object.assign({}, ledger, {
        sessionId,
        totals: cloneBuckets(buckets),
        model,
        updatedAt: nowMs,
        unpriced: ratesFor(model) === undefined,
      });
      if (priced.cost > 0) {
        if (offPeak) next.offpeak = finiteOr(ledger.offpeak, 0) + priced.cost;
        else next.peak = finiteOr(ledger.peak, 0) + priced.cost;
      }
      return { ledger: next, turnCost: priced.cost, priced: priced.priced, total: priced.total };
    };

    /** Format an amount with an honest number of decimals for its magnitude. */
    const formatCost = (amount, currency) => {
      const code = CURRENCY_SYMBOL[currency] === undefined ? 'CNY' : currency;
      const symbol = CURRENCY_SYMBOL[code];
      const value = finiteOr(amount, 0);
      const decimals = value === 0 ? 2 : value < 0.01 ? 4 : value < 1 ? 3 : 2;
      return `${symbol}${value.toLocaleString(NUMBER_LOCALE[code], {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })}`;
    };

    /* ───────────────────────────── the pet's one-liners ────────────────────── */

    /**
     * Quote bank, inline data only (a browser-only plugin has no module imports).
     *
     * Four bands keep the line relevant instead of random: `idle` while nothing
     * is running, `done` right after a turn settles, `stuck` when the pet's own
     * mood is low, and `night` when local time is late. Every entry is one short
     * line because the bubble is a single-line pill above the cat.
     */
    const QUOTES = {
      idle: [
        ['idle-1', 'Small steps still count.', '一步一步来，也算数。'],
        ['idle-2', 'Shipped beats perfect.', '能跑起来，就赢过完美主义。'],
        ['idle-3', 'The bug is just a question in disguise.', 'Bug 只是换了件衣服的问题。'],
        ['idle-4', 'Drink some water. The code will wait.', '先喝口水，代码会等你。'],
        ['idle-5', 'You are not behind. You are mid-refactor.', '你不是落后，你是在重构。'],
        ['idle-6', 'Read it again. Slowly.', '再读一遍，慢一点。'],
        ['idle-7', 'Every expert once broke main.', '每个高手的第一次，都炸过主干。'],
        ['idle-8', 'Name it well and half the problem is gone.', '名字起对了，问题就少一半。'],
        ['idle-9', 'Commit early, commit often.', '早点提交，常常提交。'],
        ['idle-10', 'It works on your machine — that is a start.', '「我这儿能跑」——这就是起点。'],
        ['idle-11', 'Stuck? Explain it out loud.', '卡住了？讲出来就好了。'],
        ['idle-12', 'Deleting code is also progress.', '删代码也是进度。'],
      ],
      done: [
        ['done-1', 'Done. Go stretch.', '搞定了，起来伸个懒腰。'],
        ['done-2', 'That is one more thing off the pile.', '清单又少了一件。'],
        ['done-3', 'Nice. The next one is easier.', '不错，下一件更轻松。'],
        ['done-4', 'Shipped. Be a little proud.', '交付了，可以小小得意一下。'],
        ['done-5', 'Another one handled.', '又搞定一个。'],
        ['done-6', 'See? You did know how.', '看吧，你本来就会。'],
      ],
      stuck: [
        ['stuck-1', 'Rough patch. Still here with you.', '这段有点难，我还在。'],
        ['stuck-2', 'Errors are the compiler talking to you.', '报错只是编译器在跟你说话。'],
        ['stuck-3', 'Breathe. Then read the trace.', '深呼吸，然后读栈。'],
        ['stuck-4', 'Half of debugging is believing it is fixable.', '调试的一半，是相信它能修好。'],
        ['stuck-5', 'One line at a time.', '一次改一行。'],
        ['stuck-6', 'You have survived worse builds than this.', '比这更糟的构建你都扛过来了。'],
      ],
      night: [
        ['night-1', 'Late. The bug will still be there tomorrow.', '夜深了，bug 明天还在。'],
        ['night-2', 'Save, commit, sleep.', '存盘，提交，睡觉。'],
        ['night-3', 'Tired code is expensive code.', '困着写的代码最贵。'],
        ['night-4', 'Rest is part of the work.', '休息也是工作的一部分。'],
      ],
    };

    /** Flat id -> [en, zh] index so a rendered line can be translated by id. */
    const QUOTE_BY_ID = {};
    for (const band of Object.keys(QUOTES)) {
      for (const [id, en, zh] of QUOTES[band]) QUOTE_BY_ID[id] = { en, zh };
    }

    const QUOTE_SHOW_MS = 8000;

    /**
     * Choose a band for the moment.
     *
     * Order matters: a finished turn beats idle chatter, and `waiting` means the
     * agent is blocked on the user, which is exactly when a reassuring line
     * lands. A late hour then narrows the pool to rest-focused lines.
     *
     * `stuck` is deliberately NOT selected from the pet's own game stats: the
     * pet being hungry is a toy, and using it to decide what the user is told
     * would be nonsense. Its lines stay in the bank, keyed for an error signal if
     * that is ever wired in.
     */
    const quoteBand = (activity, celebrating, hour) => {
      if (activity === 'done' || celebrating === true) return 'done';
      if (activity === 'waiting') return 'stuck';
      if (hour >= 23 || hour < 5) return 'night';
      return 'idle';
    };

    /** Deterministic pick that avoids repeating the previous index. */
    const pickQuoteIndex = (length, previous, draw) => {
      if (length <= 0) return -1;
      if (length === 1) return 0;
      const raw = typeof draw === 'number' && Number.isFinite(draw) ? draw : Math.random();
      const index = Math.floor(Math.abs(raw) % 1 * length);
      return index === previous ? (index + 1) % length : index;
    };

    /**
     * Pick a line to show, or null when none should.
     *
     * Callers pass the live state; this stays pure so the choice is testable and
     * the widget only owns the timing.
     */
    const chooseQuote = (band, previousId, draw) => {
      const pool = QUOTES[band] !== undefined ? QUOTES[band] : QUOTES.idle;
      const previousIndex = pool.findIndex((entry) => entry[0] === previousId);
      const index = pickQuoteIndex(pool.length, previousIndex, draw);
      return index < 0 ? null : pool[index][0];
    };

    /**
     * Resolve a quote id into display text for the active locale.
     *
     * The bank is the single source of truth and carries both languages, so the
     * 28 lines are not duplicated into the locale dictionaries (the inline copy
     * also guarantees no raw `quote.*` key can ever reach the screen).
     */
    const quoteText = (id, isEnglish) => {
      const entry = QUOTE_BY_ID[id];
      if (entry === undefined) return '';
      return isEnglish ? entry.en : entry.zh;
    };

    const ACTIVITY_MOOD = {
      running: 'working',
      waiting: 'sad',
      done: 'happy',
      idle: 'ok',
    };

    /** Single source of truth for the pet's expression. */
    const statusMood = (activity, celebrating, petMoodLevel) => {
      if (celebrating) return 'happy';
      if (activity === 'running') return 'working';
      if (activity === 'waiting') return 'sad';
      if (activity === 'done') return 'happy';
      return petMoodLevel;
    };

    const moodText = (mood, t) => {
      if (mood === 'happy') return t('mood.happy');
      if (mood === 'working') return t('mood.working');
      if (mood === 'sad') return t('mood.sad');
      return t('mood.ok');
    };

    const ACTIVITY_LABEL = {
      running: 'status.running',
      waiting: 'status.waiting',
      done: 'status.done',
      idle: 'status.idle',
    };

    /**
     * Read the live activity and decide when the pet should look busy, hungry for
     * attention, or delighted. The transition into `done` is detected with a ref
     * guard rather than a state-update effect, so a single `setState` schedules it
     * and it cannot loop.
     *
     * It also surfaces the active Session row, because that row's
     * `projectionValues.tokenUsage` is where the cost ledger reads exact billing
     * buckets from.
     */
    const useAgentStatus = (useSessionsProp, useSessionStatusProp) => {
      const useSessions = safeHook(useSessionsProp);
      const useSessionStatus = safeHook(useSessionStatusProp);

      // Unconditional calls: a missing prop degrades inside safeHook, so the hook
      // count never depends on which props arrived.
      const list = useSessions(IDENTITY_SELECTOR);
      const statuses = useSessionStatus(IDENTITY_SELECTOR);

      const activity = useMemo(() => deriveActivity(list, statuses), [list, statuses]);
      const row = useMemo(() => activeSessionOf(list), [list]);
      const connected = row !== undefined;

      const [celebrating, setCelebrating] = useState(false);
      const wasBusy = useRef(false);
      const busy = activity === 'running' || activity === 'waiting';
      if (busy && !wasBusy.current) wasBusy.current = true;
      else if (!busy && wasBusy.current) {
        wasBusy.current = false;
        if (activity === 'idle') setCelebrating(true);
      }

      useEffect(() => {
        if (!celebrating) return undefined;
        const id = setTimeout(() => setCelebrating(false), 4000);
        return () => clearTimeout(id);
      }, [celebrating]);

      return {
        activity,
        busy,
        celebrating,
        connected,
        row,
        available: typeof useSessionsProp === 'function' || typeof useSessionStatusProp === 'function',
      };
    };

    /**
     * Fold the active Session's cumulative `tokenUsage` projection into a cost
     * ledger, and report what the latest turn cost.
     *
     * The projection is cumulative for the whole durable log, so a turn's cost is
     * the per-bucket delta since the previous reading. The ledger banks each
     * observed delta into a peak or off-peak bucket exactly once, which keeps a
     * whole-session total across reloads without ever double-charging the history
     * that predates this page.
     */
    const useCostLedger = (row) => {
      const [ledger, setLedger] = useState(loadLedger);

      const sessionId = row === undefined ? undefined : row.id ?? row.sessionId;
      const model = routeModelOf(row) ?? ledger.model ?? 'deepseek-flash';

      // Stable primitives: the catalog row is rebuilt on every projection frame,
      // so depending on the row object (or a freshly built buckets object) would
      // run the fold on every render.
      const raw = row?.projectionValues?.tokenUsage;
      const cacheRead = finiteOr(raw?.cacheReadTokens, 0);
      const cacheWrite = finiteOr(raw?.cacheWriteTokens, 0);
      const uncachedInput = finiteOr(raw?.uncachedInputTokens, 0);
      const output = finiteOr(raw?.outputTokens, 0);
      const hasUsage = raw !== null && typeof raw === 'object';

      useEffect(() => {
        if (sessionId === undefined || !hasUsage) return;
        const buckets = { cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite, uncachedInputTokens: uncachedInput, outputTokens: output };
        setLedger((current) => {
          const outcome = foldLedger(current, sessionId, buckets, model, Date.now());
          // Nothing that the UI reads has moved: return the same reference so
          // React skips the re-render and the write.
          if (
            current.sessionId === outcome.ledger.sessionId &&
            current.peak === outcome.ledger.peak &&
            current.offpeak === outcome.ledger.offpeak &&
            current.unpriced === outcome.ledger.unpriced &&
            bucketsEqual(current.totals, outcome.ledger.totals)
          ) {
            return current;
          }
          saveLedger(outcome.ledger);
          return outcome.ledger;
        });
      }, [sessionId, hasUsage, cacheRead, cacheWrite, uncachedInput, output, model]);

      // A turn boundary is the right place to total things up. The projection
      // grows on EVERY model call inside a turn, so an increment is not a turn:
      // the baseline is pinned when the agent becomes busy, and the running turn
      // total is simply `now - baseline`. `Math.min` keeps that honest even if a
      // projection increment lands in the same commit as the busy edge.
      const baseline = finiteOr(ledger.turnBaseline, 0);
      const total = ledgerTotal(ledger);
      const markTurnStart = useCallback(() => {
        setLedger((current) => {
          const currentTotal = ledgerTotal(current);
          const next = Object.assign({}, current, { turnBaseline: currentTotal });
          saveLedger(next);
          return next;
        });
      }, []);

      const turnCost = Math.max(0, total - baseline);
      return {
        ledger,
        sessionId,
        model,
        currency: RATES.currency,
        total,
        /** Running total of the turn in progress (0 between turns). */
        turnCost,
        totalTokens: cacheRead + cacheWrite + uncachedInput + output,
        priced: ratesFor(model) !== undefined,
        rateRevision: RATES.revision,
        markTurnStart,
      };
    };

    /* ──────────────────────────────── widget ────────────────────────────────── */

    /** Literal fallbacks for computed keys, used when a dictionary lookup misses. */
    const FALLBACK = {
      'mood.happy': 'happy',
      'mood.ok': 'content',
      'mood.sad': 'hungry',
      'mood.working': 'focused',
      'status.idle': 'Idle',
      'status.running': 'Working…',
      'status.waiting': 'Waiting for you',
      'status.done': 'Turn finished',
      'stat.satiety': 'Fullness',
      'stat.mood': 'Mood',
      'stat.energy': 'Energy',
      'stat.bond': 'Fed · petted · played',
      'phase.peak': 'Peak',
      'phase.offpeak': 'Off-peak',
    };

    function PetWidget(props) {
      // Dictionaries carry English keys, so `en` requests English; zh is the
      // usual Harness locale and the bank's native language.
      const locale = props.locale;
      const isEnglishLocale =
        typeof locale === 'string'
          ? locale.startsWith('en')
          : locale !== null && typeof locale === 'object' && typeof locale.id === 'string'
            ? locale.id.startsWith('en')
            : false;
      const rawT = props.t;
      // Computed keys (stat.*, mood.*) must never surface a raw key if a
      // dictionary ever falls behind, so every lookup degrades to a fallback.
      const t = (key, params) => {
        let out;
        try {
          out = rawT(key, params);
        } catch (_error) {
          out = undefined;
        }
        if (typeof out !== 'string' || out === '' || out === key) return FALLBACK[key] !== undefined ? FALLBACK[key] : '';
        return out;
      };
      const [open, setOpen] = useState(false);
      const [closed, setClosed] = useState(false);
      const [cheer, setCheer] = useState(0);
      const [pet, mutate] = usePet();
      const [position, remember] = usePosition();
      const onDrop = useCallback(
        (next) => {
          remember({ left: Math.round(next.left), top: Math.round(next.top) });
        },
        [remember],
      );
      const { drag, onPointerDown, consumeMoved } = useDrag(onDrop);
      // Root-published Session hooks: read the live agent, degrade to idle when absent.
      const agent = useAgentStatus(props.useSessions, props.useSessionStatus);
      // Exact billing buckets from the active Session's `tokenUsage` projection.
      const cost = useCostLedger(agent.row);
      const schedule = useSchedule();
      // A manual override means "today is a Chinese public holiday", so the whole
      // day is off-peak: no peak window can be active and no countdown applies.
      const override = pet.holidayOverride === true;
      const phase = override ? 'offpeak' : schedule.phase;
      const holiday = override || schedule.holiday;
      const petLevel = moodLevel(pet);
      const displayMood = statusMood(agent.activity, agent.celebrating, petLevel);
      const activityText = t(ACTIVITY_LABEL[agent.activity] !== undefined ? ACTIVITY_LABEL[agent.activity] : 'status.idle');
      const showBubble = pet.showStatus !== false && (agent.busy || agent.celebrating);

      /* ── turn total, announced once when the turn ends ──────────────────────
       * The projection grows on every model call inside a turn, so announcing on
       * each increase showed a per-call amount. Instead the baseline is pinned
       * when the agent starts working, and the total is shown at the boundary
       * where the turn actually ends.
       */
      const [spend, setSpend] = useState(null);
      const markTurnStart = cost.markTurnStart;
      const shownTurnTotal = useRef(-1);
      useEffect(() => {
        if (!agent.busy) return;
        markTurnStart();
      }, [agent.busy, markTurnStart]);

      useEffect(() => {
        // The turn is over (and `turnCost` holds its whole total, not a call's).
        if (agent.busy) return;
        if (cost.turnCost <= 0) return undefined;
        if (Math.abs(cost.turnCost - shownTurnTotal.current) < 1e-9) return undefined;
        shownTurnTotal.current = cost.turnCost;
        setSpend(cost.turnCost);
        const id = setTimeout(() => setSpend(null), 9000);
        return () => clearTimeout(id);
      }, [agent.busy, cost.turnCost]);
      // Last-resort guards: a value that somehow escaped sanitizePet must still
      // never render the literal text "undefined" in the widget.
      const displayName = typeof pet.name === 'string' && pet.name.trim() !== '' ? pet.name : '小鲸鱼';
      const bond = [pet.fed, pet.patted, pet.played].map((n) => (Number.isFinite(n) ? n : 0));

      // one clock for the countdown and the accumulated decay
      const [now, setNow] = useState(() => Date.now());
      useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), TICK_MS);
        return () => clearInterval(id);
      }, []);

      // decay accrued while this widget is mounted
      const lastDecay = useRef(Date.now());
      useEffect(() => {
        const elapsed = now - lastDecay.current;
        if (elapsed < 60000) return;
        lastDecay.current = now;
        mutate((current) => ({
          satiety: clamp(current.satiety - (elapsed / 60000) * 0.5),
          mood: clamp(current.mood - (elapsed / 60000) * 0.25),
          energy: clamp(current.energy + (elapsed / 60000) * 0.25),
        }));
      }, [now, mutate]);

      const flash = useCallback(() => setCheer((value) => value + 1), []);
      useEffect(() => {
        if (cheer === 0) return undefined;
        const id = setTimeout(() => setCheer(0), 900);
        return () => clearTimeout(id);
      }, [cheer]);

      const feed = useCallback(() => {
        mutate((current) => ({
          satiety: clamp(current.satiety + 18),
          mood: clamp(current.mood + 4),
          energy: clamp(current.energy - 3),
          fed: current.fed + 1,
        }));
        flash();
      }, [mutate, flash]);

      const pat = useCallback(() => {
        mutate((current) => ({
          mood: clamp(current.mood + 12),
          satiety: clamp(current.satiety - 1),
          patted: current.patted + 1,
        }));
        flash();
      }, [mutate, flash]);

      const play = useCallback(() => {
        mutate((current) => ({
          mood: clamp(current.mood + 9),
          energy: clamp(current.energy - 12),
          satiety: clamp(current.satiety - 5),
          played: current.played + 1,
        }));
        flash();
      }, [mutate, flash]);

      const rest = useCallback(() => {
        mutate((current) => ({ energy: clamp(current.energy + 20), mood: clamp(current.mood + 3) }));
      }, [mutate]);

      const toggleHoliday = useCallback(() => {
        mutate((current) => ({ holidayOverride: !(current.holidayOverride === true) }));
      }, [mutate]);

      const countdown = useMemo(() => {
        if (override) return null;
        if (schedule.nextAt === null) return null;
        return formatDuration(schedule.nextAt - now);
      }, [schedule.nextAt, now, override]);

      const nextText = useMemo(() => {
        if (schedule.nextAt === null) return '—';
        return beijingDisplay(schedule.nextAt);
      }, [schedule.nextAt]);

      /* ── occasional one-liner: a memey or encouraging line from the pet ──────
       * Rules that keep it pleasant rather than noisy:
       *   - only while the agent is NOT busy (never interrupt real work);
       *   - the user picks the frequency (关 / 少 / 中 / 多);
       *   - a finished turn gets a line right away, the idle timer backs off;
       *   - a cost announcement always wins the bubble slot.
       */
      const [quote, setQuote] = useState(null);
      const quoteRate = quoteRateFromPet(pet);
      const rate = QUOTE_RATES[quoteRate];
      const quoteEnabled = quoteRate !== 'off';
      const lastQuoteAt = useRef(0);
      const lastQuoteId = useRef(null);
      const lastQuoteBand = useRef(null);
      const hourRef = useRef(new Date().getHours());
      hourRef.current = new Date().getHours();

      const announceQuote = useCallback(() => {
        const band = quoteBand(agent.activity, agent.celebrating, hourRef.current);
        const id = chooseQuote(band, lastQuoteBand.current === band ? lastQuoteId.current : null, Math.random());
        if (id === null) return;
        lastQuoteAt.current = Date.now();
        lastQuoteId.current = id;
        lastQuoteBand.current = band;
        setQuote(id);
      }, [agent.activity, agent.celebrating]);

      // A finished turn earns a line immediately.
      useEffect(() => {
        if (!quoteEnabled) return;
        if (agent.activity !== 'done' && !agent.celebrating) return;
        announceQuote();
      }, [quoteEnabled, agent.activity, agent.celebrating, announceQuote]);

      // Otherwise, an idle pet speaks up at the chosen rate.
      useEffect(() => {
        if (!quoteEnabled || rate.gapMs <= 0 || rate.pollMs <= 0) {
          setQuote(null);
          return undefined;
        }
        const id = setInterval(() => {
          if (agent.busy) return;
          if (Date.now() - lastQuoteAt.current < rate.gapMs) return;
          announceQuote();
        }, rate.pollMs);
        return () => clearInterval(id);
      }, [quoteEnabled, rate.gapMs, rate.pollMs, agent.busy, announceQuote]);

      // The line fades on its own.
      useEffect(() => {
        if (quote === null) return undefined;
        const id = setTimeout(() => setQuote(null), QUOTE_SHOW_MS);
        return () => clearTimeout(id);
      }, [quote]);

      const setQuoteRate = useCallback(
        (next) => {
          const value = quoteRateOf(next);
          mutate(() => ({ quoteRate: value, quotesEnabled: value !== 'off' }));
        },
        [mutate],
      );

      // Display-name editing. The draft only persists on submit, so abandoning a
      // rename cannot leave a half-typed name in storage.
      const [nameDraft, setNameDraft] = useState(pet.name);
      const nameSubmit = useCallback(() => {
        const next = cleanPetName(nameDraft);
        if (next === '') return;
        mutate(() => ({ name: next }));
      }, [nameDraft, mutate]);
      const nameReset = useCallback(() => {
        mutate(() => ({ name: DEFAULT_PET_NAME }));
      }, [mutate]);
      const nameResetDraft = useCallback(() => setNameDraft(pet.name), [pet.name]);

      // Live drag wins, then the remembered spot, then the CSS bottom-right default.
      const spot = drag !== null ? drag : position;
      const anchorStyle =
        spot === null
          ? null
          : {
              right: 'auto',
              bottom: 'auto',
              left: `${Math.round(spot.left)}px`,
              top: `${Math.round(spot.top)}px`,
            };

      // When the pet has moved off the corner, the panel must follow the pet
      // rather than stay pinned to the viewport corner.
      const panelStyle = useMemo(() => {
        if (position === null) return null;
        const viewport = typeof window === 'undefined' ? 900 : window.innerHeight;
        const left = `${Math.round(position.left)}px`;
        if (position.top <= viewport / 2) {
          return { position: 'fixed', right: 'auto', left, top: `${Math.round(position.top + 132)}px` };
        }
        return {
          position: 'fixed',
          right: 'auto',
          left,
          top: 'auto',
          bottom: `${Math.round(Math.max(12, viewport - position.top + 12))}px`,
        };
      }, [position]);

      if (closed) {
        return h(
          'div',
          {
            className: 'dshPet_root',
            'data-dsh-pet': true,
            'data-phase': phase,
            'data-closed': true,
            'data-dragging': drag !== null ? 'true' : 'false',
            style: anchorStyle,
          },
          h(
            'button',
            {
              type: 'button',
              className: 'dshPet_offer',
              // The paw is a drag handle too, so hiding the pet never strands it.
              onPointerDown,
              onClick: () => {
                if (consumeMoved()) return;
                setClosed(false);
              },
              title: t('reopen'),
              'aria-label': t('reopen'),
            },
            '🐾',
          ),
          h('style', { 'data-plugin-css': STYLE_ID }, CSS),
        );
      }

      const phaseLabel = phase === 'peak' ? t('phase.peak') : t('phase.offpeak');
      const catLabel = `${displayName} ${moodText(displayMood, t)}`;

      return h(
        'div',
        {
          className: 'dshPet_root',
          'data-dsh-pet': true,
          'data-phase': phase,
          'data-holiday': holiday ? 'true' : 'false',
          'data-dragging': drag !== null ? 'true' : 'false',
          style: anchorStyle,
        },
        h('style', { 'data-plugin-css': STYLE_ID }, CSS),

        open
          ? h(
              'section',
              { className: 'dshPet_panel', role: 'dialog', 'aria-label': t('panel.title'), style: panelStyle },
              h(
                'div',
                { className: 'dshPet_head' },
                h('span', { className: 'dshPet_title' }, t('panel.title')),
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dshPet_close',
                    'aria-label': t('close'),
                    title: t('close'),
                    onClick: () => setOpen(false),
                  },
                  '✕',
                ),
              ),
              // ── pricing section: one headline row, one clause, one footnote ──
              h(
                'div',
                { className: 'dshPet_section' },
                h(
                  'div',
                  { className: 'dshPet_headline' },
                  h('span', { className: 'dshPet_dot', 'data-phase': phase }),
                  h('b', { className: 'dshPet_phaseName' }, phaseLabel),
                  schedule.nextAt !== null
                    ? h('span', { className: 'dshPet_headlineCount' }, t('pricing.until', { time: nextText }))
                    : null,
                ),
                countdown !== null ? h('div', { className: 'dshPet_countdown' }, countdown) : null,
                h(
                  'div',
                  { className: 'dshPet_kv' },
                  h('span', null, t('pricing.clock')),
                  h(
                    'b',
                    null,
                    t('pricing.clockValue', { bj: schedule.beijingText, local: schedule.localText, utc: schedule.isoText }),
                  ),
                ),
                holiday ? h('div', { className: 'dshPet_note' }, t('pricing.whyShort')) : null,
                h(
                  'div',
                  { className: 'dshPet_note' },
                  t('pricing.ruleShort', { discount: String(SCHEDULE.discount) }),
                ),
                h(
                  'label',
                  { className: 'dshPet_holiday' },
                  h('input', {
                    type: 'checkbox',
                    checked: override,
                    onChange: toggleHoliday,
                  }),
                  h('span', null, t('pricing.holidayToggleShort')),
                ),
              ),
              // ── cost section: exact buckets folded into money ──
              h(
                'div',
                { className: 'dshPet_section' },
                h(
                  'div',
                  { className: 'dshPet_headline' },
                  h('b', { className: 'dshPet_phaseName' }, t('cost.total')),
                  h(
                    'span',
                    { className: 'dshPet_headlineCount' },
                    cost.priced ? formatCost(cost.total, cost.currency) : t('cost.unpriced'),
                  ),
                ),
                h(
                  'div',
                  { className: 'dshPet_kv' },
                  h('span', null, agent.busy ? t('cost.turnRunning') : t('cost.turnTotal')),
                  h('b', null, formatCost(cost.turnCost, cost.currency)),
                ),
                h(
                  'div',
                  { className: 'dshPet_kv' },
                  h('span', null, t('cost.split')),
                  h(
                    'b',
                    null,
                    t('cost.splitValue', {
                      peak: formatCost(cost.ledger.peak, cost.currency),
                      offpeak: formatCost(cost.ledger.offpeak, cost.currency),
                    }),
                  ),
                ),
                h(
                  'div',
                  { className: 'dshPet_kv' },
                  h('span', null, t('cost.tokens')),
                  h('b', null, cost.totalTokens.toLocaleString('en-US')),
                ),
                h(
                  'div',
                  { className: 'dshPet_note' },
                  t('cost.basis', { model: cost.model, revision: cost.rateRevision }),
                ),
              ),
              // ── pet section
              h(
                'div',
                { className: 'dshPet_section' },
                // Rename: the display name only. The package/slot ids stay put.
                h(
                  'div',
                  { className: 'dshPet_rowLabel' },
                  h('span', null, t('name.label')),
                  h(
                    'span',
                    { className: 'dshPet_nameEdit' },
                    h('input', {
                      className: 'dshPet_nameInput',
                      type: 'text',
                      value: nameDraft,
                      maxLength: PET_NAME_MAX,
                      placeholder: DEFAULT_PET_NAME,
                      'aria-label': t('name.label'),
                      onChange: (event) => setNameDraft(cleanPetName(event.target.value)),
                      onKeyDown: (event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          nameSubmit();
                        }
                        if (event.key === 'Escape') {
                          event.preventDefault();
                          nameResetDraft();
                        }
                      },
                    }),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'dshPet_nameButton',
                        disabled: nameDraft.trim() === '' || nameDraft === pet.name,
                        onClick: nameSubmit,
                        title: t('name.save'),
                        'aria-label': t('name.save'),
                      },
                      '✓',
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'dshPet_nameButton',
                        onClick: nameReset,
                        title: t('name.reset'),
                        'aria-label': t('name.reset'),
                      },
                      '↺',
                    ),
                  ),
                ),
                STATS.map((stat) =>
                  h(
                    'div',
                    { key: stat.key },
                    h(
                      'div',
                      { className: 'dshPet_rowLabel' },
                      h('span', null, t(stat.labelKey)),
                      h('span', { className: 'dshPet_statValue' }, `${Math.round(pet[stat.key])}`),
                    ),
                    h(
                      'div',
                      { className: 'dshPet_bar' },
                      h('div', {
                        className: 'dshPet_barFill',
                        style: { width: `${Math.round(pet[stat.key])}%`, background: `var(${stat.token})` },
                      }),
                    ),
                  ),
                ),
                h(
                  'div',
                  { className: 'dshPet_kv' },
                  h('span', null, t('stat.bond')),
                  h('b', null, `${bond[0]} · ${bond[1]} · ${bond[2]}`),
                ),
                h(
                  'div',
                  { className: 'dshPet_kv' },
                  h('span', null, t('status.now')),
                  h(
                    'b',
                    null,
                    !agent.available ? t('status.unavailable') : agent.connected ? activityText : t('status.noSession'),
                  ),
                ),
                h(
                  'label',
                  { className: 'dshPet_holiday' },
                  h('input', {
                    type: 'checkbox',
                    checked: pet.showStatus !== false,
                    onChange: () => mutate((current) => ({ showStatus: current.showStatus === false })),
                  }),
                  h('span', null, t('status.bubbleToggle')),
                ),
                h(
                  'div',
                  { className: 'dshPet_rowLabel' },
                  h('span', null, t('quote.freq')),
                  h(
                    'span',
                    { className: 'dshPet_rateGroup', role: 'radiogroup', 'aria-label': t('quote.freq') },
                    QUOTE_RATE_ORDER.map((option) =>
                      h(
                        'button',
                        {
                          key: option,
                          type: 'button',
                          role: 'radio',
                          'aria-checked': quoteRate === option,
                          className: 'dshPet_rate',
                          'data-selected': quoteRate === option ? 'true' : 'false',
                          onClick: () => setQuoteRate(option),
                        },
                        t(QUOTE_RATES[option].key),
                      ),
                    ),
                  ),
                ),
              ),
              h(
                'div',
                { className: 'dshPet_actions' },
                h('button', { type: 'button', className: 'dshPet_action', onClick: feed }, t('action.feed')),
                h('button', { type: 'button', className: 'dshPet_action', onClick: pat }, t('action.pat')),
                h('button', { type: 'button', className: 'dshPet_action', onClick: play }, t('action.play')),
                h('button', { type: 'button', className: 'dshPet_action', onClick: rest }, t('action.rest')),
              ),
              h(
                'div',
                { className: 'dshPet_actions' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dshPet_action',
                    disabled: position === null,
                    onClick: () => remember(null),
                  },
                  t('action.resetPosition'),
                ),
                h(
                  'button',
                  { type: 'button', className: 'dshPet_action', onClick: () => setClosed(true) },
                  t('action.hide'),
                ),
              ),
              h('div', { className: 'dshPet_note' }, t('pricing.source')),
            )
          : null,

        h(
          'div',
          { className: 'dshPet_compact' },
          spend !== null && spend > 0
            ? h(
                'div',
                { className: 'dshPet_spend', role: 'status', 'aria-live': 'polite' },
                h('span', { className: 'dshPet_spendLabel' }, t('cost.turnTotal')),
                h('b', { className: 'dshPet_spendValue' }, formatCost(spend, cost.currency)),
              )
            : null,
          showBubble
            ? h(
                'div',
                { className: 'dshPet_bubble', 'data-activity': agent.activity, 'aria-live': 'polite' },
                h('span', { className: 'dshPet_bubbleDot' }),
                h('span', null, activityText),
              )
            : null,
          // The one-liner only gets the slot when nothing more important is on
          // screen: a cost announcement or a live status always wins.
          quote !== null && spend === null && !showBubble
            ? h(
                'div',
                { className: 'dshPet_quote', 'data-quote': lastQuoteBand.current, 'aria-live': 'polite' },
                quoteText(quote, isEnglishLocale),
              )
            : null,
          h(
            'button',
            {
              type: 'button',
              className: 'dshPet_pet',
              onPointerDown,
              onClick: () => {
                if (consumeMoved()) return;
                pat();
              },
              title: t('pet.hint'),
              'aria-label': t('pet.hint'),
            },
            h(Cat, { size: 92, mood: displayMood, cheer: cheer > 0, label: catLabel }),
          ),
          h('span', { className: 'dshPet_name' }, `${displayName} · ${moodText(displayMood, t)}`),
        ),

        h(
          'button',
          {
            type: 'button',
            className: 'dshPet_badge',
            onClick: () => setOpen((value) => !value),
            'aria-expanded': open,
            title: t('badge.hint'),
          },
          h('span', { className: 'dshPet_dot', 'data-phase': phase, 'data-pulse': phase === 'offpeak' ? 'true' : 'false' }),
          h('span', null, phaseLabel),
          countdown !== null ? h('span', { className: 'dshPet_count' }, countdown) : null,
        ),
      );
    }

    /* ──────────────────────────────── locales ───────────────────────────────── */

    const en = {
      'panel.title': 'DeepSeek Pet',
      close: 'Collapse',
      reopen: 'Show the pet',
      'badge.hint': 'Peak / off-peak now — click for details',
      'pet.hint': 'Pet the cat (drag to move)',
      'action.hide': 'Hide the pet',
      'pricing.now': 'Right now',
      'pricing.until': 'until {time}',
      'pricing.clock': 'Clock',
      'pricing.clockValue': '{bj} BJT · {local} local · {utc} UTC',
      'pricing.whyShort': 'Holiday today: off-peak all day.',
      'pricing.ruleShort': 'Peak: Mon-Fri 09:00-12:00, 14:00-18:00 Beijing (excl. holidays); everything else is half price ({discount}% off).',
      'pricing.holidayToggleShort': 'Force off-peak (holiday today)',
      'pricing.source': 'Rates: api-docs.deepseek.com · quick_start/pricing',
      'cost.total': 'Session cost',
      'cost.turnTotal': 'Last turn',
      'cost.turnRunning': 'This turn so far',
      'cost.split': 'Peak / off-peak',
      'cost.splitValue': '{peak} / {offpeak}',
      'cost.tokens': 'Tokens (session)',
      'cost.basis': 'Priced from the tokenUsage projection with {model} rates, verified {revision}. Off-peak turns are billed at half price.',
      'cost.unpriced': 'no rate card',
      'phase.peak': 'Peak',
      'phase.offpeak': 'Off-peak',
      'stat.satiety': 'Fullness',
      'stat.mood': 'Mood',
      'stat.energy': 'Energy',
      'stat.bond': 'Fed · petted · played',
      'status.now': 'Agent status',
      'status.bubbleToggle': 'Show the agent-status bubble',
      'quote.freq': 'How often',
      'quote.freq.off': 'Off',
      'quote.freq.rare': 'Rare',
      'quote.freq.normal': 'Normal',
      'quote.freq.chatty': 'Chatty',
      'name.label': 'Name',
      'name.save': 'Save the name',
      'name.reset': 'Reset to the default name',
      'status.unavailable': 'not available',
      'status.noSession': 'no session',
      'status.idle': 'Idle',
      'status.running': 'Working…',
      'status.waiting': 'Waiting for you',
      'status.done': 'Turn finished',
      'mood.working': 'focused',
      'mood.happy': 'happy',
      'mood.ok': 'content',
      'mood.sad': 'hungry',
      'action.feed': 'Feed',
      'action.pat': 'Pet',
      'action.play': 'Play',
      'action.rest': 'Rest',
      'action.resetPosition': 'Reset position',
    };

    const zh = {
      'panel.title': 'DeepSeek 电子宠物',
      close: '收起',
      reopen: '显示宠物',
      'badge.hint': '当前是高峰期还是低谷期 — 点击查看详情',
      'pet.hint': '摸摸小猫（可拖动位置）',
      'pricing.now': '当前时段',
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
      'cost.basis': '按 tokenUsage 投影的精确用量 × {model} 价目计算，价目核对日期 {revision}；低谷期的轮次按半价计。',
      'cost.unpriced': '无价目',
      'phase.peak': '高峰期',
      'phase.offpeak': '低谷期',
      'stat.satiety': '饱食度',
      'stat.mood': '心情',
      'stat.energy': '精力',
      'stat.bond': '喂食 · 摸头 · 玩耍',
      'status.now': '助手状态',
      'status.bubbleToggle': '显示助手状态气泡',
      'quote.freq': '台词频率',
      'quote.freq.off': '关',
      'quote.freq.rare': '少',
      'quote.freq.normal': '中',
      'quote.freq.chatty': '多',
      'name.label': '名字',
      'name.save': '保存名字',
      'name.reset': '恢复默认名字',
      'status.unavailable': '当前不可用',
      'status.noSession': '暂无会话',
      'status.idle': '空闲中',
      'status.running': '正在工作…',
      'status.waiting': '等待你操作',
      'status.done': '本轮完成',
      'mood.working': '专注中',
      'mood.happy': '开心',
      'mood.ok': '还不错',
      'mood.sad': '肚子饿了',
      'action.feed': '喂食',
      'action.pat': '摸头',
      'action.play': '玩耍',
      'action.rest': '睡觉',
      'action.resetPosition': '复位位置',
      'action.hide': '隐藏宠物',
    };

    /* ──────────────────────────────── plugin ────────────────────────────────── */

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        if (ctx.locale && typeof ctx.locale.register === 'function') {
          ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'dsh-pet: dictionaries');
        }

        // Keep the pointer over the frame's bottom-right: `shell.overlay` is a
        // click-through layer, and this entry opts back into pointer events.
        // `ctx.slots.inject` ties the registration to the slot declaration and
        // disposes it when the owning entry collapses.
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            {
              name: 'shell.overlay',
              id: 'pet.bottom-right',
              order: 60,
              locale: NS,
            },
            PetWidget,
          ),
        );
      },
    };
  },
});
