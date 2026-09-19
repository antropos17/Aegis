import { afterEach, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createCatalogReviewObservation,
  prepareCatalogReviewObservationReply,
  catalogReviewObservationPassed,
} from '../../scripts/claude-catalog-review-observation.mjs';
const require = createRequire(import.meta.url);
const { startActionObservation } = require('../../src/main/action-observation-server');
const cleanups = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
function snapshot(attempts, settled, sequence) {
  return {
    schemaVersion: 1,
    connectionId: '12345678-1234-1234-1234-123456789012',
    sequence,
    route: 'mcp-review',
    state: 'observed',
    client: { name: 'claude-code', version: '2.1.263' },
    selection: 'catalog',
    selectedActionCount: 2,
    actionAttempts: attempts,
    selectionRejected: 0,
    ownerInvocations: attempts,
    ownerSettled: settled,
    ownerFailures: 0,
    cancellationRequests: 0,
  };
}
function evidence() {
  const frame = (attempts, settled, sequence) => ({
    state: 'observed',
    reason: null,
    lastObservedAt: '2026-09-19T00:00:00.000Z',
    snapshot: snapshot(attempts, settled, sequence),
  });
  const lost = frame(3, 2, 6);
  Object.assign(lost, { state: 'coverage-lost', reason: 'connection-closed' });
  return {
    before: frame(0, 0, 1),
    pending: [frame(1, 0, 2), frame(2, 1, 4), frame(3, 2, 6)],
    after: [frame(1, 1, 3), frame(2, 2, 5)],
    lost,
    pendingEffects: [
      { firstBytes: 0, secondBytes: 0 },
      { firstBytes: 1, secondBytes: 0 },
      { firstBytes: 1, secondBytes: 0 },
    ],
    endpointRemoved: true,
    stickyLoss: true,
    failure: null,
    providerIdentity: 'unverified',
  };
}
it('requires the ordered three-review sequence with two settlements and sticky disconnect', () => {
  expect(catalogReviewObservationPassed(evidence())).toBe(true);
  const e = evidence();
  e.lost.snapshot.ownerSettled = 3;
  expect(catalogReviewObservationPassed(e)).toBe(false);
  e.lost.snapshot.sequence++;
  expect(catalogReviewObservationPassed(e)).toBe(true);
});
it.each([
  ['missing pending', (e) => e.pending.pop()],
  ['missing settlement', (e) => e.after.pop()],
  [
    'early action',
    (e) => {
      e.pendingEffects[0].firstBytes = 1;
    },
  ],
  [
    'reused approval',
    (e) => {
      e.pendingEffects[1].secondBytes = 1;
    },
  ],
  [
    'repeated first',
    (e) => {
      e.pendingEffects[2].firstBytes = 2;
    },
  ],
  [
    'early settle',
    (e) => {
      e.pending[2].snapshot.ownerSettled = 3;
    },
  ],
  [
    'stale settlement',
    (e) => {
      e.after[1].snapshot.ownerSettled = 1;
    },
  ],
  [
    'different generation',
    (e) => {
      e.after[1].snapshot.connectionId = '22345678-1234-1234-1234-123456789012';
    },
  ],
  [
    'metadata changed',
    (e) => {
      e.pending[1].snapshot.client.version = '9.9.9';
    },
  ],
  [
    'replayed frame',
    (e) => {
      e.pending[1].snapshot.sequence = 3;
    },
  ],
  [
    'late loss',
    (e) => {
      e.lost.reason = 'updates-expired';
    },
  ],
  [
    'unexpected cancellation',
    (e) => {
      e.lost.snapshot.cancellationRequests = 1;
    },
  ],
  [
    'wrong selection',
    (e) => {
      e.before.snapshot.selection = 'single-action';
    },
  ],
  [
    'wrong catalog count',
    (e) => {
      e.before.snapshot.selectedActionCount = 1;
    },
  ],
  [
    'failed checkpoint',
    (e) => {
      e.failure = 'checkpoint-failed';
    },
  ],
  [
    'private frame data',
    (e) => {
      e.before.snapshot.privatePath = 'PRIVATE';
    },
  ],
  [
    'private envelope data',
    (e) => {
      e.pending[0].privatePath = 'PRIVATE';
    },
  ],
  [
    'private receipt data',
    (e) => {
      e.privatePath = 'PRIVATE';
    },
  ],
  [
    'unremoved descriptor',
    (e) => {
      e.endpointRemoved = false;
    },
  ],
  [
    'false identity claim',
    (e) => {
      e.providerIdentity = 'verified';
    },
  ],
  [
    'false sticky flag',
    (e) => {
      e.stickyLoss = 'true';
    },
  ],
])('rejects %s', (_label, mutate) => {
  const e = evidence();
  mutate(e);
  expect(catalogReviewObservationPassed(e)).toBe(false);
});
it('captures real catalog frames across first approval, refusal and pending disconnect', async () => {
  const owned = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-catalog-review-observation-'));
  cleanups.push(() => {
    expect(path.dirname(owned)).toBe(path.resolve(os.tmpdir()));
    expect(fs.lstatSync(owned).isSymbolicLink()).toBe(false);
    fs.rmSync(owned, { recursive: true, force: true });
  });
  const file = path.join(owned, 'PRIVATE_ENDPOINT');
  const sentinels = ['PRIVATE_FIRST', 'PRIVATE_SECOND'].map((name) => path.join(owned, name));
  const server = await startActionObservation(file, 'mcp-review', 'catalog');
  cleanups.push(() => server.close());
  let current = snapshot(0, 0, 0);
  for (const key of ['schemaVersion', 'connectionId', 'sequence', 'route']) delete current[key];
  server.observe(() => current);
  const scenario = { requests: 1 };
  const probe = createCatalogReviewObservation(scenario, file, sentinels);
  cleanups.push(() => probe.finish());
  expect(await prepareCatalogReviewObservationReply(scenario)).toBe(true);
  for (let i = 0; i < 3; i++) {
    current = { ...current, actionAttempts: i + 1, ownerInvocations: i + 1 };
    expect(await probe.pending(i)).toBe(true);
    if (i === 2) break;
    if (i === 0) fs.writeFileSync(sentinels[0], 'x');
    current = { ...current, ownerSettled: i + 1 };
    scenario.requests++;
    expect(await prepareCatalogReviewObservationReply(scenario)).toBe(true);
  }
  scenario.requests = 4;
  expect(await prepareCatalogReviewObservationReply(scenario)).toBe(false);
  await server.close();
  await probe.finish();
  expect(catalogReviewObservationPassed(scenario.catalogReviewObservation)).toBe(true);
  expect(JSON.stringify(scenario)).not.toMatch(/PRIVATE|token|port/);
  expect(await prepareCatalogReviewObservationReply(scenario)).toBe(false);
}, 12000);
it('fails closed without exposing a missing endpoint or sentinel', async () => {
  const scenario = { requests: 1 };
  const probe = createCatalogReviewObservation(
    scenario,
    path.join(os.tmpdir(), 'PRIVATE_MISSING_CATALOG.json'),
    ['PRIVATE_FIRST', 'PRIVATE_SECOND'],
  );
  try {
    expect(await prepareCatalogReviewObservationReply(scenario)).toBe(false);
    expect(await probe.pending(0)).toBe(false);
  } finally {
    await probe.finish();
  }
  expect(scenario.catalogReviewObservation.failure).toBe('checkpoint-failed');
  expect(catalogReviewObservationPassed(scenario.catalogReviewObservation)).toBe(false);
  expect(JSON.stringify(scenario)).not.toContain('PRIVATE');
});
