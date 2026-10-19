import { describe, expect, it } from 'vitest';
import { createOracle, fixtureEvent } from '../../../scripts/qualification/event-pipeline-oracle.mjs';

const epoch = 1_800_000_000_000;
const rate = 20_000;
const output = (id, replayed = true) => ({ ...fixtureEvent(id, epoch, rate),
  deliveryId: '00000000-0000-4000-8000-000000000000', replayed });

describe('pipeline qualification oracle', () => {
  it('uses bounded storage and requires complete ordered replay', () => {
    const oracle = createOracle(5, epoch, rate);
    oracle.accept([0, 1, 2, 3, 4].map((id) => output(id)));
    oracle.assertComplete();
    expect(oracle.snapshot()).toMatchObject({ delivered: 5, replayed: 5, bitmapBytes: 1 });
  });

  it('rejects duplicate delivery even when all producer counts could look correct', () => {
    const oracle = createOracle(2, epoch, rate);
    oracle.accept([output(0)]);
    expect(() => oracle.accept([output(0)])).toThrow('duplicate-delivery');
  });

  it('rejects a gap, reordering, foreign delivery and altered payload', () => {
    expect(() => createOracle(2, epoch, rate).accept([output(1)])).toThrow('global-delivery-order');
    expect(() => createOracle(2, epoch, rate).accept([output(2)])).toThrow('foreign-delivery');
    const changed = output(0);
    changed.details.path = '/another-object';
    expect(() => createOracle(2, epoch, rate).accept([changed])).toThrow('path-preserved');
  });

  it('rejects successful memory-only delivery when the spill path is absent', () => {
    const oracle = createOracle(1, epoch, rate);
    oracle.accept([output(0, false)]);
    expect(() => oracle.assertComplete()).toThrow('spill-replay-required');
  });

  it('rejects exact loss markers in the normal-storage workload', () => {
    const oracle = createOracle(1, epoch, rate);
    oracle.accept([{ type: 'pipeline-loss', details: { extra: { count: 1 } } }]);
    expect(() => oracle.assertComplete()).toThrow('normal-storage-must-not-lose');
  });

  it('rejects missing tail delivery', () => {
    const oracle = createOracle(2, epoch, rate);
    oracle.accept([output(0)]);
    expect(() => oracle.assertComplete()).toThrow('every-offered-record-delivered');
  });
});
