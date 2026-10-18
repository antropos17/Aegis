import { describe, expect, it } from 'vitest';
import attribution from '../../../src/main/platform/etw-file-attribution.js';
import { observation } from './etw-file-fixtures.js';

const birth = '134333333333333337';
const agent = {
  pid: 71,
  agent: 'Claude Code',
  createTime100ns: birth,
  instanceId: '71:1788859733333',
  instanceIdSource: 'os',
};
const read = (overrides = {}) =>
  observation({
    qpc: '110',
    path: 'C:\\fixture\\.env.test',
    pathEvidence: 'candidate-object',
    issuerStatus: 'verified',
    issuerPid: 71,
    issuerInterval: { fromQpc: '100', toQpc: '120' },
    generationStatus: 'verified',
    generationWitness: birth,
    generationSource: 'createTime100ns',
    generationInterval: { fromQpc: '115', toQpc: '120' },
    ...overrides,
  });
const create = (overrides = {}) =>
  attribution.createReadView({
    getAgents: () => [agent],
    getHealth: () => ({ populationReliable: true, identityDegraded: false }),
    classifySensitive: () => 'Environment variables may contain credentials',
    now: () => 1000,
    ...overrides,
  });
describe('scoped read observations for the desktop', () => {
  it('shows a rule-based potential risk while preserving candidate path evidence', () => {
    const view = create();
    view.accept([read()]);
    expect(view.snapshot().reads).toEqual([
      {
        id: '1',
        agent: 'Claude Code',
        instanceId: agent.instanceId,
        pid: 71,
        path: 'C:\\fixture\\.env.test',
        pathEvidence: 'candidate-object',
        sensitiveReason: 'Environment variables may contain credentials',
        reads: 1,
        observedAt: 1000,
      },
    ]);
    expect(JSON.stringify(view.snapshot())).not.toMatch(
      /generationWitness|headerPid|issuerInterval|eventSeq/,
    );
  });
  it('retains only the attribution observed at intake, including after process exit', () => {
    let agents = [agent];
    const view = create({ getAgents: () => agents });
    view.accept([read()]);
    agents = [];
    expect(view.snapshot().reads[0].agent).toBe('Claude Code');
    const unknown = create({ getHealth: () => ({ populationReliable: false }) });
    unknown.accept([read()]);
    expect(unknown.snapshot().reads[0]).toMatchObject({ agent: null, instanceId: null, pid: null });
  });
  it('never borrows a same-ms PID witness or labels a first unverified issuer', () => {
    const view = create({ getAgents: () => [{ ...agent, createTime100ns: '134333333333333338' }] });
    view.accept([read()]);
    expect(view.snapshot().reads[0].agent).toBeNull();
    const candidate = create();
    candidate.accept([
      read({
        issuerStatus: 'candidate',
        issuerPid: null,
        issuerInterval: null,
        generationStatus: 'unresolved',
        generationWitness: null,
        generationSource: null,
        generationInterval: null,
      }),
    ]);
    expect(candidate.snapshot().reads[0].agent).toBeNull();
  });
  it('excludes unresolved scope, malformed records and producer-supplied extra content', () => {
    const view = create();
    view.accept([observation(), { ...read(), content: 'PRIVATE_BODY' }]);
    expect(view.snapshot().reads).toEqual([]);
  });
  it('coalesces identical evidence, rejects replay and bounds retained rows', () => {
    const view = create();
    view.accept([read(), read({ eventSeq: '2' }), read({ eventSeq: '2' })]);
    expect(view.snapshot().reads[0].reads).toBe(2);
    for (let i = 3; i < 90; i++)
      view.accept([read({ eventSeq: String(i), path: `C:\\fixture\\${i}` })]);
    expect(view.snapshot().reads).toHaveLength(64);
    expect(view.snapshot().omitted).toBeGreaterThan(0);
    view.reset();
    expect(view.snapshot()).toEqual({ reads: [], omitted: 0 });
  });
});
