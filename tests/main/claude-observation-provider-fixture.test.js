import { afterEach, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createProviderObservation,
  prepareObservationReply,
  observationPassed,
} from '../../scripts/claude-observation-provider-fixture.mjs';
const require = createRequire(import.meta.url);
const { startActionObservation } = require('../../src/main/action-observation-server');
const cleanups = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
function frame(attempts, sequence = attempts + 1) {
  return {
    schemaVersion: 1,
    connectionId: '12345678-1234-1234-1234-123456789012',
    sequence,
    route: 'mcp-stdio',
    state: 'observed',
    client: { name: 'claude-code', version: '2.1.263' },
    selection: 'single-action',
    selectedActionCount: 1,
    actionAttempts: attempts,
    selectionRejected: 0,
    ownerInvocations: attempts,
    ownerSettled: attempts,
    ownerFailures: 0,
    cancellationRequests: 0,
  };
}
function evidence(catalog = false) {
  const capture = (attempts, sequence) => ({
    state: 'observed',
    reason: null,
    lastObservedAt: '2026-09-19T00:00:00.000Z',
    snapshot: {
      ...frame(attempts, sequence),
      selection: catalog ? 'catalog' : 'single-action',
      selectedActionCount: catalog ? 2 : 1,
    },
  });
  const lost = capture(1, 3);
  lost.state = 'coverage-lost';
  lost.reason = 'connection-closed';
  return {
    before: capture(0, 1),
    after: capture(1, 2),
    lost,
    stickyLoss: true,
    endpointRemoved: true,
    providerIdentity: 'unverified',
    failure: null,
  };
}
it.each([false, true])(
  'accepts observed counters followed by sticky closure, catalog=%s',
  (catalog) => {
    expect(observationPassed(evidence(catalog), catalog)).toBe(true);
  },
);
it('rejects absent cleanup, false identity claims, stale loss and changed generation/counters', () => {
  for (const mutate of [
    (e) => {
      e.endpointRemoved = false;
    },
    (e) => {
      e.stickyLoss = false;
    },
    (e) => {
      e.providerIdentity = 'verified';
    },
    (e) => {
      e.failure = 'checkpoint-failed';
    },
    (e) => {
      e.before = null;
    },
    (e) => {
      e.after.snapshot.ownerSettled = 0;
    },
    (e) => {
      e.after.snapshot.connectionId = '22345678-1234-1234-1234-123456789012';
    },
    (e) => {
      e.after.snapshot.sequence = 1;
    },
    (e) => {
      e.after.snapshot.client.version = '9.9.9';
    },
    (e) => {
      e.after.snapshot.privatePath = 'PRIVATE';
    },
    (e) => {
      e.lost.reason = 'updates-expired';
    },
    (e) => {
      e.lost.snapshot.actionAttempts = 2;
    },
    (e) => {
      e.lost.snapshot.sequence = 1;
    },
  ]) {
    const item = evidence();
    mutate(item);
    expect(observationPassed(item, false)).toBe(false);
  }
});
it('uses the production observer through a real endpoint and cleans up on owner exit', async () => {
  const owned = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-provider-observation-'));
  cleanups.push(() => {
    expect(path.dirname(owned)).toBe(path.resolve(os.tmpdir()));
    expect(fs.lstatSync(owned).isSymbolicLink()).toBe(false);
    fs.rmSync(owned, { recursive: true, force: true });
  });
  const file = path.join(owned, 'PRIVATE_ENDPOINT.json');
  const server = await startActionObservation(file, 'mcp-stdio', 'single-action');
  cleanups.push(() => server.close());
  let current = frame(0);
  for (const key of ['schemaVersion', 'connectionId', 'sequence', 'route']) delete current[key];
  server.observe(() => current);
  const scenario = { requests: 1 };
  const probe = createProviderObservation(scenario, file);
  cleanups.push(() => probe.finish());
  expect(await prepareObservationReply(scenario)).toBe(true);
  current = { ...current, actionAttempts: 1, ownerInvocations: 1, ownerSettled: 1 };
  scenario.requests = 4;
  expect(await prepareObservationReply(scenario)).toBe(true);
  await server.close();
  await probe.finish();
  expect(observationPassed(scenario.liveObservation, false)).toBe(true);
  expect(JSON.stringify(scenario)).not.toMatch(/PRIVATE|token|port/);
  expect(await prepareObservationReply(scenario)).toBe(false);
}, 10000);
it('fails closed with a fixed error when the endpoint is missing', async () => {
  const scenario = { requests: 1 };
  const probe = createProviderObservation(scenario, path.join(os.tmpdir(), 'PRIVATE_MISSING.json'));
  try {
    expect(await prepareObservationReply(scenario)).toBe(false);
  } finally {
    await probe.finish();
  }
  expect(scenario.liveObservation.failure).toBe('checkpoint-failed');
  expect(observationPassed(scenario.liveObservation, false)).toBe(false);
  expect(JSON.stringify(scenario)).not.toContain('PRIVATE');
});

it('bounds an uninitialized connection and does not advance after a failed checkpoint', async () => {
  const owned = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-provider-observation-'));
  cleanups.push(() => {
    expect(path.dirname(owned)).toBe(path.resolve(os.tmpdir()));
    expect(fs.lstatSync(owned).isSymbolicLink()).toBe(false);
    fs.rmSync(owned, { recursive: true, force: true });
  });
  const file = path.join(owned, 'endpoint.json');
  const server = await startActionObservation(file, 'mcp-stdio', 'single-action');
  cleanups.push(() => server.close());
  const scenario = { requests: 1 };
  const probe = createProviderObservation(scenario, file);
  cleanups.push(() => probe.finish());
  expect(await prepareObservationReply(scenario)).toBe(false);
  scenario.requests = 2;
  expect(await prepareObservationReply(scenario)).toBe(false);
  await server.close();
  await probe.finish();
  expect(observationPassed(scenario.liveObservation, false)).toBe(false);
}, 10000);
