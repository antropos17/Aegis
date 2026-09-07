/**
 * sequence-engine — the `temporal_ordered` state machine, driven by an INJECTED clock.
 *
 * The seam is `init({ now })`, not `vi.useFakeTimers()`: the engine reads the clock only through
 * that function and schedules nothing, so a fake timer would advance a mechanism this module does
 * not have while leaving `observedAt` untouched. Every case below sets `clock` explicitly, which
 * is what makes the maxspan boundary an assertion rather than a race.
 *
 * The RULES are hand-built here and the CARRIERS are real: each event goes through the real
 * `normalizeToEcs` projection inside `ingest`, so the category gate and the matchers see exactly
 * what production would hand them. One case at the end drives a loader-compiled rule instead,
 * which is what pins that the shape `sequence-rule-loader` produces is the shape this engine
 * consumes.
 *
 * `logger` is pulled in through `createRequire` — the same native module instance the CJS module
 * under test requires. An ESM `import` of the same path yields a DIFFERENT object and a spy on it
 * never fires (the convention `sequence-rule-loader.test.js` records).
 *
 * Every counter asserted below is produced by the path under test (ai-mistakes #21): no case
 * asserts a zero that the engine could not have moved anyway, and each counter is read from
 * `getStats()` after the exact transition that owns it. The caps are lowered through the `init`
 * options in every bounded-memory case but the two that pin the defaults, so eviction is reached
 * with four instances rather than a hundred and twenty-nine.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
import engine from '../../src/main/sequence-engine.js';
import loader from '../../src/main/sequence-rule-loader.js';

const require_ = createRequire(import.meta.url);
const logger = require_('../../src/main/logger.js');

/** The window every hand-built rule below uses unless it says otherwise. @type {number} */
const SPAN = 60000;

/** The `recentlyExited` TTL — one minute on the injected clock. @type {number} */
const EXIT_TTL = 60000;

/** The default caps the module declares; pinned by the two default-cap cases only. */
const DEFAULT_PER_RULE = 128;
const DEFAULT_TOTAL = 1024;

/** @type {number} */
let clock = 0;

/** @type {Array<Record<string, any>>} */
let detections = [];

/** @type {import('vitest').MockInstance} */
let warnSpy;
/** @type {import('vitest').MockInstance} */
let infoSpy;

const now = () => clock;

/** @param {number} t @returns {void} */
function at(t) {
  clock = t;
}

/**
 * @param {string} name
 * @param {string} category
 * @param {(doc: Record<string, any>) => boolean} matcher
 * @returns {{name: string, category: string, matcher: (doc: Record<string, any>) => boolean}}
 */
function step(name, category, matcher) {
  return { name, category, matcher };
}

/**
 * @param {string} id
 * @param {Array<{name: string, category: string, matcher: Function}>} steps
 * @param {number} [timespanMs]
 * @returns {Record<string, unknown>}
 */
function rule(id, steps, timespanMs = SPAN) {
  return { id, title: `${id} — under test`, level: 'high', timespanMs, steps };
}

/** `event.action` is what the ECS projection carries for both file and process carriers. */
const actionIs = (/** @type {string} */ want) => (doc) => doc.event.action === want;
const portIs = (/** @type {number} */ want) => (doc) =>
  doc.destination !== undefined && doc.destination.port === want;

/** A file step matching an `accessed` event, the canonical first step. */
const stepA = () => step('a_read', 'file', actionIs('file-accessed'));
/** A network step matching an outbound 443, the canonical second step. */
const stepB = () => step('b_conn', 'network', portIs(443));
/** A second FILE step, for the three-step rules. */
const stepC = () => step('c_write', 'file', actionIs('file-modified'));
/** A process step on the exit side of a session record. */
const stepExit = () => step('agent_out', 'process', actionIs('agent-exit'));
/** A process step on the enter side of a session record. */
const stepEnter = () => step('agent_in', 'process', actionIs('agent-enter'));

const CONFIRMED_FILE = { status: 'confirmed', evidence: ['handle-scan-pid'] };
const CONFIRMED_NET = { status: 'confirmed', evidence: ['os-tcp-owner-pid'] };
const INFERRED_FILE = { status: 'inferred', evidence: ['cwd-containment'] };

/**
 * A `FileEvent` as file-watcher stamps it: attributed, with the pid the attribution resolved.
 * @param {string|null} instanceId
 * @param {string} [action]
 * @param {string} [file]
 * @param {Record<string, unknown>} [extra] - overrides, `attribution: undefined` to drop it.
 * @returns {Record<string, unknown>}
 */
function fileEvent(instanceId, action = 'accessed', file = 'C:\\work\\creds.txt', extra = {}) {
  return {
    instanceId,
    file,
    action,
    timestamp: 1_700_000_000_000,
    agent: 'Claude Code',
    pid: 4242,
    attribution: CONFIRMED_FILE,
    ...extra,
  };
}

/**
 * A `NetworkConnection` as the scan hands it over. The Event Schema v1 type carries NO
 * `attribution` field (`src/shared/types/events.ts` `NetworkConnection`), so the default here is
 * the production shape — a neutral step; the attribution cases pass one in explicitly.
 * @param {string|null} instanceId
 * @param {number} [remotePort]
 * @param {Record<string, unknown>} [extra]
 * @returns {Record<string, unknown>}
 */
function netEvent(instanceId, remotePort = 443, extra = {}) {
  return {
    instanceId,
    remoteIp: '203.0.113.5',
    remotePort,
    agent: 'Claude Code',
    pid: 4242,
    ...extra,
  };
}

/**
 * A session record on its ENTER side — `reconcile()` withholds `lastSeen` on an enter.
 * @param {string|null} instanceId
 * @returns {Record<string, unknown>}
 */
function enterEvent(instanceId) {
  return {
    instanceId,
    pid: 4242,
    agent: 'Claude Code',
    process: 'node.exe',
    firstSeen: 1_700_000_000_000,
  };
}

/**
 * A session record on its EXIT side — `lastSeen` present is what the normalizer reads as exit.
 * @param {string|null} instanceId
 * @returns {Record<string, unknown>}
 */
function exitEvent(instanceId) {
  return { ...enterEvent(instanceId), lastSeen: 1_700_000_100_000 };
}

/**
 * Installs a ruleset on a zeroed engine. Every test starts from here, so no case can inherit a
 * state or a counter from the one before it.
 * @param {Array<Record<string, unknown>>} rules
 * @param {{maxOpenPerRule?: number, maxOpenTotal?: number}} [caps]
 * @returns {void}
 */
function start(rules, caps = {}) {
  engine.init({ rules, onDetection: (d) => detections.push(d), now, ...caps });
}

/** @param {Record<string, any>} d @returns {number} the window the detection spanned. */
const elapsedOf = (d) => d.steps[d.steps.length - 1].at - d.steps[0].at;

beforeEach(() => {
  clock = 0;
  detections = [];
  warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
  infoSpy = vi.spyOn(logger, 'info').mockImplementation(() => {});
});

afterEach(() => {
  // The createRequire instance is shared by every suite in this worker; an unrestored spy would
  // leak into whichever file runs next (ai-mistakes #26).
  vi.restoreAllMocks();
  engine.init({ rules: [] });
});

describe('sequence-engine — order', () => {
  it('A then B fires, and the detection carries the rule, the key, the actor and both steps', () => {
    start([rule('SEQ001', [stepA(), stepB()])]);

    at(1000);
    engine.ingest(fileEvent('4242:900'));
    at(31000);
    engine.ingest(netEvent('4242:900', 443, { attribution: CONFIRMED_NET }));

    expect(detections).toHaveLength(1);
    expect(detections[0]).toEqual({
      ruleId: 'SEQ001',
      title: 'SEQ001 — under test',
      level: 'high',
      timespan: SPAN,
      instanceId: '4242:900',
      agent: 'Claude Code',
      pid: 4242,
      attribution: { status: 'confirmed', evidence: ['handle-scan-pid', 'os-tcp-owner-pid'] },
      steps: [
        {
          step: 'a_read',
          at: 1000,
          action: 'file-accessed',
          path: 'C:\\work\\creds.txt',
          attribution: { status: 'confirmed', evidence: ['handle-scan-pid'] },
        },
        {
          step: 'b_conn',
          at: 31000,
          action: 'network-connection',
          attribution: { status: 'confirmed', evidence: ['os-tcp-owner-pid'] },
        },
      ],
    });
    expect(engine.getStats()).toMatchObject({ opened: 1, completed: 1, openNow: 0 });
  });

  it('B then A does not fire — the second step cannot open a sequence', () => {
    start([rule('SEQ001', [stepA(), stepB()])]);

    at(1000);
    engine.ingest(netEvent('i1'));
    at(2000);
    engine.ingest(fileEvent('i1'));

    expect(detections).toHaveLength(0);
    expect(engine.getStats()).toMatchObject({ opened: 1, completed: 0, openNow: 1 });
  });

  it('A X B fires — an event matching no step leaves the sequence exactly where it was', () => {
    start([rule('SEQ001', [stepA(), stepB()])]);

    at(1000);
    engine.ingest(fileEvent('i1'));
    at(2000);
    engine.ingest(fileEvent('i1', 'modified')); // X: matches neither step of this rule
    at(3000);
    engine.ingest(netEvent('i1'));

    expect(detections).toHaveLength(1);
    // X is counted nowhere, and it did not slide the window: step 0 is still A's.
    expect(detections[0].steps[0].at).toBe(1000);
    expect(engine.getStats()).toMatchObject({ opened: 1, completed: 1, slid: 0 });
  });

  it('a rule [A, A] needs two events — one event never satisfies two steps', () => {
    start([rule('SEQ002', [stepA(), stepA()])]);

    at(1000);
    engine.ingest(fileEvent('i1'));
    expect(detections).toHaveLength(0);

    at(2000);
    engine.ingest(fileEvent('i1'));
    expect(detections).toHaveLength(1);
    expect(detections[0].steps.map((s) => s.at)).toEqual([1000, 2000]);
  });

  it('advance beats open — the second A completes [A, A] instead of opening a new sequence', () => {
    start([rule('SEQ002', [stepA(), stepA()])]);

    at(1000);
    engine.ingest(fileEvent('i1'));
    at(2000);
    engine.ingest(fileEvent('i1'));

    // opened stays at 1: had `open` won, this would read 2 and the sequence would still be open.
    expect(engine.getStats()).toMatchObject({ opened: 1, completed: 1, slid: 0, openNow: 0 });
  });

  it('completion does not re-open on the event that completed it, and a later A opens again', () => {
    start([rule('SEQ002', [stepA(), stepA()])]);

    at(1000);
    engine.ingest(fileEvent('i1'));
    at(2000);
    engine.ingest(fileEvent('i1'));
    expect(engine.getStats()).toMatchObject({ opened: 1, openNow: 0 });

    at(3000);
    engine.ingest(fileEvent('i1'));
    expect(engine.getStats()).toMatchObject({ opened: 2, completed: 1, openNow: 1 });
    expect(detections).toHaveLength(1);
  });

  it('one event is offered to every rule — two rules on the same step 0 both open', () => {
    start([rule('SEQ001', [stepA(), stepB()]), rule('SEQ003', [stepA(), stepC()])]);

    at(1000);
    engine.ingest(fileEvent('i1'));

    expect(engine.getStats()).toMatchObject({ opened: 2, openNow: 2 });
  });

  it('a step matches only its own category — a matcher that accepts everything still does not', () => {
    // The matcher answers true for any document; the step is `network` and the carrier projects
    // `['file']`, so the category gate alone decides this case.
    start([rule('SEQ004', [step('any_net', 'network', () => true), stepC()])]);

    at(1000);
    engine.ingest(fileEvent('i1'));

    expect(engine.getStats()).toMatchObject({ opened: 0, openNow: 0 });
  });

  it('a projection with no ECS category matches no step at all', () => {
    // `permission-deny` is outside the closed audit union, so `normalizeToEcs` emits an `event`
    // branch with an `action` and NO `category` — the case the module header names.
    start([rule('SEQ004', [step('any_step', 'file', () => true), stepB()])]);

    at(1000);
    engine.ingest({ instanceId: 'i1', type: 'permission-deny', timestamp: '2026-08-24T00:00:00Z' });

    expect(engine.getStats()).toMatchObject({ opened: 0, ingestErrors: 0 });
  });
});

describe('sequence-engine — the maxspan boundary', () => {
  it('exactly timespan fires — the boundary is inclusive', () => {
    start([rule('SEQ001', [stepA(), stepB()])]);

    at(1000);
    engine.ingest(fileEvent('i1'));
    at(1000 + SPAN);
    engine.ingest(netEvent('i1'));

    expect(detections).toHaveLength(1);
    expect(elapsedOf(detections[0])).toBe(SPAN);
    expect(engine.getStats()).toMatchObject({ completed: 1, expired: 0 });
  });

  it('timespan + 1 ms expires, and that same B opens nothing', () => {
    start([rule('SEQ001', [stepA(), stepB()])]);

    at(1000);
    engine.ingest(fileEvent('i1'));
    at(1000 + SPAN + 1);
    engine.ingest(netEvent('i1'));

    expect(detections).toHaveLength(0);
    // `opened` stays 1: B is not step 0, so the discarded state is not replaced by a new one.
    expect(engine.getStats()).toMatchObject({ opened: 1, expired: 1, completed: 0, openNow: 0 });
  });

  it('a new A after the expiry opens a fresh sequence, and it completes', () => {
    start([rule('SEQ001', [stepA(), stepB()])]);

    at(1000);
    engine.ingest(fileEvent('i1'));
    at(1000 + SPAN + 1);
    engine.ingest(fileEvent('i1')); // expires the first state, then opens on step 0
    at(1000 + SPAN + 2);
    engine.ingest(netEvent('i1'));

    expect(detections).toHaveLength(1);
    expect(detections[0].steps[0].at).toBe(1000 + SPAN + 1);
    expect(engine.getStats()).toMatchObject({ opened: 2, expired: 1, completed: 1 });
  });

  it('a clock that runs backwards clamps the elapsed to 0 — there is no early expiry', () => {
    start([rule('SEQ001', [stepA(), stepB()])]);

    at(500000);
    engine.ingest(fileEvent('i1'));
    at(400000); // the jump: `observedAt − openedAt` is −100000
    engine.ingest(netEvent('i1'));

    expect(detections).toHaveLength(1);
    // The steps keep the clock readings as they were; the clamp lives in the window check.
    expect(detections[0].steps.map((s) => s.at)).toEqual([500000, 400000]);
    expect(engine.getStats()).toMatchObject({ expired: 0, completed: 1 });
  });

  it('sweep removes an idle expired state, and leaves a live one alone', () => {
    start([rule('SEQ001', [stepA(), stepB()])]);

    at(1000);
    engine.ingest(fileEvent('i1'));

    at(1000 + SPAN);
    engine.sweep();
    expect(engine.getStats()).toMatchObject({ expired: 0, openNow: 1 });

    at(1000 + SPAN + 1);
    engine.sweep();
    expect(engine.getStats()).toMatchObject({ expired: 1, openNow: 0 });
  });

  it('sweep is a no-op when nothing is open', () => {
    start([rule('SEQ001', [stepA(), stepB()])]);

    at(999999);
    engine.sweep();

    expect(engine.getStats()).toMatchObject({ expired: 0, openNow: 0 });
  });
});

describe('sequence-engine — group-by isolation', () => {
  it('A(i1) A(i2) B(i1) B(i2) gives two detections with separate steps', () => {
    start([rule('SEQ001', [stepA(), stepB()])]);

    at(1000);
    engine.ingest(fileEvent('i1', 'accessed', 'C:\\one\\creds.txt'));
    at(2000);
    engine.ingest(fileEvent('i2', 'accessed', 'C:\\two\\creds.txt'));
    at(3000);
    engine.ingest(netEvent('i1'));
    at(4000);
    engine.ingest(netEvent('i2'));

    expect(detections.map((d) => d.instanceId)).toEqual(['i1', 'i2']);
    expect(detections[0].steps[0].path).toBe('C:\\one\\creds.txt');
    expect(detections[1].steps[0].path).toBe('C:\\two\\creds.txt');
    expect(detections[0].steps).not.toBe(detections[1].steps);
    expect(engine.getStats()).toMatchObject({ opened: 2, completed: 2, openNow: 0 });
  });

  it('A(i1) then B(i2) fires nothing — the group key is not shared', () => {
    start([rule('SEQ001', [stepA(), stepB()])]);

    at(1000);
    engine.ingest(fileEvent('i1'));
    at(2000);
    engine.ingest(netEvent('i2'));

    expect(detections).toHaveLength(0);
    expect(engine.getStats()).toMatchObject({ opened: 1, openNow: 1 });
  });

  it('one instance never holds more than one slot per rule, however many step-0 events it sends', () => {
    start([rule('SEQ001', [stepA(), stepB()])]);

    for (let i = 1; i <= 5; i++) {
      at(i * 1000);
      engine.ingest(fileEvent('i1'));
    }

    // One open, four slides: the fifth A replaced the window rather than adding a slot.
    expect(engine.getStats()).toMatchObject({ opened: 1, slid: 4, openNow: 1 });
  });

  it('the key is taken verbatim — two keys differing only in their birth time never merge', () => {
    start([rule('SEQ001', [stepA(), stepB()])]);

    at(1000);
    engine.ingest(fileEvent('4242:900'));
    at(2000);
    engine.ingest(netEvent('4242:901'));

    expect(detections).toHaveLength(0);
    expect(engine.getStats()).toMatchObject({ opened: 1, openNow: 1 });
  });
});

describe('sequence-engine — slide and the residual it does not cover', () => {
  it('slides at stepIndex 1: the window is measured from the LAST step 0, not the first', () => {
    start([rule('SEQ001', [stepA(), stepB()])]);

    at(0);
    engine.ingest(fileEvent('i1', 'accessed', 'C:\\first\\creds.txt'));
    at(40000);
    engine.ingest(fileEvent('i1', 'accessed', 'C:\\second\\creds.txt'));
    at(90000); // 90 s after A₁ — outside its window; 50 s after A₂ — inside
    engine.ingest(netEvent('i1'));

    expect(detections).toHaveLength(1);
    expect(detections[0].steps[0].at).toBe(40000);
    // steps[0] was REPLACED, not appended to: the slide widens the window at no memory cost.
    expect(detections[0].steps).toHaveLength(2);
    expect(detections[0].steps[0].path).toBe('C:\\second\\creds.txt');
    expect(engine.getStats()).toMatchObject({ opened: 1, slid: 1, expired: 0, completed: 1 });
  });

  it('a slide replaces the actor too — agent and pid follow the step-0 event that opened the window', () => {
    start([rule('SEQ001', [stepA(), stepB()])]);

    at(0);
    engine.ingest(fileEvent('i1', 'accessed', 'C:\\first\\creds.txt', { agent: 'First', pid: 11 }));
    at(40000);
    engine.ingest(
      fileEvent('i1', 'accessed', 'C:\\second\\creds.txt', { agent: 'Second', pid: 22 }),
    );
    at(50000);
    engine.ingest(netEvent('i1'));

    expect(detections[0]).toMatchObject({ agent: 'Second', pid: 22 });
  });

  it('A₁ A₂ B C fires on a three-step rule — the slide repairs exactly this shape', () => {
    // A₂ arrives at stepIndex 1 and SLIDES, so A₁'s expiry stops mattering. Pinned here as the
    // behaviour the code actually has (ai-mistakes #27 — write the guarantee, not the
    // impression); the real residual is the next case.
    start([rule('SEQ003', [stepA(), stepB(), stepC()])]);

    at(0);
    engine.ingest(fileEvent('i1'));
    at(50000);
    engine.ingest(fileEvent('i1'));
    at(70000);
    engine.ingest(netEvent('i1'));
    at(90000); // 90 s after A₁, 40 s after A₂
    engine.ingest(fileEvent('i1', 'modified'));

    expect(detections).toHaveLength(1);
    expect(detections[0].steps[0].at).toBe(50000);
    expect(engine.getStats()).toMatchObject({ slid: 1, retriggerIgnored: 0, completed: 1 });
  });

  it('the residual: at stepIndex ≥ 2 a repeated step 0 is ignored, and A₂ B₂ C is lost', () => {
    // `A₁ B₁ A₂ B₂ C` — A₂ arrives with the sequence already past step 1, so it cannot widen the
    // window; B₂ matches neither the wanted step nor step 0 and is dropped with no counter (no
    // STATE was dropped, which is what the invariant covers). C then finds an expired state.
    // A declared v1 bound, not a defect: the fix is a second open slot per (rule, key).
    start([rule('SEQ003', [stepA(), stepB(), stepC()])]);

    at(0);
    engine.ingest(fileEvent('i1'));
    at(10000);
    engine.ingest(netEvent('i1'));
    at(20000);
    engine.ingest(fileEvent('i1')); // A₂ — ignored at stepIndex 2
    at(30000);
    engine.ingest(netEvent('i1')); // B₂ — matches no step in this position
    at(70000); // inside A₂'s window, outside A₁'s
    engine.ingest(fileEvent('i1', 'modified'));

    expect(detections).toHaveLength(0);
    expect(engine.getStats()).toMatchObject({
      opened: 1,
      slid: 0,
      retriggerIgnored: 1,
      expired: 1,
      completed: 0,
      openNow: 0,
    });
  });
});

describe('sequence-engine — bounded memory', () => {
  /** Three distinct instances open under one rule, at 0 / 1000 / 2000 on the clock. */
  function fillThree() {
    for (const [i, key] of ['i1', 'i2', 'i3'].entries()) {
      at(i * 1000);
      engine.ingest(fileEvent(key));
    }
    expect(engine.getStats()).toMatchObject({ opened: 3, openNow: 3 });
  }

  it('per-rule cap: an expired state leaves as expired before anything live is evicted', () => {
    start([rule('SEQ001', [stepA(), stepB()])], { maxOpenPerRule: 3 });
    fillThree();

    at(SPAN + 1); // i1's window (opened at 0) has closed; i2's and i3's have not
    engine.ingest(fileEvent('i4'));

    expect(engine.getStats()).toMatchObject({ opened: 4, expired: 1, evicted: 0, openNow: 3 });
    expect(engine.getStats().rules.SEQ001).toMatchObject({ expired: 1, evicted: 0, openNow: 3 });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('per-rule cap: with nothing expired the OLDEST openedAt is evicted, counted and warned', () => {
    start([rule('SEQ001', [stepA(), stepB()])], { maxOpenPerRule: 3 });
    fillThree();

    at(3000);
    engine.ingest(fileEvent('i4'));

    expect(engine.getStats()).toMatchObject({ opened: 4, expired: 0, evicted: 1, openNow: 3 });
    expect(engine.getStats().rules.SEQ001).toMatchObject({ evicted: 1, openNow: 3 });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toBe('sequence-engine');
    expect(warnSpy.mock.calls[0][2]).toMatchObject({
      reason: 'cap-evicted',
      rule: 'SEQ001',
      cap: 'per-rule',
      limit: 3,
    });

    // i1 is the one that went: its B completes nothing, while i2's and i4's do.
    at(4000);
    engine.ingest(netEvent('i1'));
    engine.ingest(netEvent('i2'));
    engine.ingest(netEvent('i4'));
    expect(detections.map((d) => d.instanceId)).toEqual(['i2', 'i4']);
  });

  it('the eviction warn is rate limited to one a minute PER RULE, while the counter stays exact', () => {
    start([rule('SEQ001', [stepA(), stepB()]), rule('SEQ003', [stepC(), stepB()])], {
      maxOpenPerRule: 1,
    });

    at(1000);
    engine.ingest(fileEvent('i1'));
    engine.ingest(fileEvent('i2')); // evicts i1 under SEQ001 — warn 1
    engine.ingest(fileEvent('i3')); // evicts i2 under SEQ001 — inside the minute, no warn
    engine.ingest(fileEvent('i1', 'modified'));
    engine.ingest(fileEvent('i2', 'modified')); // evicts i1 under SEQ003 — its own first warn
    expect(engine.getStats()).toMatchObject({ evicted: 3 });
    expect(engine.getStats().rules.SEQ001.evicted).toBe(2);
    expect(engine.getStats().rules.SEQ003.evicted).toBe(1);
    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy.mock.calls.map((c) => c[2].rule)).toEqual(['SEQ001', 'SEQ003']);

    at(1000 + 60000);
    engine.ingest(fileEvent('i4')); // SEQ001, a minute later — warns again
    expect(engine.getStats().rules.SEQ001.evicted).toBe(3);
    expect(warnSpy).toHaveBeenCalledTimes(3);
  });

  it('total cap: every map is micro-swept first, so an expired state under ANOTHER rule frees the slot', () => {
    start([rule('SEQ001', [stepA(), stepB()]), rule('SEQ003', [stepC(), stepB()])], {
      maxOpenTotal: 3,
    });

    at(0);
    engine.ingest(fileEvent('i1')); // SEQ001
    at(1000);
    engine.ingest(fileEvent('i2', 'modified')); // SEQ003
    at(2000);
    engine.ingest(fileEvent('i3')); // SEQ001
    expect(engine.getStats()).toMatchObject({ openNow: 3 });

    at(SPAN + 1); // only SEQ001/i1 has expired
    engine.ingest(fileEvent('i4', 'modified')); // SEQ003 wants a slot

    expect(engine.getStats()).toMatchObject({ opened: 4, expired: 1, evicted: 0, openNow: 3 });
    expect(engine.getStats().rules.SEQ001).toMatchObject({ expired: 1, openNow: 1 });
    expect(engine.getStats().rules.SEQ003).toMatchObject({ expired: 0, openNow: 2 });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('total cap: with nothing expired the oldest openedAt ACROSS rules is evicted, counted under its own rule', () => {
    start([rule('SEQ001', [stepA(), stepB()]), rule('SEQ003', [stepC(), stepB()])], {
      maxOpenTotal: 3,
    });

    at(0);
    engine.ingest(fileEvent('i1')); // SEQ001 — the oldest
    at(1000);
    engine.ingest(fileEvent('i2', 'modified')); // SEQ003
    at(2000);
    engine.ingest(fileEvent('i3')); // SEQ001
    at(3000);
    engine.ingest(fileEvent('i4', 'modified')); // SEQ003 wants a slot

    expect(engine.getStats()).toMatchObject({ opened: 4, expired: 0, evicted: 1, openNow: 3 });
    expect(engine.getStats().rules.SEQ001).toMatchObject({ evicted: 1, openNow: 1 });
    expect(engine.getStats().rules.SEQ003).toMatchObject({ evicted: 0, openNow: 2 });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][2]).toMatchObject({
      reason: 'cap-evicted',
      rule: 'SEQ001',
      cap: 'total',
      limit: 3,
    });

    at(4000);
    engine.ingest(netEvent('i1'));
    expect(detections).toHaveLength(0); // i1's state is the one that went
  });

  it('a noisy instance cannot evict the others — one instance holds at most one slot per rule', () => {
    start([rule('SEQ001', [stepA(), stepB()])], { maxOpenPerRule: 3 });
    fillThree();

    for (let i = 0; i < 10; i++) {
      at(3000 + i);
      engine.ingest(fileEvent('i1')); // ten more step-0 events from the SAME key
    }

    expect(engine.getStats()).toMatchObject({ opened: 3, slid: 10, evicted: 0, openNow: 3 });
    expect(warnSpy).not.toHaveBeenCalled();

    at(4000);
    engine.ingest(netEvent('i2'));
    engine.ingest(netEvent('i3'));
    expect(detections.map((d) => d.instanceId)).toEqual(['i2', 'i3']); // both survived the noise
  });

  it('the default per-rule cap is 128 distinct instances', () => {
    start([rule('SEQ001', [stepA(), stepB()])]);

    at(1000);
    for (let i = 1; i <= DEFAULT_PER_RULE + 1; i++) engine.ingest(fileEvent(`i${i}`));

    expect(engine.getStats()).toMatchObject({
      opened: DEFAULT_PER_RULE + 1,
      evicted: 1,
      openNow: DEFAULT_PER_RULE,
      peakOpen: DEFAULT_PER_RULE,
    });
  });

  it('the default total cap is 1024 open sequences across every rule', () => {
    // Nine rules on the same step 0: 128 instances fill each to exactly its per-rule cap and
    // 1152 states in total, so the total cap — and only the total cap — has to give 128 times.
    const rules = [];
    for (let r = 1; r <= 9; r++) rules.push(rule(`SEQ00${r}`, [stepA(), stepB()]));
    start(rules);

    at(1000);
    for (let i = 1; i <= DEFAULT_PER_RULE; i++) engine.ingest(fileEvent(`i${i}`));

    expect(engine.getStats()).toMatchObject({
      opened: 9 * DEFAULT_PER_RULE,
      evicted: 9 * DEFAULT_PER_RULE - DEFAULT_TOTAL,
      openNow: DEFAULT_TOTAL,
      peakOpen: DEFAULT_TOTAL,
    });
  });

  it('a cap option that is not a positive integer falls back to the default', () => {
    start([rule('SEQ001', [stepA(), stepB()])], { maxOpenPerRule: 0 });

    at(1000);
    for (let i = 1; i <= DEFAULT_PER_RULE + 1; i++) engine.ingest(fileEvent(`i${i}`));

    expect(engine.getStats()).toMatchObject({ evicted: 1, openNow: DEFAULT_PER_RULE });
  });
});

describe('sequence-engine — agent-exit', () => {
  it('an exit completes a rule whose LAST step is the exit, before it closes anything', () => {
    start([rule('SEQ005', [stepA(), stepExit()])]);

    at(1000);
    engine.ingest(fileEvent('i1'));
    at(2000);
    engine.ingest(exitEvent('i1'));

    expect(detections).toHaveLength(1);
    expect(detections[0].steps.map((s) => s.action)).toEqual(['file-accessed', 'agent-exit']);
    expect(engine.getStats()).toMatchObject({ completed: 1, closedOnExit: 0, openNow: 0 });
  });

  it('an exit closes every open state for that key across ALL rules, and leaves other keys alone', () => {
    start([rule('SEQ001', [stepA(), stepB()]), rule('SEQ003', [stepC(), stepB()])]);

    at(1000);
    engine.ingest(fileEvent('i1'));
    engine.ingest(fileEvent('i1', 'modified'));
    engine.ingest(fileEvent('i2'));
    expect(engine.getStats()).toMatchObject({ openNow: 3 });

    at(2000);
    engine.ingest(exitEvent('i1'));

    expect(engine.getStats()).toMatchObject({ closedOnExit: 2, openNow: 1 });
    expect(engine.getStats().rules.SEQ001).toMatchObject({ closedOnExit: 1, openNow: 1 });
    expect(engine.getStats().rules.SEQ003).toMatchObject({ closedOnExit: 1, openNow: 0 });

    at(3000);
    engine.ingest(netEvent('i1')); // no state left to advance
    engine.ingest(netEvent('i2'));
    expect(detections.map((d) => d.instanceId)).toEqual(['i2']);
  });

  it('one exit is a completing step for one rule AND the cleanup for another', () => {
    start([rule('SEQ005', [stepA(), stepExit()]), rule('SEQ001', [stepA(), stepB()])]);

    at(1000);
    engine.ingest(fileEvent('i1'));
    at(2000);
    engine.ingest(exitEvent('i1'));

    expect(detections.map((d) => d.ruleId)).toEqual(['SEQ005']);
    expect(engine.getStats()).toMatchObject({ completed: 1, closedOnExit: 1, openNow: 0 });
    expect(engine.getStats().rules.SEQ005).toMatchObject({ completed: 1, closedOnExit: 0 });
    expect(engine.getStats().rules.SEQ001).toMatchObject({ completed: 0, closedOnExit: 1 });
  });

  it('a late open for an exited key is skipped and counted while the TTL holds, inclusive', () => {
    start([rule('SEQ001', [stepA(), stepB()])]);

    at(1000);
    engine.ingest(exitEvent('i1')); // nothing was open: closedOnExit stays 0
    at(2000);
    engine.ingest(fileEvent('i1')); // the async handle-scan result that arrives after the exit
    at(1000 + EXIT_TTL);
    engine.ingest(fileEvent('i1'));

    expect(engine.getStats()).toMatchObject({
      closedOnExit: 0,
      lateAfterExit: 2,
      opened: 0,
      openNow: 0,
      recentlyExited: 1,
    });
    expect(engine.getStats().rules.SEQ001.lateAfterExit).toBe(2);
  });

  it('after the TTL the same key opens normally again', () => {
    start([rule('SEQ001', [stepA(), stepB()])]);

    at(1000);
    engine.ingest(exitEvent('i1'));
    at(1000 + EXIT_TTL + 1);
    engine.ingest(fileEvent('i1'));

    expect(engine.getStats()).toMatchObject({ lateAfterExit: 0, opened: 1, openNow: 1 });
  });

  it('a late open is counted under every rule it would have opened', () => {
    start([rule('SEQ001', [stepA(), stepB()]), rule('SEQ003', [stepA(), stepC()])]);

    at(1000);
    engine.ingest(exitEvent('i1'));
    at(2000);
    engine.ingest(fileEvent('i1'));

    expect(engine.getStats()).toMatchObject({ lateAfterExit: 2, opened: 0 });
    expect(engine.getStats().rules.SEQ001.lateAfterExit).toBe(1);
    expect(engine.getStats().rules.SEQ003.lateAfterExit).toBe(1);
  });

  it('sweep purges expired recentlyExited entries and keeps live ones', () => {
    start([rule('SEQ001', [stepA(), stepB()])]);

    at(1000);
    engine.ingest(exitEvent('i1'));
    at(5000);
    engine.ingest(exitEvent('i2'));
    expect(engine.getStats()).toMatchObject({ recentlyExited: 2 });

    at(1000 + EXIT_TTL);
    engine.sweep();
    expect(engine.getStats()).toMatchObject({ recentlyExited: 2 }); // i1 is exactly at its TTL

    at(1000 + EXIT_TTL + 1);
    engine.sweep();
    expect(engine.getStats()).toMatchObject({ recentlyExited: 1 });

    at(5000 + EXIT_TTL + 1);
    engine.sweep();
    expect(engine.getStats()).toMatchObject({ recentlyExited: 0 });
  });

  it('a second exit for the same key re-arms the TTL', () => {
    start([rule('SEQ001', [stepA(), stepB()])]);

    at(1000);
    engine.ingest(exitEvent('i1'));
    at(30000);
    engine.ingest(exitEvent('i1'));
    at(1000 + EXIT_TTL + 1); // past the first TTL, inside the second
    engine.ingest(fileEvent('i1'));

    expect(engine.getStats()).toMatchObject({ lateAfterExit: 1, opened: 0, recentlyExited: 1 });
  });

  it('an enter is a plain process event: it neither closes nor marks anything', () => {
    start([rule('SEQ001', [stepA(), stepB()])]);

    at(1000);
    engine.ingest(fileEvent('i1'));
    at(2000);
    engine.ingest(enterEvent('i1'));
    at(3000);
    engine.ingest(netEvent('i1'));

    expect(detections).toHaveLength(1);
    expect(engine.getStats()).toMatchObject({ closedOnExit: 0, recentlyExited: 0 });
  });
});

describe('sequence-engine — the detection payload and its attribution', () => {
  it('confirmed + inferred steps make an inferred sequence — the weakest link decides', () => {
    start([rule('SEQ001', [stepA(), stepB()])]);

    at(1000);
    engine.ingest(
      fileEvent('i1', 'accessed', 'C:\\work\\creds.txt', { attribution: INFERRED_FILE }),
    );
    at(2000);
    engine.ingest(netEvent('i1', 443, { attribution: CONFIRMED_NET }));

    expect(detections[0].attribution).toEqual({
      status: 'inferred',
      evidence: ['cwd-containment', 'os-tcp-owner-pid'],
    });
  });

  it('a step whose carrier has no attribution is neutral — a NetworkConnection, an enter, an exit', () => {
    start([rule('SEQ005', [stepEnter(), stepA(), stepB(), stepExit()])]);

    at(1000);
    engine.ingest(enterEvent('i1'));
    at(2000);
    engine.ingest(fileEvent('i1'));
    at(3000);
    engine.ingest(netEvent('i1')); // the production shape: no `attribution` field at all
    at(4000);
    engine.ingest(exitEvent('i1'));

    expect(detections).toHaveLength(1);
    expect(detections[0].attribution).toEqual({
      status: 'confirmed',
      evidence: ['handle-scan-pid'],
    });
    expect(detections[0].steps.map((s) => s.attribution)).toEqual([
      null,
      { status: 'confirmed', evidence: ['handle-scan-pid'] },
      null,
      null,
    ]);
  });

  it('an inferred step among neutral ones still makes the sequence inferred', () => {
    start([rule('SEQ005', [stepEnter(), stepA(), stepExit()])]);

    at(1000);
    engine.ingest(enterEvent('i1'));
    at(2000);
    engine.ingest(
      fileEvent('i1', 'accessed', 'C:\\work\\creds.txt', { attribution: INFERRED_FILE }),
    );
    at(3000);
    engine.ingest(exitEvent('i1'));

    expect(detections[0].attribution).toEqual({
      status: 'inferred',
      evidence: ['cwd-containment'],
    });
  });

  it('a sequence of neutral steps only reports confirmed with no evidence — the key itself is the observation', () => {
    // Process events carry no `attribution` by design (events.ts: the question does not apply),
    // and their `instanceId` IS the scanner's own pid observation. Pinned as the guarantee the
    // code gives, not an impression (ai-mistakes #27).
    start([rule('SEQ005', [stepEnter(), stepExit()])]);

    at(1000);
    engine.ingest(enterEvent('i1'));
    at(2000);
    engine.ingest(exitEvent('i1'));

    expect(detections[0].attribution).toEqual({ status: 'confirmed', evidence: [] });
  });

  it('the evidence union keeps first-appearance order and drops repeats', () => {
    start([rule('SEQ002', [stepA(), stepA()])]);

    at(1000);
    engine.ingest(fileEvent('i1', 'accessed', 'C:\\a', { attribution: CONFIRMED_FILE }));
    at(2000);
    engine.ingest(
      fileEvent('i1', 'accessed', 'C:\\b', {
        attribution: { status: 'confirmed', evidence: ['rm-holder-pid', 'handle-scan-pid'] },
      }),
    );

    expect(detections[0].attribution.evidence).toEqual(['handle-scan-pid', 'rm-holder-pid']);
  });

  it('an unattributed step is the weakest link of all', () => {
    start([rule('SEQ001', [stepA(), stepB()])]);

    at(1000);
    engine.ingest(
      fileEvent('i1', 'accessed', 'C:\\work\\creds.txt', {
        attribution: { status: 'unattributed', evidence: ['no-owner-match'] },
      }),
    );
    at(2000);
    engine.ingest(netEvent('i1', 443, { attribution: CONFIRMED_NET }));

    expect(detections[0].attribution.status).toBe('unattributed');
  });

  it('agent and pid come from the FIRST step, not the last', () => {
    start([rule('SEQ001', [stepA(), stepB()])]);

    at(1000);
    engine.ingest(fileEvent('i1', 'accessed', 'C:\\work\\creds.txt', { agent: 'Opener', pid: 7 }));
    at(2000);
    engine.ingest(netEvent('i1', 443, { agent: 'Closer', pid: 8 }));

    expect(detections[0]).toMatchObject({ agent: 'Opener', pid: 7 });
  });

  it('a first step with no agent and no pid yields the audit conventions: agent "" and pid null', () => {
    start([rule('SEQ001', [stepA(), stepB()])]);

    at(1000);
    engine.ingest(fileEvent('i1', 'accessed', 'C:\\work\\creds.txt', { agent: '', pid: null }));
    at(2000);
    engine.ingest(netEvent('i1'));

    expect(detections[0]).toMatchObject({ agent: '', pid: null });
  });

  it('a step omits what the projection does not carry, rather than writing it as null', () => {
    // `renamed` is outside the closed `FileAction` union, so the projection keeps the `file`
    // category and invents no `event.action` — the absence-is-absence convention, end to end.
    // `attribution` is the one key always present: `null` there is a statement (neutral).
    start([rule('SEQ004', [step('any_file', 'file', () => true), stepB()])]);

    at(1000);
    engine.ingest(fileEvent('i1', 'renamed', 'C:\\work\\creds.txt', { attribution: undefined }));
    at(2000);
    engine.ingest(netEvent('i1'));

    expect(detections[0].steps[0]).toEqual({
      step: 'any_file',
      at: 1000,
      path: 'C:\\work\\creds.txt',
      attribution: null,
    });
  });

  it('a step path is truncated to 256 characters', () => {
    start([rule('SEQ001', [stepA(), stepB()])]);

    const longPath = `C:\\work\\${'d'.repeat(400)}\\creds.txt`;
    at(1000);
    engine.ingest(fileEvent('i1', 'accessed', longPath));
    at(2000);
    engine.ingest(netEvent('i1'));

    expect(detections[0].steps[0].path).toHaveLength(256);
    expect(detections[0].steps[0].path).toBe(longPath.slice(0, 256));
  });

  it('the payload shares no array with the engine — a consumer cannot reach the evidence of a live state', () => {
    start([rule('SEQ002', [stepA(), stepA()])]);

    at(1000);
    engine.ingest(fileEvent('i1'));
    at(2000);
    engine.ingest(fileEvent('i1'));

    const held = detections[0].steps[0].attribution.evidence;
    expect(held).not.toBe(CONFIRMED_FILE.evidence);
    held.push('tampered');
    expect(CONFIRMED_FILE.evidence).toEqual(['handle-scan-pid']);
  });
});

describe('sequence-engine — refusals, reset and stats', () => {
  it('a null instanceId is counted and skipped, and never opens or advances', () => {
    start([rule('SEQ001', [stepA(), stepB()])]);

    at(1000);
    engine.ingest(fileEvent(null));
    at(2000);
    engine.ingest(fileEvent('i1'));
    at(3000);
    engine.ingest(netEvent(null)); // would have completed, had the key been read from anywhere

    expect(detections).toHaveLength(0);
    expect(engine.getStats()).toMatchObject({
      skippedNullInstanceId: 2,
      opened: 1,
      completed: 0,
      openNow: 1,
    });
  });

  it('a carrier with no instanceId field at all falls under the same policy', () => {
    start([rule('SEQ001', [stepA(), stepB()])]);

    at(1000);
    engine.ingest({ file: 'C:\\work\\creds.txt', action: 'accessed', timestamp: 1 });

    expect(engine.getStats()).toMatchObject({ skippedNullInstanceId: 1, ingestErrors: 0 });
  });

  it('an unrecognised carrier counts an ingest error, warns once, and throws nothing', () => {
    start([rule('SEQ001', [stepA(), stepB()])]);

    at(1000);
    expect(() => engine.ingest({ instanceId: 'i1', somethingElse: true })).not.toThrow();

    expect(engine.getStats()).toMatchObject({ ingestErrors: 1, opened: 0 });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toBe('sequence-engine');
    expect(warnSpy.mock.calls[0][1]).toContain('unrecognised event shape');
    expect(warnSpy.mock.calls[0][2]).toMatchObject({ reason: 'ingest-error' });
  });

  it('a non-object carrier is refused the same way, one step before the normalizer', () => {
    start([rule('SEQ001', [stepA(), stepB()])]);

    at(1000);
    expect(() => engine.ingest(null)).not.toThrow();
    expect(() => engine.ingest('not an event')).not.toThrow();

    expect(engine.getStats()).toMatchObject({ ingestErrors: 2, skippedNullInstanceId: 0 });
    expect(warnSpy.mock.calls[0][1]).toContain('expected an event object');
  });

  it('the ingest warn is rate limited on the injected clock while the counter stays exact', () => {
    start([rule('SEQ001', [stepA(), stepB()])]);

    at(1000);
    engine.ingest({ instanceId: 'i1', somethingElse: true });
    at(1000 + 59999);
    engine.ingest({ instanceId: 'i1', somethingElse: true });
    expect(engine.getStats()).toMatchObject({ ingestErrors: 2 });
    expect(warnSpy).toHaveBeenCalledTimes(1);

    at(1000 + 60000);
    engine.ingest({ instanceId: 'i1', somethingElse: true });
    expect(engine.getStats()).toMatchObject({ ingestErrors: 3 });
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it("a matcher that throws is that RULE's ingest error — the other rules still see the event", () => {
    const broken = step('broken', 'file', () => {
      throw new Error('matcher blew up');
    });
    start([rule('SEQ001', [broken, stepB()]), rule('SEQ003', [stepA(), stepC()])]);

    at(1000);
    expect(() => engine.ingest(fileEvent('i1'))).not.toThrow();

    expect(engine.getStats()).toMatchObject({ ingestErrors: 1, opened: 1, openNow: 1 });
    expect(engine.getStats().rules.SEQ001).toMatchObject({ ingestErrors: 1, opened: 0 });
    expect(engine.getStats().rules.SEQ003).toMatchObject({ ingestErrors: 0, opened: 1 });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][1]).toContain('matcher blew up');
    expect(warnSpy.mock.calls[0][2]).toMatchObject({ reason: 'ingest-error', rule: 'SEQ001' });
  });

  it('reset discards every open sequence, counts them per rule, and keeps the other counters', () => {
    start([rule('SEQ001', [stepA(), stepB()]), rule('SEQ003', [stepA(), stepC()])]);

    at(1000);
    engine.ingest(fileEvent('i1'));
    at(2000);
    engine.ingest(fileEvent('i2'));
    expect(engine.getStats()).toMatchObject({ opened: 4, openNow: 4 });

    engine.reset('rules-reloaded');

    expect(engine.getStats()).toMatchObject({ reloadDiscarded: 4, openNow: 0, opened: 4 });
    expect(engine.getStats().rules.SEQ001).toMatchObject({ reloadDiscarded: 2, openNow: 0 });
    expect(engine.getStats().rules.SEQ003).toMatchObject({ reloadDiscarded: 2, openNow: 0 });
    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy.mock.calls[0][2]).toMatchObject({ reason: 'rules-reloaded', discarded: 4 });
  });

  it('a reset with nothing open counts nothing and logs nothing', () => {
    start([rule('SEQ001', [stepA(), stepB()])]);

    engine.reset('rules-reloaded');

    expect(engine.getStats()).toMatchObject({ reloadDiscarded: 0 });
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it('with no rules loaded ingest returns before every other check', () => {
    engine.init({ rules: [], onDetection: (d) => detections.push(d), now });

    at(1000);
    engine.ingest(fileEvent(null));
    engine.ingest({ instanceId: 'i1', somethingElse: true });

    // Both counters stay 0: an engine with no ruleset does not project, does not count and does
    // not warn — the length check is the whole cost per event.
    expect(engine.getStats()).toMatchObject({ skippedNullInstanceId: 0, ingestErrors: 0 });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('init with no argument yields an engine with no rules and zeroed counters', () => {
    engine.init();

    expect(engine.getStats()).toEqual({
      opened: 0,
      completed: 0,
      expired: 0,
      evicted: 0,
      slid: 0,
      retriggerIgnored: 0,
      closedOnExit: 0,
      lateAfterExit: 0,
      reloadDiscarded: 0,
      ingestErrors: 0,
      skippedNullInstanceId: 0,
      openNow: 0,
      peakOpen: 0,
      recentlyExited: 0,
      rules: {},
    });
  });

  it('per-rule counters are keyed by exactly the loaded ruleIds, each with the fixed counter set', () => {
    start([rule('SEQ001', [stepA(), stepB()]), rule('SEQ003', [stepA(), stepC()])]);

    expect(Object.keys(engine.getStats().rules)).toEqual(['SEQ001', 'SEQ003']);
    expect(engine.getStats().rules.SEQ003).toEqual({
      opened: 0,
      completed: 0,
      expired: 0,
      evicted: 0,
      slid: 0,
      retriggerIgnored: 0,
      closedOnExit: 0,
      lateAfterExit: 0,
      reloadDiscarded: 0,
      ingestErrors: 0,
      openNow: 0,
      peakOpen: 0,
    });
  });

  it('per-rule counters move with the rule that owns the transition', () => {
    start([rule('SEQ001', [stepA(), stepB()]), rule('SEQ003', [stepA(), stepC()])]);

    at(1000);
    engine.ingest(fileEvent('i1')); // opens both
    at(2000);
    engine.ingest(fileEvent('i1')); // slides both
    at(3000);
    engine.ingest(netEvent('i1')); // completes SEQ001 only
    at(3000 + SPAN + 1);
    engine.ingest(netEvent('i1')); // expires SEQ003's state, opens nothing

    expect(engine.getStats().rules.SEQ001).toMatchObject({
      opened: 1,
      slid: 1,
      completed: 1,
      expired: 0,
      openNow: 0,
    });
    expect(engine.getStats().rules.SEQ003).toMatchObject({
      opened: 1,
      slid: 1,
      completed: 0,
      expired: 1,
      openNow: 0,
    });
    expect(engine.getStats()).toMatchObject({ opened: 2, slid: 2, completed: 1, expired: 1 });
  });

  it('openNow follows the live count and peakOpen is the high-water mark, per rule and globally', () => {
    start([rule('SEQ001', [stepA(), stepB()]), rule('SEQ003', [stepC(), stepB()])]);

    at(1000);
    engine.ingest(fileEvent('i1'));
    engine.ingest(fileEvent('i2'));
    engine.ingest(fileEvent('i3', 'modified'));
    expect(engine.getStats()).toMatchObject({ openNow: 3, peakOpen: 3 });
    expect(engine.getStats().rules.SEQ001).toMatchObject({ openNow: 2, peakOpen: 2 });
    expect(engine.getStats().rules.SEQ003).toMatchObject({ openNow: 1, peakOpen: 1 });

    at(2000);
    engine.ingest(netEvent('i1'));
    engine.ingest(netEvent('i3'));
    expect(engine.getStats()).toMatchObject({ openNow: 1, peakOpen: 3 });
    expect(engine.getStats().rules.SEQ001).toMatchObject({ openNow: 1, peakOpen: 2 });
    expect(engine.getStats().rules.SEQ003).toMatchObject({ openNow: 0, peakOpen: 1 });

    at(3000);
    engine.ingest(fileEvent('i4'));
    expect(engine.getStats()).toMatchObject({ openNow: 2, peakOpen: 3 });
    expect(engine.getStats().rules.SEQ001).toMatchObject({ openNow: 2, peakOpen: 2 });
  });

  it('a completion with no onDetection installed still counts and still deletes the state', () => {
    engine.init({ rules: [rule('SEQ001', [stepA(), stepB()])], now });

    at(1000);
    engine.ingest(fileEvent('i1'));
    at(2000);
    engine.ingest(netEvent('i1'));

    expect(engine.getStats()).toMatchObject({ completed: 1, openNow: 0 });
  });

  it('re-init zeroes the counters, drops the state and the exit marks, without counting a reload', () => {
    start([rule('SEQ001', [stepA(), stepB()])]);
    at(1000);
    engine.ingest(fileEvent('i1'));
    engine.ingest(exitEvent('i2'));
    expect(engine.getStats()).toMatchObject({ openNow: 1, recentlyExited: 1 });

    start([rule('SEQ001', [stepA(), stepB()])]);

    expect(engine.getStats()).toMatchObject({
      opened: 0,
      openNow: 0,
      peakOpen: 0,
      recentlyExited: 0,
      reloadDiscarded: 0,
    });
  });

  it('getStats hands out a fresh object at both levels — a caller cannot move a counter', () => {
    start([rule('SEQ001', [stepA(), stepB()])]);
    at(1000);
    engine.ingest(fileEvent('i1'));

    const snapshot = engine.getStats();
    snapshot.opened = 99;
    snapshot.rules.SEQ001.opened = 99;
    snapshot.rules.SEQ999 = { opened: 1 };

    expect(engine.getStats().opened).toBe(1);
    expect(engine.getStats().rules.SEQ001.opened).toBe(1);
    expect(Object.keys(engine.getStats().rules)).toEqual(['SEQ001']);
  });
});

describe('sequence-engine — against a loader-compiled rule', () => {
  const SOURCE = [
    'title: Credential file read',
    'name: cred_file_read',
    'logsource:',
    '  product: aegis',
    '  category: file',
    'detection:',
    '  selection:',
    '    event.action: file-accessed',
    '    file.path|contains: creds',
    '  condition: selection',
    '---',
    'title: Outbound connection',
    'name: outbound_conn',
    'logsource:',
    '  product: aegis',
    '  category: network',
    'detection:',
    '  selection:',
    '    destination.port: 443',
    '  condition: selection',
    '---',
    'title: Credential read followed by an outbound connection',
    'id: SEQ001',
    'level: high',
    'correlation:',
    '  type: temporal_ordered',
    '  rules:',
    '    - cred_file_read',
    '    - outbound_conn',
    '  group-by:',
    '    - process.entity_id',
    '  timespan: 5m',
  ].join('\n');

  it('consumes the shape the loader produces, matchers and timespanMs included', () => {
    const loaded = loader.loadFromString(SOURCE, 'engine-parity.yaml');
    expect(loaded.loadErrors).toBe(0);
    start(loaded.rules);

    at(1000);
    engine.ingest(fileEvent('i1', 'accessed', 'C:\\work\\creds.txt'));
    at(1000 + 5 * 60 * 1000); // exactly the compiled timespan
    engine.ingest(netEvent('i1'));

    expect(detections).toHaveLength(1);
    expect(detections[0]).toMatchObject({
      ruleId: 'SEQ001',
      level: 'high',
      title: 'Credential read followed by an outbound connection',
      timespan: 5 * 60 * 1000,
    });
    expect(elapsedOf(detections[0])).toBe(5 * 60 * 1000);
    expect(detections[0].steps.map((s) => s.step)).toEqual(['cred_file_read', 'outbound_conn']);
    expect(Object.keys(engine.getStats().rules)).toEqual(['SEQ001']);
  });

  it('a path the compiled selection does not match opens nothing', () => {
    const loaded = loader.loadFromString(SOURCE, 'engine-parity.yaml');
    start(loaded.rules);

    at(1000);
    engine.ingest(fileEvent('i1', 'accessed', 'C:\\work\\notes.txt'));

    expect(engine.getStats()).toMatchObject({ opened: 0 });
  });
});

describe('sequence-engine — scoreFor, the score the alert path merges (roadmap §5)', () => {
  /** The hold after the LAST detection on an instance — ten minutes on the injected clock. */
  const HOLD = 10 * 60 * 1000;

  /**
   * SEQ001 at the given level. The level lives on the RULE, so a score per level needs a
   * ruleset per level.
   * @param {string} level
   * @returns {Record<string, unknown>}
   */
  const levelled = (level) => ({ ...rule('SEQ001', [stepA(), stepB()]), level });

  /**
   * Completes SEQ001 for `key`: step A at `t`, step B one second later.
   * @param {string} key
   * @param {number} t
   * @returns {void}
   */
  function complete(key, t) {
    at(t);
    engine.ingest(fileEvent(key));
    at(t + 1000);
    engine.ingest(netEvent(key));
  }

  it('maps the level of the last detection: critical 90, high 70, medium 55, low 30', () => {
    for (const [level, score] of [
      ['critical', 90],
      ['high', 70],
      ['medium', 55],
      ['low', 30],
    ]) {
      start([levelled(/** @type {string} */ (level))]);
      complete('i1', 1000);
      expect(detections).toHaveLength(1);
      expect(engine.scoreFor('i1'), `level ${level}`).toBe(score);
      detections = [];
    }
  });

  it('an instance with no detection scores 0, and so does an informational one', () => {
    start([levelled('informational')]);
    expect(engine.scoreFor('i1')).toBe(0);

    complete('i1', 1000);

    expect(detections).toHaveLength(1);
    expect(engine.scoreFor('i1')).toBe(0);
    expect(engine.scoreFor('never-seen')).toBe(0);
  });

  it('is keyed by instance — a detection on i1 leaves i2 at 0', () => {
    start([levelled('high')]);
    complete('i1', 1000);

    expect(engine.scoreFor('i1')).toBe(70);
    expect(engine.scoreFor('i2')).toBe(0);
  });

  it('holds the score to the ten-minute boundary inclusive and drops it one ms past', () => {
    start([levelled('high')]);
    complete('i1', 1000); // the detection lands at 2000

    at(2000 + HOLD);
    expect(engine.scoreFor('i1')).toBe(70);
    at(2000 + HOLD + 1);
    expect(engine.scoreFor('i1')).toBe(0);
    // Gone, not merely hidden: the clock does not run backwards, but a reading that
    // returns 0 must stay 0 on the next call at the same instant.
    expect(engine.scoreFor('i1')).toBe(0);
  });

  it('a later detection re-arms the hold, and its level replaces the earlier one', () => {
    start([
      { ...rule('SEQ001', [stepA(), stepB()]), level: 'critical' },
      { ...rule('SEQ003', [stepA(), stepC()]), level: 'low' },
    ]);
    // A at 1000 opens both; B at 2000 completes SEQ001 (critical).
    complete('i1', 1000);
    expect(engine.scoreFor('i1')).toBe(90);
    // C at 5000 completes SEQ003 (low): the LAST detection decides the level and the hold.
    at(5000);
    engine.ingest(fileEvent('i1', 'modified'));
    expect(detections).toHaveLength(2);
    expect(engine.scoreFor('i1')).toBe(30);

    at(2000 + HOLD + 1); // past the first detection's hold, inside the second's
    expect(engine.scoreFor('i1')).toBe(30);
    at(5000 + HOLD + 1);
    expect(engine.scoreFor('i1')).toBe(0);
  });

  it('survives a reset — a reload changes the rules, not what an instance did', () => {
    start([levelled('high')]);
    complete('i1', 1000);

    engine.reset('rules-reloaded');

    expect(engine.scoreFor('i1')).toBe(70);
  });

  it('a fresh init starts with no scores', () => {
    start([levelled('high')]);
    complete('i1', 1000);
    expect(engine.scoreFor('i1')).toBe(70);

    start([levelled('high')]);

    expect(engine.scoreFor('i1')).toBe(0);
  });

  it('a sweep past the hold drops the entry, so the score is 0 without a later read', () => {
    start([levelled('high')]);
    complete('i1', 1000);

    at(2000 + HOLD + 1);
    engine.sweep();
    at(2000); // even a clock that jumped back finds nothing to score
    expect(engine.scoreFor('i1')).toBe(0);
  });

  it('a non-string key scores 0 and moves no counter', () => {
    start([levelled('high')]);
    complete('i1', 1000);
    const before = engine.getStats();

    expect(engine.scoreFor(null)).toBe(0);
    expect(engine.scoreFor(undefined)).toBe(0);
    expect(engine.getStats()).toEqual(before);
  });
});
