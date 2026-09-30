import { expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  observationFixtureDiagnostics,
  expectObservationState,
} from '../shared/observation-fixture-state.js';

it('failure evidence includes the public expiry reason and owned child closure without private frames', () => {
  const child = Object.assign(new EventEmitter(), {
    exitCode: 2,
    signalCode: null,
    spawnargs: ['PRIVATE_EXECUTABLE'],
    stderr: 'PRIVATE_STDERR',
  });
  const diagnostics = observationFixtureDiagnostics(child);
  diagnostics.mark('endpoint-published');
  child.emit('close', 2);
  const observer = {
    snapshot: () => ({
      state: 'unavailable',
      reason: 'updates-expired',
      snapshot: { token: 'PRIVATE_TOKEN', policyPath: 'PRIVATE_PATH' },
    }),
  };
  expect(diagnostics.snapshot(observer)).toMatchObject({
    state: 'unavailable',
    reason: 'updates-expired',
    stage: 'endpoint-published',
    ownerExitCode: 2,
    ownerSignal: null,
    ownerClosed: true,
  });
  let failure;
  try {
    expectObservationState(observer, 'awaiting-client', diagnostics);
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeDefined();
  expect(failure.message).toContain('updates-expired');
  expect(failure.message).toContain('ownerClosed');
  expect(JSON.stringify({ actual: failure.actual, message: failure.message })).not.toContain(
    'PRIVATE',
  );
  const malicious = { snapshot: () => ({ state: 'PRIVATE_STATE', reason: 'PRIVATE_REASON' }) };
  child.signalCode = 'PRIVATE_SIGNAL';
  diagnostics.mark('PRIVATE_STAGE');
  expect(JSON.stringify(diagnostics.snapshot(malicious))).not.toContain('PRIVATE');
});
