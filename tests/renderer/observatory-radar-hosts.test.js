import { expect, it } from 'vitest';
import { radarGroups } from '../../frontend/observatory/runtime/radar';
import { radarHostClusters } from '../../frontend/observatory/runtime/radar-hosts';
import { emptyTelemetry, instances } from '../../frontend/observatory/runtime/host';

const host = {
  source: 'fresh-process-table',
  pid: 99,
  startTime: 1000,
  generationWitnessSource: 'sequence',
  generationWitness: '42',
  label: 'VS Code',
};
const agent = (name, pid, observedHostEditor = host) => ({
  agent: name,
  process: 'agent.exe',
  pid,
  instanceId: `${pid}:now`,
  instanceIdSource: 'os',
  observedHostEditor,
});
const state = (agents) => ({ ...emptyTelemetry(), ready: true, stale: false, agents });
const clusters = (s, page = 0) =>
  radarHostClusters(s, radarGroups(instances(s)).slice(page * 4, page * 4 + 4));

it('joins exact observed hosts across products while retaining product membership and risks', () => {
  const s = state([agent('Codex', 1), agent('Cursor', 2)]);
  expect(clusters(s)).toMatchObject([{ pid: 99, label: 'VS Code', products: ['Codex', 'Cursor'] }]);
  expect(radarGroups(instances(s)).map((g) => g.members.length)).toEqual([1, 1]);
});
it.each(['pid', 'startTime', 'generationWitness', 'generationWitnessSource', 'source'])(
  'rejects changed %s even with the same editor label',
  (field) => {
    const value = {
      pid: 100,
      startTime: 1001,
      generationWitness: '43',
      generationWitnessSource: 'createTime100ns',
      source: 'cached',
    }[field];
    expect(
      clusters(state([agent('Codex', 1), agent('Cursor', 2, { ...host, [field]: value })])),
    ).toEqual([]);
  },
);
it('rejects missing, mixed, duplicate, synthetic, stale and weak observations', () => {
  for (const invalid of [
    undefined,
    { ...host, generationWitnessSource: 'startTimeMs' },
    { ...host, generationWitness: '' },
  ]) {
    const row = agent('Codex', 3);
    row.observedHostEditor = invalid;
    expect(clusters(state([agent('Codex', 1), row, agent('Cursor', 2)]))).toEqual([]);
  }
  for (const patch of [
    { instanceIdSource: 'synthetic' },
    { instanceId: 'demo:observatory:1' },
    { discoveryObservation: { stale: true } },
    { instanceId: '1:now' },
  ]) {
    expect(clusters(state([agent('Codex', 1), { ...agent('Cursor', 2), ...patch }]))).toEqual([]);
  }
  expect(
    clusters(
      state([agent('Codex', 1), agent('Codex', 3, { ...host, pid: 100 }), agent('Cursor', 2)]),
    ),
  ).toEqual([]);
});
it('derives after slicing and retains the displayed stale snapshot', () => {
  const s = state([
    agent('A', 1),
    agent('B', 2, undefined),
    agent('C', 3, undefined),
    agent('D', 4, undefined),
    agent('E', 5),
  ]);
  s.agents.slice(1, 4).forEach((row) => delete row.observedHostEditor);
  expect(clusters(s)).toEqual([]);
  expect(clusters(s, 1)).toEqual([]);
  expect(clusters({ ...state([agent('Codex', 1), agent('Cursor', 2)]), stale: true })).toHaveLength(
    1,
  );
});
