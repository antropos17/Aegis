import { afterEach, expect, it, vi } from 'vitest';
import utils from '../../src/main/process-utils.js';

const row = (name, ppid, startTime, witness = String(startTime)) => ({
  name,
  ppid,
  startTime,
  witness,
  witnessSource: 'createTime100ns',
});
const map = () =>
  new Map([
    [10, row('code.exe', 0, 100)],
    [20, row('powershell.exe', 10, 200)],
    [30, row('claude.exe', 20, 300)],
    [40, row('codex.exe', 10, 400)],
  ]);
const agents = () => [
  { pid: 30, process: 'claude.exe', agent: 'Claude' },
  { pid: 40, process: 'codex.exe', agent: 'Codex' },
];
afterEach(() => {
  utils._resetForTest();
  vi.restoreAllMocks();
});

it.each(['constructor', '__proto__'])(
  'walks past inherited label key %s to the real editor',
  async (name) => {
    utils._setPlatformForTest({ providesStartTime: true });
    const a = agents(),
      m = map();
    m.get(20).name = name;
    await utils.enrichWithParentChains(a, { processMap: m });
    expect(a[0].observedHostEditor.pid).toBe(10);
    expect(a[0].observedHostEditor.label).toBe('VS Code');
    m.get(10).name = 'bash';
    await utils.enrichWithParentChains(a, { processMap: m });
    expect(a[0]).not.toHaveProperty('observedHostEditor');
  },
);

it('retains valid sequence witnesses', async () => {
  utils._setPlatformForTest({ providesStartTime: true });
  const a = agents(),
    m = map();
  for (const entry of m.values()) entry.witnessSource = 'sequence';
  await utils.enrichWithParentChains(a, { processMap: m });
  expect(a[0].observedHostEditor.generationWitnessSource).toBe('sequence');
});

it.each([
  ['sequence', 'not-a-number'],
  ['createTime100ns', '0'],
  ['linuxStartTicks', '123'],
  ['unknown', '100'],
])('rejects invalid %s witness %s', async (source, witness) => {
  utils._setPlatformForTest({ providesStartTime: true });
  const a = agents(),
    m = map();
  m.get(10).witnessSource = source;
  m.get(10).witness = witness;
  await utils.enrichWithParentChains(a, { processMap: m });
  expect(a[0]).not.toHaveProperty('observedHostEditor');
});

it('omits metadata when the editor lies beyond the bounded ancestry walk', async () => {
  utils._setPlatformForTest({ providesStartTime: true });
  const m = new Map();
  for (let pid = 1; pid <= 66; pid++)
    m.set(pid, row(pid === 1 ? 'code.exe' : 'shell', pid - 1, pid * 100));
  const a = [{ pid: 66, process: 'shell', agent: 'Agent' }];
  await utils.enrichWithParentChains(a, { processMap: m });
  expect(a[0]).not.toHaveProperty('observedHostEditor');
});

it('retains Linux boot-bound witnesses and selects the nearest recognized editor', async () => {
  utils._setPlatformForTest({ providesStartTime: true });
  const a = agents(),
    m = map();
  for (const entry of m.values()) {
    entry.witnessSource = 'linuxStartTicks';
    entry.witness = `12345678-1234-1234-1234-123456789abc:${entry.startTime}`;
  }
  m.get(20).name = 'webstorm';
  await utils.enrichWithParentChains(a, { processMap: m });
  expect(a[0].observedHostEditor.pid).toBe(20);
  expect(a[0].observedHostEditor.generationWitnessSource).toBe('linuxStartTicks');
  expect(a[1].observedHostEditor.pid).toBe(10);
});

it('clears previously observed metadata on platforms without per-pass birth observation', async () => {
  utils._setPlatformForTest({ providesStartTime: true });
  const a = agents();
  await utils.enrichWithParentChains(a, { processMap: map() });
  expect(a[0]).toHaveProperty('observedHostEditor');
  utils._setPlatformForTest({
    providesStartTime: false,
    getParentProcessMap: vi.fn(async () => map()),
  });
  await utils.enrichWithParentChains(a);
  expect(a[0]).not.toHaveProperty('observedHostEditor');
});

it('joins cross-product siblings through intermediaries using one fresh provider call', async () => {
  const provider = vi.fn(async () => map());
  utils._setPlatformForTest({ providesStartTime: true, getParentProcessMap: provider });
  const a = agents();
  await utils.enrichWithParentChains(a);
  expect(a[0].observedHostEditor).toEqual({
    pid: 10,
    label: 'VS Code',
    startTime: 100,
    generationWitness: '100',
    generationWitnessSource: 'createTime100ns',
    source: 'fresh-process-table',
  });
  expect(a[1].observedHostEditor).toEqual(a[0].observedHostEditor);
  expect(provider).toHaveBeenCalledTimes(1);
});
it('separates identical labels and same-ms editor lifetime reuse despite cached parent names', async () => {
  utils._setPlatformForTest({ providesStartTime: true });
  const a = agents(),
    m = map();
  await utils.enrichWithParentChains(a, { processMap: m });
  const old = a[0].observedHostEditor;
  m.get(10).witness = '101';
  await utils.enrichWithParentChains(a, { processMap: m });
  expect(a[0].observedHostEditor).not.toEqual(old);
  m.set(11, row('code.exe', 0, 101));
  m.get(40).ppid = 11;
  await utils.enrichWithParentChains(a, { processMap: m });
  expect(a[0].observedHostEditor).not.toEqual(a[1].observedHostEditor);
});
it.each([
  [
    'shell only',
    (m) => {
      m.get(10).name = 'bash';
    },
  ],
  [
    'missing edge',
    (m) => {
      m.delete(20);
    },
  ],
  [
    'parent reuse',
    (m) => {
      m.get(20).startTime = 350;
    },
  ],
  [
    'equal parent birth',
    (m) => {
      m.get(20).startTime = 300;
    },
  ],
  [
    'unknown birth',
    (m) => {
      m.get(20).startTime = null;
    },
  ],
  [
    'weak witness',
    (m) => {
      m.get(10).witnessSource = 'startTimeMs';
    },
  ],
  [
    'cycle',
    (m) => {
      m.get(10).ppid = 30;
    },
  ],
])('rejects %s and clears previous metadata', async (_, mutate) => {
  utils._setPlatformForTest({ providesStartTime: true });
  const a = agents(),
    m = map();
  await utils.enrichWithParentChains(a, { processMap: m });
  expect(a[0]).toHaveProperty('observedHostEditor');
  mutate(m);
  await utils.enrichWithParentChains(a, { processMap: m });
  expect(a[0]).not.toHaveProperty('observedHostEditor');
});
it('rejects stale stamps, duplicate records, synthetic records and absent observations', async () => {
  utils._setPlatformForTest({ providesStartTime: true });
  for (const mutate of [
    (a) => {
      a[0].startTime++;
    },
    (a) => {
      a[0].generationWitness = 'stale';
    },
    (a) => {
      a.push({ ...a[0] });
    },
    (a) => {
      a[0].instanceIdSource = 'synthetic';
    },
    (a) => {
      a[0]._demo = true;
    },
  ]) {
    const a = agents(),
      m = map();
    await utils.enrichWithParentChains(a, { processMap: m });
    mutate(a);
    utils.annotateObservedHostEditors(a, m);
    expect(a[0]).not.toHaveProperty('observedHostEditor');
  }
  const a = agents();
  await utils.enrichWithParentChains(a, { processMap: map() });
  utils.annotateObservedHostEditors(a);
  expect(a[0]).not.toHaveProperty('observedHostEditor');
});
