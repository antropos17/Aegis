import { describe, expect, it } from 'vitest';
import attribution from '../../../src/main/platform/etw-file-attribution.js';
import { observation } from './etw-file-fixtures.js';
const witness = '134333333333333337';
const record = () =>
  observation({
    qpc: '110',
    headerPid: 4,
    issuerStatus: 'verified',
    issuerPid: 71,
    issuerInterval: { fromQpc: '100', toQpc: '120' },
    generationStatus: 'verified',
    generationWitness: witness,
    generationSource: 'createTime100ns',
    generationInterval: { fromQpc: '115', toQpc: '120' },
  });
const agent = () => ({
  pid: 71,
  name: 'Aider',
  createTime100ns: witness,
  instanceId: '71:1788859733333',
  instanceIdSource: 'os',
});
const reliable = { populationReliable: true, identityDegraded: false };
const apply = (r, rows = [agent()], health = reliable) =>
  attribution.attributeDiagnostics({ records: [r] }, rows, health).records[0];
describe('ETW diagnostic issuer labels', () => {
  it('joins the actual issuing process rather than the header PID without upgrading the path', () => {
    const r = record();
    const result = apply(r);
    expect(result).toMatchObject({
      agent: 'Aider',
      instanceId: agent().instanceId,
      headerPid: 4,
      issuerPid: 71,
      pathEvidence: 'unresolved',
    });
    expect(r.agent).toBeNull();
  });
  it('rejects same-ms witness collisions, missing witnesses, ambiguous rows and population outages', () => {
    for (const rows of [
      [{ ...agent(), createTime100ns: '134333333333333338' }],
      [{ ...agent(), createTime100ns: null }],
      [agent(), agent()],
    ])
      expect(apply(record(), rows).agent).toBeNull();
    expect(apply(record(), [agent()], { populationReliable: false }).agent).toBeNull();
    expect(apply(record(), [agent()], { ...reliable, identityDegraded: true }).agent).toBeNull();
  });
  it('cannot promote a bare PID, late lookup or forged collector label', () => {
    expect(apply(observation()).agent).toBeNull();
    const r = record();
    r.issuerInterval.fromQpc = '111';
    expect(apply(r).agent).toBeNull();
    const forged = { ...record(), agent: 'forged' };
    expect(apply(forged).agent).toBeNull();
  });
});
