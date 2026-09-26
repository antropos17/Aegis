import { expect, it } from 'vitest';
import { parseActionCheck } from '../../frontend/observatory/runtime/action-coverage';
import { previewActionCoverage } from '../../frontend/observatory/demo/action-coverage';
import { record } from '../../frontend/observatory/runtime/host';

const example = async (catalog = false) =>
  record(
    (
      await previewActionCoverage({
        action: catalog ? 'check-catalog' : 'check-route',
        route: 'mcp-stdio',
      })
    ).check,
  );
it('parses both fixed check contracts into detached typed observations', async () => {
  for (const catalog of [false, true]) {
    const wire = await example(catalog);
    const parsed = parseActionCheck(wire);
    expect(parsed?.kind).toBe(catalog ? 'catalog' : 'single');
    expect(parsed?.report.configuration).toBe('valid');
    expect(parsed?.report.actions).toHaveLength(catalog ? 3 : 0);
    record(wire.report).configuration = 'invalid';
    expect(parsed?.report.configuration).toBe('valid');
    expect(parsed?.report).not.toHaveProperty('gaps');
  }
});
it('accepts only an ask decision with a review-required reason in single and catalog checks', async () => {
  const single = await example();
  Object.assign(record(single.report), { policyDecision: 'ask', reason: 'review-required' });
  expect(parseActionCheck(single)?.report).toMatchObject({
    configuration: 'valid',
    policyDecision: 'ask',
    reason: 'review-required',
  });
  record(single.report).policyDecision = 'allow';
  expect(parseActionCheck(single)).toBeNull();

  const catalog = await example(true);
  const row = (record(catalog.report).actions as Record<string, unknown>[])[0];
  Object.assign(row, { policyDecision: 'ask', reason: 'review-required' });
  expect(parseActionCheck(catalog)?.report.actions[0]).toMatchObject({
    policyDecision: 'ask',
    reason: 'review-required',
  });
  row.policyDecision = 'deny';
  expect(parseActionCheck(catalog)).toBeNull();
});
it.each([
  'authorization',
  'blockingVerification',
  'outsideRouteCoverage',
  'executionPerformed',
  'configurationObservation',
  'mode',
  'route',
])('rejects a forged %s guarantee or mismatched report', async (key) => {
  const wire = await example();
  record(wire.report)[key] = 'PRIVATE_FORGED';
  expect(parseActionCheck(wire)).toBeNull();
});
it.each(['configuration', 'policyDecision', 'runtime', 'terminal', 'reason'])(
  'rejects unknown %s without guessing a safe value',
  async (key) => {
    const wire = await example();
    record(wire.report)[key] = 'PRIVATE_UNKNOWN';
    expect(parseActionCheck(wire)).toBeNull();
  },
);
it('rejects extra private fields and invalid envelope identity/time/kind', async () => {
  for (const change of [
    (w: Record<string, unknown>) => {
      w.path = '/PRIVATE';
    },
    (w: Record<string, unknown>) => {
      w.id = 'PRIVATE';
    },
    (w: Record<string, unknown>) => {
      w.createdAt = '2026-02-31T00:00:00.000Z';
    },
    (w: Record<string, unknown>) => {
      w.kind = 'catalog';
    },
    (w: Record<string, unknown>) => {
      record(w.report).launch = { executable: 'PRIVATE' };
    },
  ]) {
    const wire = await example();
    change(wire);
    expect(parseActionCheck(wire)).toBeNull();
  }
});
it('enforces bounded unique catalog action rows and result consistency', async () => {
  const wire = await example(true),
    report = record(wire.report);
  const rows = report.actions as Record<string, unknown>[];
  report.actions = Array.from({ length: 9 }, (_, i) => ({ ...rows[0], name: 'aegis_action_' + i }));
  expect(parseActionCheck(wire)).toBeNull();
  report.actions = [rows[0], rows[0]];
  expect(parseActionCheck(wire)).toBeNull();
  report.actions = [];
  expect(parseActionCheck(wire)).toBeNull();
  report.actions = [{ ...rows[0], name: 'PRIVATE/path' }];
  expect(parseActionCheck(wire)).toBeNull();
  report.actions = [{ ...rows[0], configuration: 'invalid' }];
  expect(parseActionCheck(wire)).toBeNull();
});
it('keeps absent catalog data and unsupported current runtime explicit', async () => {
  const wire = await example(true);
  Object.assign(record(wire.report), {
    configuration: 'not-checked',
    policyDecision: 'unknown',
    reason: 'runtime-unsupported',
    runtime: 'unsupported',
    actions: [],
  });
  expect(parseActionCheck(wire)?.report).toMatchObject({
    configuration: 'not-checked',
    runtime: 'unsupported',
    actions: [],
  });
});
