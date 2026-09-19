import { afterEach, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createReviewObservation,
  prepareReviewObservationReply,
  reviewObservationPassed,
} from '../../scripts/claude-review-observation-fixture.mjs';
const require = createRequire(import.meta.url);
const { startActionObservation } = require('../../src/main/action-observation-server');
const cleanups = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const names = ['approved-ask', 'declined-ask', 'policy-deny', 'disconnect-during-review'];
function frame(attempts, settled, sequence) {
  return {
    schemaVersion: 1,
    connectionId: '12345678-1234-1234-1234-123456789012',
    sequence,
    route: 'mcp-review',
    state: 'observed',
    client: { name: 'claude-code', version: '2.1.263' },
    selection: 'single-action',
    selectedActionCount: 1,
    actionAttempts: attempts,
    selectionRejected: 0,
    ownerInvocations: attempts,
    ownerSettled: settled,
    ownerFailures: 0,
    cancellationRequests: 0,
  };
}
function evidence(name) {
  const capture = (attempts, settled, sequence) => ({
    state: 'observed',
    reason: null,
    lastObservedAt: '2026-09-19T00:00:00.000Z',
    snapshot: frame(attempts, settled, sequence),
  });
  const disconnect = name === 'disconnect-during-review';
  const lost = capture(1, disconnect ? 0 : 1, 4);
  lost.state = 'coverage-lost';
  lost.reason = 'connection-closed';
  return {
    before: capture(0, 0, 1),
    pending: name === 'policy-deny' ? null : capture(1, 0, 2),
    after: disconnect ? null : capture(1, 1, 3),
    lost,
    pendingEffect: name === 'policy-deny' ? null : false,
    endpointRemoved: true,
    stickyLoss: true,
    failure: null,
    providerIdentity: 'unverified',
  };
}
it.each(names)('requires complete review observation evidence for %s', (name) => {
  expect(reviewObservationPassed(evidence(name), name)).toBe(true);
  for (const mutate of [
    (e) => {
      e.endpointRemoved = false;
    },
    (e) => {
      e.endpointRemoved = 'true';
    },
    (e) => {
      e.stickyLoss = false;
    },
    (e) => {
      e.stickyLoss = 'true';
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
      e.before.snapshot.actionAttempts = 1;
    },
    (e) => {
      e.lost.reason = 'updates-expired';
    },
    (e) => {
      e.lost.snapshot.connectionId = '22345678-1234-1234-1234-123456789012';
    },
    (e) => {
      e.lost.snapshot.client.version = '9.9.9';
    },
    (e) => {
      e.lost.snapshot.sequence = 1;
    },
    (e) => {
      e.lost.snapshot.cancellationRequests = 1;
    },
    (e) => {
      e.lost.snapshot.privatePath = 'PRIVATE';
    },
  ]) {
    const e = evidence(name);
    mutate(e);
    expect(reviewObservationPassed(e, name)).toBe(false);
  }
});
it('distinguishes waiting review, policy rejection and pending disconnect', () => {
  const name = 'approved-ask';
  for (const mutate of [
    (e) => {
      e.pending = null;
    },
    (e) => {
      e.pendingEffect = true;
    },
    (e) => {
      e.pending.snapshot.ownerSettled = 1;
    },
    (e) => {
      e.pending.snapshot.sequence = 1;
    },
    (e) => {
      e.after.snapshot.ownerSettled = 0;
    },
  ]) {
    const e = evidence(name);
    mutate(e);
    expect(reviewObservationPassed(e, name)).toBe(false);
  }
  const denied = evidence('policy-deny');
  denied.pending = evidence(name).pending;
  expect(reviewObservationPassed(denied, 'policy-deny')).toBe(false);
  const disconnected = evidence('disconnect-during-review');
  disconnected.after = evidence(name).after;
  expect(reviewObservationPassed(disconnected, 'disconnect-during-review')).toBe(false);
  expect(reviewObservationPassed(evidence(name), 'unknown')).toBe(false);
  expect(reviewObservationPassed(null, name)).toBe(false);
});
it.each([false, true])(
  'observes real pending counters and cleanup, disconnect=%s',
  async (disconnect) => {
    const owned = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-review-observation-'));
    cleanups.push(() => {
      expect(path.dirname(owned)).toBe(path.resolve(os.tmpdir()));
      expect(fs.lstatSync(owned).isSymbolicLink()).toBe(false);
      fs.rmSync(owned, { recursive: true, force: true });
    });
    const file = path.join(owned, 'PRIVATE_ENDPOINT.json');
    const sentinel = path.join(owned, 'PRIVATE_SENTINEL');
    const server = await startActionObservation(file, 'mcp-review', 'single-action');
    cleanups.push(() => server.close());
    let current = frame(0, 0, 1);
    for (const key of ['schemaVersion', 'connectionId', 'sequence', 'route']) delete current[key];
    server.observe(() => current);
    const scenario = {
      name: disconnect ? 'disconnect-during-review' : 'approved-ask',
      requests: 1,
    };
    const probe = createReviewObservation(scenario, file, sentinel);
    cleanups.push(() => probe.finish());
    expect(await prepareReviewObservationReply(scenario)).toBe(true);
    current = { ...current, actionAttempts: 1, ownerInvocations: 1 };
    expect(await probe.pending()).toBe(true);
    expect(scenario.reviewObservation.pendingEffect).toBe(false);
    scenario.requests = 2;
    if (disconnect) {
      expect(await prepareReviewObservationReply(scenario)).toBe(false);
    } else {
      fs.writeFileSync(sentinel, '1');
      current = { ...current, ownerSettled: 1 };
      expect(await prepareReviewObservationReply(scenario)).toBe(true);
    }
    await server.close();
    await probe.finish();
    expect(reviewObservationPassed(scenario.reviewObservation, scenario.name)).toBe(true);
    expect(JSON.stringify(scenario)).not.toMatch(/PRIVATE|token|port/);
    expect(await prepareReviewObservationReply(scenario)).toBe(false);
  },
  10000,
);
it('fails closed without publishing a private endpoint path', async () => {
  const scenario = { name: 'approved-ask', requests: 1 };
  const probe = createReviewObservation(
    scenario,
    path.join(os.tmpdir(), 'PRIVATE_MISSING.json'),
    'PRIVATE_SENTINEL',
  );
  try {
    expect(await prepareReviewObservationReply(scenario)).toBe(false);
    expect(await probe.pending()).toBe(false);
  } finally {
    await probe.finish();
  }
  expect(scenario.reviewObservation.failure).toBe('checkpoint-failed');
  expect(reviewObservationPassed(scenario.reviewObservation, scenario.name)).toBe(false);
  expect(JSON.stringify(scenario)).not.toContain('PRIVATE');
});
