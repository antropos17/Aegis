import { afterEach, expect, it, vi } from 'vitest';
import lineage from '../../src/main/process-lineage.js';
import processUtils from '../../src/main/process-utils.js';
const rows = () => [
  { pid: 10, agent: 'A', process: 'a', startTime: 100, instanceId: 'p', instanceIdSource: 'os' },
  { pid: 20, agent: 'B', process: 'b', startTime: 200, instanceId: 'c', instanceIdSource: 'os' },
];
const map = () =>
  new Map([
    [10, { ppid: 1, startTime: 100 }],
    [20, { ppid: 10, startTime: 200 }],
  ]);
afterEach(() => {
  processUtils._resetForTest();
  vi.restoreAllMocks();
});
it('uses the fresh PPID and copied identities across differently named agents', () => {
  const agents = rows();
  lineage.annotateParentRelations(agents, map());
  expect(agents[1].parentRelation).toEqual({
    parentPid: 10,
    parentInstanceId: 'p',
    source: 'fresh-process-table',
  });
  expect(agents.map((a) => a.instanceId)).toEqual(['p', 'c']);
});
it.each(['unknown', 'synthetic'])('rejects %s identity and clears prior evidence', (source) => {
  const agents = rows();
  lineage.annotateParentRelations(agents, map());
  agents[0].instanceIdSource = source;
  lineage.annotateParentRelations(agents, map());
  expect(agents[1]).not.toHaveProperty('parentRelation');
});
it.each([200, 300, null])('rejects equal, newer or missing parent birth %s', (birth) => {
  const agents = rows(),
    observation = map();
  agents[0].startTime = birth;
  observation.get(10).startTime = birth;
  lineage.annotateParentRelations(agents, observation);
  expect(agents[1]).not.toHaveProperty('parentRelation');
});
it('rejects stale stamps, ambiguous PIDs, cycles and absent maps', () => {
  for (const mutate of [
    (a, m) => (m.get(10).startTime = 99),
    (a) => a.push({ ...a[0] }),
    (a, m) => (m.get(10).ppid = 20),
    (a, m) => m.delete(10),
  ]) {
    const a = rows(),
      m = map();
    mutate(a, m);
    lineage.annotateParentRelations(a, m);
    expect(a[1]).not.toHaveProperty('parentRelation');
  }
  const a = rows();
  lineage.annotateParentRelations(a, map());
  lineage.annotateParentRelations(a);
  expect(a[1]).not.toHaveProperty('parentRelation');
});
it('production enrichment stamps lineage from that same pass without another OS call or cached parents', async () => {
  const provider = vi.fn(async () => map());
  processUtils._setPlatformForTest({ providesStartTime: true, getParentProcessMap: provider });
  const a = rows();
  await processUtils.enrichWithParentChains(a);
  expect(provider).toHaveBeenCalledTimes(1);
  expect(a[1].parentRelation.parentInstanceId).toBe(a[0].instanceId);
  const second = map();
  second.get(20).ppid = 999;
  await processUtils.enrichWithParentChains(a, { processMap: second });
  expect(provider).toHaveBeenCalledTimes(1);
  expect(a[1]).not.toHaveProperty('parentRelation');
});
