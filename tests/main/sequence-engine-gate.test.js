/**
 * sequence-engine — the GATE suite: exactly the four properties `scripts/verify-sequence-gate.mjs`
 * mutates, one describe each, on an injected clock. Order (m1), the maxspan boundary (m2),
 * group-by isolation (m3) and the caps (m4). Everything else the engine does is pinned by
 * `tests/main/sequence-engine.test.js`, which hard-imports the real module and therefore has no
 * killing power against a mutant (memory-bank/ai-mistakes.md #21).
 *
 * The rules are hand-built in the shape `sequence-rule-loader` compiles — `{ id, title, level,
 * timespanMs, steps: [{ name, category, matcher }] }`, the parity the engine suite pins against a
 * loader-compiled rule — and the carriers are real: every event goes through `normalizeToEcs`
 * inside `ingest`. The caps case runs on the module DEFAULTS on purpose: a cap lowered through
 * `init` would still be honoured by a mutant that only lifted the constants.
 *
 * `logger` is pulled in through `createRequire` — the same native module instance the CJS module
 * under test (real or mutant) requires; an ESM import of the same path yields a different object
 * and a spy on it never fires.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';

/**
 * The module path is overridable so `scripts/verify-sequence-gate.mjs` can point this suite at
 * a deliberately broken copy and prove the gate is load-bearing. ai-mistakes #21: a passing
 * command proves the command ran, not that it inspected anything.
 */
const MODULE_UNDER_TEST =
  process.env.AEGIS_SEQ_UNDER_TEST ||
  new URL('../../src/main/sequence-engine.js', import.meta.url).href;
const engine = (await import(/* @vite-ignore */ MODULE_UNDER_TEST)).default;

const require_ = createRequire(import.meta.url);
const logger = require_('../../src/main/logger.js');

/** The window every rule below uses. @type {number} */
const SPAN = 60000;

/** The per-rule cap the module declares, pinned by the caps case on the defaults. */
const DEFAULT_PER_RULE = 128;

/** @type {number} */
let clock = 0;

/** @type {Array<Record<string, any>>} */
let detections = [];

/** @type {import('vitest').MockInstance} */
let warnSpy;

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
 * A two-step rule, A (a file read) then B (an outbound 443), in the loader's compiled shape.
 * @param {number} [timespanMs]
 * @returns {Record<string, unknown>}
 */
function ruleAB(timespanMs = SPAN) {
  return {
    id: 'SEQ001',
    title: 'SEQ001 — under the gate',
    level: 'high',
    timespanMs,
    steps: [
      step('a_read', 'file', (doc) => doc.event.action === 'file-accessed'),
      step(
        'b_conn',
        'network',
        (doc) => doc.destination !== undefined && doc.destination.port === 443,
      ),
    ],
  };
}

/**
 * A `FileEvent` as file-watcher stamps it — the step-A carrier.
 * @param {string} instanceId
 * @returns {Record<string, unknown>}
 */
function fileEvent(instanceId) {
  return {
    instanceId,
    file: 'C:\\work\\creds.txt',
    action: 'accessed',
    timestamp: 1_700_000_000_000,
    agent: 'Claude Code',
    pid: 4242,
    attribution: { status: 'confirmed', evidence: ['handle-scan-pid'] },
  };
}

/**
 * A `NetworkConnection` as the scan hands it over — the step-B carrier.
 * @param {string} instanceId
 * @returns {Record<string, unknown>}
 */
function netEvent(instanceId) {
  return {
    instanceId,
    remoteIp: '203.0.113.5',
    remotePort: 443,
    agent: 'Claude Code',
    pid: 4242,
  };
}

/**
 * Installs the ruleset on a zeroed engine with the module's default caps.
 * @param {Array<Record<string, unknown>>} rules
 * @returns {void}
 */
function start(rules) {
  engine.init({ rules, onDetection: (d) => detections.push(d), now });
}

beforeEach(() => {
  clock = 0;
  detections = [];
  warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  engine.init({ rules: [] });
});

describe('sequence-engine gate — order (m1)', () => {
  it('B then A fires nothing: B opens no state and A only opens one', () => {
    start([ruleAB()]);

    at(1000);
    engine.ingest(netEvent('i1'));
    at(2000);
    engine.ingest(fileEvent('i1'));

    expect(detections).toEqual([]);
    expect(engine.getStats()).toMatchObject({ opened: 1, completed: 0, openNow: 1 });
  });

  it('A then B fires once, with the steps in that order', () => {
    start([ruleAB()]);

    at(1000);
    engine.ingest(fileEvent('i1'));
    at(2000);
    engine.ingest(netEvent('i1'));

    expect(detections).toHaveLength(1);
    expect(detections[0]).toMatchObject({ ruleId: 'SEQ001', instanceId: 'i1' });
    expect(detections[0].steps.map((s) => s.step)).toEqual(['a_read', 'b_conn']);
    expect(engine.getStats()).toMatchObject({ opened: 1, completed: 1, openNow: 0 });
  });
});

describe('sequence-engine gate — maxspan boundary (m2)', () => {
  it('B exactly timespan after A fires', () => {
    start([ruleAB()]);

    at(1000);
    engine.ingest(fileEvent('i1'));
    at(1000 + SPAN);
    engine.ingest(netEvent('i1'));

    expect(detections).toHaveLength(1);
    expect(detections[0].steps[1].at - detections[0].steps[0].at).toBe(SPAN);
    expect(engine.getStats()).toMatchObject({ completed: 1, expired: 0 });
  });

  it('B one millisecond past timespan fires nothing, expires the state and opens nothing', () => {
    start([ruleAB()]);

    at(1000);
    engine.ingest(fileEvent('i1'));
    at(1000 + SPAN + 1);
    engine.ingest(netEvent('i1'));

    expect(detections).toEqual([]);
    expect(engine.getStats()).toMatchObject({ opened: 1, completed: 0, expired: 1, openNow: 0 });
    expect(engine.getStats().rules.SEQ001).toMatchObject({ expired: 1, openNow: 0 });
  });
});

describe('sequence-engine gate — group-by isolation (m3)', () => {
  it('A on one instance and B on another fires nothing', () => {
    start([ruleAB()]);

    at(1000);
    engine.ingest(fileEvent('i1'));
    at(2000);
    engine.ingest(netEvent('i2'));

    expect(detections).toEqual([]);
    expect(engine.getStats()).toMatchObject({ opened: 1, completed: 0, openNow: 1 });
  });

  it('A(i1) A(i2) B(i1) B(i2) gives two detections, one per instance, with separate evidence', () => {
    start([ruleAB()]);

    at(1000);
    engine.ingest(fileEvent('i1'));
    at(2000);
    engine.ingest(fileEvent('i2'));
    at(3000);
    engine.ingest(netEvent('i1'));
    at(4000);
    engine.ingest(netEvent('i2'));

    expect(detections.map((d) => d.instanceId)).toEqual(['i1', 'i2']);
    expect(detections[0].steps.map((s) => s.at)).toEqual([1000, 3000]);
    expect(detections[1].steps.map((s) => s.at)).toEqual([2000, 4000]);
    expect(engine.getStats()).toMatchObject({ opened: 2, completed: 2, slid: 0, openNow: 0 });
  });
});

describe('sequence-engine gate — caps (m4)', () => {
  it('the (MAX_OPEN_PER_RULE + 1)th instance under one rule evicts the oldest, counted and warned', () => {
    start([ruleAB()]);

    for (let i = 1; i <= DEFAULT_PER_RULE + 1; i += 1) {
      at(i * 10);
      engine.ingest(fileEvent(`i${i}`));
    }

    expect(engine.getStats()).toMatchObject({
      opened: DEFAULT_PER_RULE + 1,
      evicted: 1,
      expired: 0,
      openNow: DEFAULT_PER_RULE,
      peakOpen: DEFAULT_PER_RULE,
    });
    expect(engine.getStats().rules.SEQ001).toMatchObject({
      opened: DEFAULT_PER_RULE + 1,
      evicted: 1,
      openNow: DEFAULT_PER_RULE,
      peakOpen: DEFAULT_PER_RULE,
    });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][2]).toMatchObject({
      reason: 'cap-evicted',
      rule: 'SEQ001',
      cap: 'per-rule',
      limit: DEFAULT_PER_RULE,
    });

    // i1 is the one that went: its B completes nothing, while i2's does.
    at(5000);
    engine.ingest(netEvent('i1'));
    engine.ingest(netEvent('i2'));
    expect(detections.map((d) => d.instanceId)).toEqual(['i2']);
  });
});
