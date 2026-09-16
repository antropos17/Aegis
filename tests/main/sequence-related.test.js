import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const engine = require('../../src/main/sequence-engine');
const loader = require('../../src/main/sequence-rule-loader');
const logger = require('../../src/main/logger');
let at, detections;
const agents = () => [
  { pid: 10, instanceId: 'parent:one', instanceIdSource: 'os', agent: 'Parent agent' },
  {
    pid: 20,
    instanceId: 'child:one',
    instanceIdSource: 'os',
    agent: 'Child agent',
    parentRelation: {
      parentPid: 10,
      parentInstanceId: 'parent:one',
      source: 'fresh-process-table',
    },
  },
];
const file = (patch = {}) => ({
  file: '/fixture/.env',
  action: 'accessed',
  timestamp: 1000,
  pid: 10,
  instanceId: 'parent:one',
  agent: 'Parent agent',
  attribution: { status: 'confirmed', evidence: ['handle-scan-pid'] },
  ...patch,
});
const tcp = (patch = {}) => ({
  remoteIp: '203.0.113.1',
  remotePort: 8443,
  localIp: '192.0.2.1',
  localPort: 50000,
  pid: 20,
  instanceId: 'child:one',
  agent: 'Child agent',
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
it('correlates direct relatives while retaining each actual actor and limiting the score', () => {
  engine.observePopulation(agents(), true);
  ingest(file());
  ingest(tcp());
  expect(detections).toHaveLength(1);
  expect(detections[0]).toMatchObject({
    ruleId: 'SEQ002',
    level: 'low',
    instanceId: 'child:one',
    relationship: { parentInstanceId: 'parent:one', childInstanceId: 'child:one' },
    steps: [{ instanceId: 'parent:one' }, { instanceId: 'child:one' }],
  });
  expect(engine.scoreFor('parent:one')).toBe(0);
  expect(engine.scoreFor('child:one')).toBe(30);
});

it('supports child-file to parent-network without attributing the file to the parent', () => {
  engine.observePopulation(agents(), true);
  ingest(file({ pid: 20, instanceId: 'child:one', agent: 'Child agent' }));
  ingest(tcp({ pid: 10, instanceId: 'parent:one', agent: 'Parent agent' }));
  expect(detections[0]).toMatchObject({
    instanceId: 'parent:one',
    steps: [{ agent: 'Child agent' }, { agent: 'Parent agent' }],
  });
});
it('retains both same-instance and related-instance rules independently', () => {
  engine.observePopulation(agents(), true);
  ingest(file());
  ingest(file({ pid: 20, instanceId: 'child:one' }));
  ingest(tcp());
  expect(detections.map((d) => d.ruleId)).toEqual(['SEQ001', 'SEQ002']);
  expect(engine.scoreFor('child:one')).toBe(55);
});
it('old sockets do not hide new sockets, and repeats do not prolong a score', () => {
  engine.observePopulation(agents(), true);
  ingest(tcp());
  ingest(file());
  ingest(tcp());
  ingest(tcp());
  expect(detections.map((d) => d.level)).toEqual(['informational']);
  ingest(tcp({ localPort: 50001 }));
  const scoredAt = at;
  ingest(tcp({ localPort: 50002 }));
  expect(detections.map((d) => d.level)).toEqual(['informational', 'low']);
  at = scoredAt + 600001;
  expect(engine.scoreFor('child:one')).toBe(0);
});
it.each([
  'unreliable',
  'stale',
  'exit',
  'recycle',
  'relationship-change',
  'clock-backwards',
  'reset',
])('discards related evidence after %s', (mode) => {
  engine.observePopulation(agents(), true);
  ingest(file());
  if (mode === 'unreliable') engine.observePopulation([], false);
  if (mode === 'stale') at += 30001;
  if (mode === 'exit') ingest({ type: 'agent-exit', instanceId: 'parent:one', pid: 10 });
  if (mode === 'recycle') {
    const a = agents();
    a[0].instanceId = 'parent:two';
    engine.observePopulation(a, true);
  }
  if (mode === 'relationship-change') {
    const a = agents();
    delete a[1].parentRelation;
    engine.observePopulation(a, true);
  }
  if (mode === 'clock-backwards') at = 1;
  if (mode === 'reset') engine.reset('reload');
  ingest(tcp());
  expect(detections).toEqual([]);
  engine.observePopulation(agents(), true);
  ingest(tcp());
  expect(detections).toEqual([]);
});
it('requires a relationship at both event times; names, cwd and application groups do not suffice', () => {
  ingest(file());
  engine.observePopulation(agents(), true);
  ingest(tcp());
  expect(detections).toEqual([]);
  const a = agents();
  delete a[1].parentRelation;
  a.forEach((x) => {
    x.agent = 'Same name';
    x.cwd = '/same';
    x.applicationGroup = { id: 'same' };
  });
  engine.observePopulation(a, true);
  ingest(file());
  ingest(tcp());
  expect(detections).toEqual([]);
});
it('refuses mismatched event PID and incomplete owner evidence stays unattributed', () => {
  engine.observePopulation(agents(), true);
  ingest(file());
  ingest(tcp({ pid: 999 }));
  expect(detections).toEqual([]);
  ingest(tcp({ attribution: null }));
  expect(detections[0]).toMatchObject({ level: 'low', attribution: { status: 'unattributed' } });
});
it('does not join siblings, indirect relatives, or an unstamped population', () => {
  const a = agents();
  a.push({ ...a[1], pid: 30, instanceId: 'sibling' });
  engine.observePopulation(a, true);
  ingest(file({ pid: 30, instanceId: 'sibling' }));
  ingest(tcp());
  expect(detections).toEqual([]);
  a[0].instanceIdSource = 'unknown';
  engine.observePopulation(a, true);
  ingest(file());
  ingest(tcp());
  expect(detections).toEqual([]);
});
it('reports relation caps and does not create unbounded fanout', () => {
  const [parent, child] = agents();
  const a = [
    parent,
    ...Array.from({ length: 80 }, (_, i) => ({ ...child, pid: 20 + i, instanceId: 'c:' + i })),
  ];
  engine.observePopulation(a, true);
  expect(engine.getStats().related).toMatchObject({ edges: 64, droppedEdges: 16 });
  engine.observePopulation(
    Array.from({ length: 4097 }, () => parent),
    true,
  );
  expect(engine.getStats().related.edges).toBe(0);
});
it('expires the original file window even with continuous fresh relationship observations', () => {
  engine.observePopulation(agents(), true);
  ingest(file());
  for (let i = 0; i < 31; i++) {
    at += 10000;
    engine.observePopulation(agents(), true);
  }
  ingest(tcp());
  expect(detections).toEqual([]);
  expect(engine.getStats().related.expired).toBe(1);
});

it('bounds pending file anchors without allowing an evicted source to complete', () => {
  const a = [],
    files = [],
    sockets = [];
  for (let i = 0; i < 260; i++) {
    const p = 1000 + i * 2,
      c = p + 1;
    a.push(
      { pid: p, instanceId: 'p:' + i, instanceIdSource: 'os' },
      {
        pid: c,
        instanceId: 'c:' + i,
        instanceIdSource: 'os',
        parentRelation: { parentPid: p, parentInstanceId: 'p:' + i, source: 'fresh-process-table' },
      },
    );
    files.push(file({ pid: p, instanceId: 'p:' + i }));
    sockets.push(tcp({ pid: c, instanceId: 'c:' + i }));
  }
  engine.observePopulation(a, true);
  for (const value of files) {
    at++;
    engine.ingest(value);
  }
  expect(engine.getStats().related).toMatchObject({ pending: 256, evicted: 4 });
  ingest(sockets[0]);
  expect(detections).toEqual([]);
  ingest(sockets[259]);
  expect(detections).toHaveLength(1);
});

it.each(['siblings', 'null', '[direct-parent-child]'])(
  'rejects unsupported relationship %s',
  (relationship) => {
    const source = fs.readFileSync(loader.DEFAULT_SEQUENCES_DIR + '/sequences.yaml', 'utf8');
    expect(
      loader.loadFromString(
        source.replace('relationship: direct-parent-child', 'relationship: ' + relationship),
      ).rules,
    ).toEqual([]);
  },
);
it('requires the evidence policy for a related rule and preserves metadata allowlisting', () => {
  const source = fs.readFileSync(loader.DEFAULT_SEQUENCES_DIR + '/sequences.yaml', 'utf8');
  expect(
    loader.loadFromString(source.replaceAll('evidence-policy: credential-egress-v1', '')).rules,
  ).toEqual([]);
  engine.observePopulation(agents(), true);
  ingest(file({ contents: 'DO-NOT-RETAIN' }));
  ingest(tcp({ payload: 'DO-NOT-RETAIN' }));
  expect(JSON.stringify(detections)).not.toContain('DO-NOT-RETAIN');
});
