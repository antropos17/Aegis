/**
 * @file tests/main/bench/join.test.js
 * @description `join.js` turns two files nobody disputes into the first numbers
 *   the project will publish, so what is pinned here is not "the join works" but
 *   the specific ways a wrong join would produce a plausible number:
 *
 *   - an observation counted twice, cancelling two expectations;
 *   - a nearer pairing losing to a farther one;
 *   - a stamping artefact (an observation stamped before its expectation) or a
 *     window artefact (one past the bound) scoring as a coverage miss with no
 *     trace of what it actually was;
 *   - a structurally unobservable category reported as `0/N` next to a real
 *     `0/N`, so the reader cannot tell "the sensor missed it" from "the sensor
 *     was never shown it";
 *   - a Windows path failing to match itself because one side spelled it in
 *     lower case or with forward slashes.
 *
 *   The last block is a gate on the module rather than on its output:
 *   `bench/lib/join.js` may not touch the filesystem, and a join that could reach
 *   for a fact it was not handed is a different module from the one specified.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { describe, it, expect } from 'vitest';

import join from '../../../bench/lib/join.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const JOIN_SOURCE = path.resolve(HERE, '..', '..', '..', 'bench', 'lib', 'join.js');

/** @type {string} A path in the shape the bench actually records. */
const STAGE_EXE = 'X:\\dev\\project\\AEGIS\\bench\\runs\\R\\stage\\claude.exe';

/** @type {{value: number, source: string}} 10 s × 3, as an arm-A run derives it. */
const BOUND = Object.freeze({
  value: 30000,
  source: '10 s × 3 scan intervals — scanIntervalSec in <profile>\\settings.json',
});

/**
 * One catalogue line, in the minimal ECS subset `catalogue.js` writes.
 * @param {Object} o
 * @param {string} o.ts - `@timestamp`.
 * @param {string} o.category - `process` or `file`.
 * @param {string} o.type - `start`, `end`, `creation` or `deletion`.
 * @param {number} [o.pid]
 * @param {string} [o.filePath]
 * @param {string} [o.step]
 * @param {string} [o.expectId]
 * @returns {Object}
 */
function expectedEvent(o) {
  const doc = {
    '@timestamp': o.ts,
    ecs: { version: '8.11.0' },
    event: { kind: 'event', category: [o.category], type: [o.type], action: `${o.category}-x` },
    bench: { scenario: 'S1', step: o.step ?? 'step', expect: o.expectId ?? 'E' },
  };
  if (o.filePath) doc.file = { path: o.filePath, name: 'claude.exe', directory: 'd' };
  // A file line carries the actor's own pid, exactly as the catalogue writes it —
  // the join must key a file on its path regardless.
  if (o.pid) doc.process = { pid: o.pid };
  return doc;
}

/**
 * One observed line, in the shape `observed.js` derives from an audit record.
 * @param {Object} o
 * @param {string} o.ts
 * @param {string} o.category
 * @param {string} o.type
 * @param {number} [o.pid]
 * @param {string} [o.filePath]
 * @param {number} [o.seq]
 * @returns {Object}
 */
function observedEvent(o) {
  const doc = {
    '@timestamp': o.ts,
    ecs: { version: '8.11.0' },
    event: { kind: 'event', category: [o.category], type: [o.type], action: `${o.category}-x` },
    bench: {
      scenario: 'S1',
      source: 'aegis-audit',
      auditFile: 'aegis-audit-2026-08-13.json',
      auditSeq: o.seq ?? 0,
      auditType: o.category === 'process' ? 'agent-enter' : 'file-access',
    },
  };
  if (o.filePath) doc.file = { path: o.filePath, name: 'claude.exe', directory: 'd' };
  if (o.pid) doc.process = { pid: o.pid };
  return doc;
}

/**
 * Build a report over the given events with the standard bound.
 * @param {Object[]} expectedEvents
 * @param {Object[]} observedEvents
 * @param {Object} [over] - Overrides for `buildReport`'s options.
 * @returns {Object}
 */
function report(expectedEvents, observedEvents, over = {}) {
  return join.buildReport({
    runId: 'R',
    scenario: 'S1',
    arm: 'A',
    expected: expectedEvents,
    observed: observedEvents,
    maxLatency: BOUND,
    ticksWhileProcessAlive: 3,
    ...over,
  });
}

describe('join — a pair inside the window', () => {
  it('matches a process expectation to an observation carrying the same pid', () => {
    const r = report(
      [
        expectedEvent({
          ts: '2026-08-13T17:27:22.274Z',
          category: 'process',
          type: 'start',
          pid: 44900,
        }),
      ],
      [
        observedEvent({
          ts: '2026-08-13T17:27:32.337Z',
          category: 'process',
          type: 'start',
          pid: 44900,
        }),
      ],
    );

    expect(r.matched).toHaveLength(1);
    expect(r.matched[0].key).toBe('pid:44900');
    expect(r.matched[0].latencyMs).toBe(10063);
    expect(r.categories['process/start'].recall).toBe('1/1');
    expect(r.categories['process/start'].recallValue).toBe(1);
    expect(r.categories['process/start'].latencyMs.p50).toBe(10063);
    expect(r.categories['process/start'].latencyMs.max).toBe(10063);
    expect(r.unmatchedObserved).toHaveLength(0);
    expect(r.missed).toHaveLength(0);
  });

  it('calls a one-point and a two-point latency a point, not a statistic', () => {
    const one = join.latencyBlock([7]);
    expect(one.p50).toBe(7);
    expect(one.basis).toMatch(/ARE those points, not statistics/);

    const many = join.latencyBlock([9, 1, 5, 3]);
    expect(many.points).toEqual([1, 3, 5, 9]);
    expect(many.p50).toBe(3);
    expect(many.max).toBe(9);
    expect(many.basis).toMatch(/nearest-rank/);
  });

  it('reports no recall number for a category the catalogue never expected', () => {
    const r = report(
      [
        expectedEvent({
          ts: '2026-08-13T17:27:22.274Z',
          category: 'process',
          type: 'start',
          pid: 1,
        }),
      ],
      [
        observedEvent({
          ts: '2026-08-13T17:27:23.000Z',
          category: 'process',
          type: 'start',
          pid: 1,
        }),
      ],
    );
    expect(r.categories['file/deletion'].expected).toBe(0);
    expect(r.categories['file/deletion'].recall).toBe('0/0');
    expect(r.categories['file/deletion'].recallValue).toBeNull();
    expect(r.categories['file/deletion'].recallUnavailable).toMatch(/is not 0/);
  });
});

describe('join — outside the window', () => {
  it('does not match an observation past maxLatency, and names the distance', () => {
    const r = report(
      [
        expectedEvent({
          ts: '2026-08-13T17:27:00.000Z',
          category: 'process',
          type: 'end',
          pid: 44900,
        }),
      ],
      [
        observedEvent({
          ts: '2026-08-13T17:27:30.001Z',
          category: 'process',
          type: 'end',
          pid: 44900,
        }),
      ],
    );

    expect(r.matched).toHaveLength(0);
    expect(r.categories['process/end'].recall).toBe('0/1');
    expect(r.categories['process/end'].recallValue).toBe(0);
    expect(r.missed[0].reason).toMatch(/arrived 30001 ms later, past the 30000 ms bound/);
    expect(r.unmatchedObserved).toHaveLength(1);
    expect(r.unmatchedObserved[0].reason).toMatch(/past the 30000 ms bound/);
  });

  it('names an observation stamped BEFORE its expectation as an artefact, not a miss', () => {
    const r = report(
      [
        expectedEvent({
          ts: '2026-08-13T17:27:22.190Z',
          category: 'file',
          type: 'creation',
          filePath: STAGE_EXE,
        }),
      ],
      [
        observedEvent({
          ts: '2026-08-13T17:27:22.150Z',
          category: 'file',
          type: 'creation',
          filePath: STAGE_EXE,
        }),
      ],
    );

    expect(r.matched).toHaveLength(0);
    expect(r.missed[0].reason).toMatch(/40 ms BEFORE the expectation/);
    expect(r.missed[0].reason).toMatch(/not a coverage result/);
    expect(r.unmatchedObserved[0].reason).toMatch(/40 ms BEFORE/);
  });
});

describe('join — cardinality', () => {
  it('gives an expectation the nearest of two candidates and lists the other', () => {
    const r = report(
      [
        expectedEvent({
          ts: '2026-08-13T17:27:00.000Z',
          category: 'process',
          type: 'start',
          pid: 7,
        }),
      ],
      [
        observedEvent({
          ts: '2026-08-13T17:27:20.000Z',
          category: 'process',
          type: 'start',
          pid: 7,
          seq: 1,
        }),
        observedEvent({
          ts: '2026-08-13T17:27:05.000Z',
          category: 'process',
          type: 'start',
          pid: 7,
          seq: 2,
        }),
      ],
    );

    expect(r.matched).toHaveLength(1);
    expect(r.matched[0].latencyMs).toBe(5000);
    expect(r.matched[0].observed.auditSeq).toBe(2);
    expect(r.unmatchedObserved).toHaveLength(1);
    expect(r.unmatchedObserved[0].observed.auditSeq).toBe(1);
  });

  it('lets one observation cancel one expectation and no more', () => {
    const r = report(
      [
        expectedEvent({
          ts: '2026-08-13T17:27:00.000Z',
          category: 'file',
          type: 'creation',
          filePath: STAGE_EXE,
          step: 'a',
        }),
        expectedEvent({
          ts: '2026-08-13T17:27:02.000Z',
          category: 'file',
          type: 'creation',
          filePath: STAGE_EXE,
          step: 'b',
        }),
      ],
      [
        observedEvent({
          ts: '2026-08-13T17:27:03.000Z',
          category: 'file',
          type: 'creation',
          filePath: STAGE_EXE,
        }),
      ],
    );

    expect(r.matched).toHaveLength(1);
    expect(r.matched[0].expected.step).toBe('b');
    expect(r.categories['file/creation'].recall).toBe('1/2');
    expect(r.categories['file/creation'].recallValue).toBe(0.5);
    expect(r.missed).toHaveLength(1);
    expect(r.missed[0].expected.step).toBe('a');
    expect(r.missed[0].reason).toMatch(/was taken by a nearer expectation/);
  });

  it('puts an observation the run never expected in the unmatched list', () => {
    const r = report(
      [
        expectedEvent({
          ts: '2026-08-13T17:27:00.000Z',
          category: 'process',
          type: 'start',
          pid: 7,
        }),
      ],
      [
        observedEvent({
          ts: '2026-08-13T17:27:01.000Z',
          category: 'process',
          type: 'start',
          pid: 7,
          seq: 1,
        }),
        observedEvent({
          ts: '2026-08-13T17:27:04.000Z',
          category: 'process',
          type: 'start',
          pid: 9999,
          seq: 2,
        }),
      ],
    );

    expect(r.matched).toHaveLength(1);
    expect(r.unmatchedObserved).toHaveLength(1);
    expect(r.unmatchedObserved[0].key).toBe('pid:9999');
    expect(r.unmatchedObserved[0].observed.auditSeq).toBe(2);
    expect(r.unmatchedObserved[0].reason).toMatch(/this run did not cause it/);
  });
});

describe('join — processObservable', () => {
  const expectedPair = [
    expectedEvent({ ts: '2026-08-13T17:27:00.000Z', category: 'process', type: 'start', pid: 7 }),
    expectedEvent({ ts: '2026-08-13T17:27:35.000Z', category: 'process', type: 'end', pid: 7 }),
  ];

  it('labels the process categories instead of scoring them when no tick fell inside', () => {
    const r = report(expectedPair, [], { ticksWhileProcessAlive: 0 });

    expect(r.processObservable).toBe(false);
    expect(r.categories['process/start'].recall).toBe('0/1 (structurally unobservable)');
    expect(r.categories['process/end'].recall).toBe('0/1 (structurally unobservable)');
    expect(r.categories['process/start'].recallValue).toBeNull();
    expect(r.categories['process/start'].recallUnavailable).toMatch(/never in front of the sensor/);
    expect(r.categories['process/start'].expected).toBe(1);
    expect(r.categories['process/start'].missed).toBe(1);
  });

  it('names the contradiction when a tickless run matched something anyway', () => {
    const r = report(
      [
        expectedEvent({
          ts: '2026-08-13T17:27:00.000Z',
          category: 'process',
          type: 'start',
          pid: 7,
        }),
      ],
      [
        observedEvent({
          ts: '2026-08-13T17:27:01.000Z',
          category: 'process',
          type: 'start',
          pid: 7,
        }),
      ],
      { ticksWhileProcessAlive: 0 },
    );

    expect(r.processObservable).toBe(false);
    expect(r.categories['process/start'].recall).toBe('1/1');
    expect(r.categories['process/start'].note).toMatch(/the two disagree/);
  });

  it('leaves processObservable null when the catalogue held no process lifetime', () => {
    const r = report([], [], { ticksWhileProcessAlive: null });
    expect(r.processObservable).toBeNull();
    expect(r.ticksWhileProcessAlive).toBeNull();
  });
});

describe('join — path normalisation', () => {
  it('folds case and separators to one form', () => {
    expect(join.normalizePath('X:/dev\\project//AEGIS\\')).toBe('x:\\dev\\project\\aegis');
    expect(join.normalizePath('X:\\')).toBe('x:\\');
    expect(join.normalizePath('  ')).toBeNull();
    expect(join.normalizePath(undefined)).toBeNull();
  });

  it('matches a file expectation to an observation spelled differently', () => {
    const r = report(
      [
        expectedEvent({
          ts: '2026-08-13T17:27:22.190Z',
          category: 'file',
          type: 'deletion',
          filePath: STAGE_EXE,
          pid: 44432,
        }),
      ],
      [
        observedEvent({
          ts: '2026-08-13T17:27:22.290Z',
          category: 'file',
          type: 'deletion',
          filePath: 'x:/dev/project/aegis/bench/runs/R/stage/CLAUDE.EXE',
        }),
      ],
    );

    expect(r.matched).toHaveLength(1);
    expect(r.matched[0].latencyMs).toBe(100);
    expect(r.matched[0].key).toBe(
      'path:x:\\dev\\project\\aegis\\bench\\runs\\r\\stage\\claude.exe',
    );
  });

  it('keys a file on its path even though the catalogue line carries a pid', () => {
    const file = expectedEvent({
      ts: '2026-08-13T17:27:22.190Z',
      category: 'file',
      type: 'creation',
      filePath: STAGE_EXE,
      pid: 44432,
    });
    expect(join.joinKeyOf(file, 'file/creation')).toMatch(/^path:/);
    expect(join.joinKeyOf(file, 'process/start')).toBe('pid:44432');
  });
});

describe('join — the bound itself', () => {
  it('refuses a bound that is not a positive number of milliseconds', () => {
    expect(() => report([], [], { maxLatency: { value: 0, source: 'x' } })).toThrow(join.JoinError);
    expect(() => report([], [], { maxLatency: { value: -1, source: 'x' } })).toThrow(
      /never defaulted/,
    );
  });

  it('performs no join at all when the interval could not be established', () => {
    const r = report(
      [
        expectedEvent({
          ts: '2026-08-13T17:27:00.000Z',
          category: 'process',
          type: 'start',
          pid: 7,
        }),
      ],
      [
        observedEvent({
          ts: '2026-08-13T17:27:01.000Z',
          category: 'process',
          type: 'start',
          pid: 7,
        }),
      ],
      { maxLatency: { value: null, source: 'two sources tried', unavailable: 'neither answered' } },
    );

    expect(r.join.maxLatencyMs).toBeNull();
    expect(r.categories['process/start'].matched).toBeNull();
    expect(r.categories['process/start'].missed).toBeNull();
    expect(r.categories['process/start'].recallValue).toBeNull();
    expect(r.categories['process/start'].recall).toMatch(/^unavailable —/);
    expect(r.matched).toHaveLength(0);
    expect(r.unmatchedObserved).toHaveLength(1);
  });

  it('refuses an event whose @timestamp is not an instant', () => {
    expect(() =>
      report([expectedEvent({ ts: 'yesterday', category: 'process', type: 'start', pid: 7 })], []),
    ).toThrow(/not a UTC instant/);
  });
});

describe('join — what the report may not contain', () => {
  it('carries no numeric confidence figure', () => {
    const r = report(
      [
        expectedEvent({
          ts: '2026-08-13T17:27:00.000Z',
          category: 'process',
          type: 'start',
          pid: 7,
        }),
      ],
      [
        observedEvent({
          ts: '2026-08-13T17:27:01.000Z',
          category: 'process',
          type: 'start',
          pid: 7,
        }),
      ],
    );
    expect(JSON.stringify(r)).not.toMatch(/"confidence"\s*:\s*-?\d/);
    expect(r.join.noConfidenceFigure).toMatch(/no confidence score/);
  });

  it('reads and writes no files — the module requires no filesystem at all', () => {
    const source = fs.readFileSync(JOIN_SOURCE, 'utf8');
    expect(source).not.toMatch(/require\(\s*['"](fs|fs\/promises|path|os|child_process)['"]\s*\)/);
    expect(source).not.toMatch(/readFileSync|writeFileSync|readdirSync|existsSync/);
  });
});
