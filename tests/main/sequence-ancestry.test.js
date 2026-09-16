import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const engine = require('../../src/main/sequence-engine');
const loader = require('../../src/main/sequence-rule-loader');
const logger = require('../../src/main/logger');
let at, detections;
const population = (count = 3) =>
  Array.from({ length: count }, (_, i) => ({
    pid: i + 10,
    instanceId: `instance:${i}`,
    instanceIdSource: 'os',
    ...(i
      ? {
          parentRelation: {
            parentPid: i + 9,
            parentInstanceId: `instance:${i - 1}`,
            source: 'fresh-process-table',
          },
        }
      : {}),
  }));
const file = (index = 0) => ({
  file: '/fixture/.env',
  action: 'accessed',
  pid: index + 10,
  instanceId: `instance:${index}`,
  agent: `Agent ${index}`,
  attribution: { status: 'confirmed', evidence: ['handle-scan-pid'] },
});
const tcp = (index = 2, patch = {}) => ({
  remoteIp: '203.0.113.1',
  remotePort: 8443,
  localIp: '192.0.2.1',
  localPort: 50000,
  pid: index + 10,
  instanceId: `instance:${index}`,
  agent: `Agent ${index}`,
  attribution: { status: 'confirmed', evidence: ['os-tcp-owner-pid'] },
  ...patch,
});
const ingest = (value) => {
  at += 1000;
  engine.ingest(value);
};
beforeEach(() => {
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  at = 10000;
  detections = [];
  engine.init({
    rules: loader.loadDir().rules,
    now: () => at,
    onDetection: (d) => detections.push(d),
  });
});
afterEach(() => vi.restoreAllMocks());

it('does not extend the original file window when a full path is refreshed', () => {
  engine.observePopulation(population(), true);
  ingest(file());
  for (let i = 0; i < 31; i++) {
    at += 10000;
    engine.observePopulation(population(), true);
  }
  ingest(tcp());
  expect(detections).toHaveLength(0);
  expect(engine.getStats().related.expired).toBeGreaterThan(0);
});

it('keeps the low ceiling even when an ancestor rule declares critical severity', () => {
  const rules = loader
    .loadDir()
    .rules.filter((r) => r.id === 'SEQ003')
    .map((r) => ({ ...r, level: 'critical' }));
  engine.init({ rules, now: () => at, onDetection: (d) => detections.push(d) });
  engine.observePopulation(population(), true);
  ingest(file());
  ingest(tcp());
  expect(detections[0].level).toBe('low');
  expect(detections[0].assessment.limitations).toContain('bounded-ancestry-only');
});

it('retains the complete observed ancestor path and the two actual event actors', () => {
  engine.observePopulation(population(), true);
  ingest(file());
  ingest(tcp());
  expect(detections).toHaveLength(1);
  expect(detections[0]).toMatchObject({
    ruleId: 'SEQ003',
    level: 'low',
    instanceId: 'instance:2',
    relationship: {
      path: population().map(({ pid, instanceId }) => ({ pid, instanceId })),
      causalLink: 'unproven',
    },
    steps: [{ instanceId: 'instance:0' }, { instanceId: 'instance:2' }],
  });
  expect(engine.scoreFor('instance:0')).toBe(0);
  expect(engine.scoreFor('instance:1')).toBe(0);
  expect(engine.scoreFor('instance:2')).toBe(30);
});

it('supports descendant-file to ancestor-TCP without assigning events to the intermediate process', () => {
  engine.observePopulation(population(), true);
  ingest(file(2));
  ingest(tcp(0));
  expect(detections.map((d) => d.ruleId)).toEqual(['SEQ003']);
  expect(detections[0].steps.map((s) => s.instanceId)).toEqual(['instance:2', 'instance:0']);
  expect(detections[0].relationship.path.map((s) => s.instanceId)).toEqual([
    'instance:0',
    'instance:1',
    'instance:2',
  ]);
});

it.each([2, 3, 4, 5])('covers exactly two to four parent hops (requested %i)', (hops) => {
  engine.observePopulation(population(hops + 1), true);
  ingest(file());
  ingest(tcp(hops));
  expect(detections).toHaveLength(hops <= 4 ? 1 : 0);
  if (hops <= 4) expect(detections[0].relationship.path).toHaveLength(hops + 1);
});

it.each(['missing', 'unknown', 'recycled', 'exit', 'reparented', 'failed', 'stale'])(
  'discards the whole anchor after an intermediate %s observation',
  (mode) => {
    engine.observePopulation(population(), true);
    ingest(file());
    const next = population();
    if (mode === 'missing') next.splice(1, 1);
    if (mode === 'unknown') next[1].instanceIdSource = 'fallback';
    if (mode === 'recycled') {
      next[1].instanceId = 'replacement';
      next[2].parentRelation.parentInstanceId = 'replacement';
    }
    if (mode === 'reparented') {
      next[2].parentRelation = { ...next[1].parentRelation };
    }
    if (mode === 'exit') ingest({ type: 'agent-exit', instanceId: 'instance:1', pid: 11 });
    else if (mode === 'stale') {
      at += 30001;
      engine.sweep();
    } else engine.observePopulation(next, mode !== 'failed');
    // Restoring the same path must never restore its earlier file anchor.
    engine.observePopulation(population(), true);
    ingest(tcp());
    expect(detections).toHaveLength(0);
  },
);

it('requires the identical full path at both events, even when endpoints persist', () => {
  const before = population(4);
  before[3].parentRelation = { ...before[1].parentRelation };
  engine.observePopulation(before, true);
  ingest(file());
  const after = before.map((row) => ({ ...row }));
  after[2].parentRelation = {
    parentPid: 13,
    parentInstanceId: 'instance:3',
    source: 'fresh-process-table',
  };
  engine.observePopulation(after, true);
  ingest(tcp());
  expect(detections).toHaveLength(0);
});

it('does not treat siblings or a direct edge as an indirect path', () => {
  const rows = population();
  rows[2].parentRelation = { ...rows[1].parentRelation };
  engine.observePopulation(rows, true);
  ingest(file(1));
  ingest(tcp(2));
  expect(detections).toHaveLength(0);
  ingest(file());
  ingest(tcp(2));
  expect(detections.map((d) => d.ruleId)).toEqual(['SEQ002']);
});

it('keeps old TCP tuples informational and permits a stronger new tuple once', () => {
  engine.observePopulation(population(), true);
  ingest(tcp());
  ingest(file());
  ingest(tcp());
  expect(detections.map((d) => d.level)).toEqual(['informational']);
  ingest(tcp(2, { localPort: 50001 }));
  ingest(tcp(2, { localPort: 50002 }));
  expect(detections.map((d) => d.level)).toEqual(['informational', 'low']);
});

it('does not promote missing ownership or copy intermediate payloads', () => {
  const rows = population();
  rows[1].command = 'DO-NOT-RETAIN';
  rows[1].token = 'DO-NOT-RETAIN';
  engine.observePopulation(rows, true);
  ingest(file());
  ingest(tcp(2, { attribution: undefined }));
  expect(detections[0].attribution.status).toBe('unattributed');
  expect(detections[0].level).toBe('low');
  expect(JSON.stringify(detections)).not.toContain('DO-NOT-RETAIN');
});

it('bounds expanded paths and retains direct rules when path fanout is exhausted', () => {
  engine.observePopulation(population(600), true);
  expect(engine.getStats().related.edges).toBe(1024);
  expect(engine.getStats().related.droppedEdges).toBeGreaterThan(0);
  expect(engine.getStats().related.maxHops).toBe(4);
  ingest(file(598));
  ingest(tcp(599));
  expect(detections.map((d) => d.ruleId)).toEqual(['SEQ002']);
});

it('cannot construct repeated-node ancestor paths from a cycle', () => {
  const rows = population(2);
  rows[0].parentRelation = {
    parentPid: 11,
    parentInstanceId: 'instance:1',
    source: 'fresh-process-table',
  };
  engine.observePopulation(rows, true);
  ingest(file());
  ingest(tcp(1));
  expect(detections.every((d) => d.ruleId !== 'SEQ003')).toBe(true);
});
