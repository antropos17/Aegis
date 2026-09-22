import { expect, it } from 'vitest';
import { cancellationPassed } from '../../scripts/claude-cancellation-evidence.mjs';

function evidence(catalog = false) {
  const capture = (sequence, attempts, settled, cancellations) => ({
    state: 'observed',
    reason: null,
    lastObservedAt: '2026-09-22T00:09:51.967Z',
    snapshot: {
      schemaVersion: 1,
      connectionId: '12345678-1234-1234-1234-123456789012',
      sequence,
      route: 'mcp-stdio',
      state: 'observed',
      client: { name: 'claude-code', version: '2.1.263' },
      selection: catalog ? 'catalog' : 'single-action',
      selectedActionCount: catalog ? 2 : 1,
      actionAttempts: attempts,
      ownerInvocations: attempts,
      ownerSettled: settled,
      cancellationRequests: cancellations,
      selectionRejected: 0,
      ownerFailures: 0,
    },
  });
  const lost = capture(3, 1, 1, 1);
  lost.state = 'coverage-lost';
  lost.reason = 'connection-closed';
  return {
    catalog,
    failure: null,
    requests: 1,
    providerIdentity: 'unverified',
    toolDiscovered: true,
    interruptSent: true,
    interruptAcknowledged: true,
    progressObserved: true,
    progressStopped: true,
    endpointRemoved: true,
    stickyLoss: true,
    before: capture(1, 0, 0, 0),
    pending: capture(2, 1, 0, 0),
    after: capture(3, 1, 1, 1),
    lost,
    witness: {
      launches: 1,
      exited: true,
      closed: true,
      cancelled: true,
      interrupted: true,
      terminationConfirmed: true,
    },
    providerResult: { subtype: 'error_during_execution', isError: true },
    unusedBytes: 0,
    exitCode: 1,
    timedOut: false,
    cancelled: false,
    exceeded: false,
  };
}

it.each([false, true])(
  'accepts independently confirmed interruption despite provider error exit, catalog=%s',
  (catalog) => {
    expect(cancellationPassed(evidence(catalog))).toBe(true);
  },
);

it('rejects timeout/EOF cleanup, missing exit evidence and acknowledgements without a delivered cancellation', () => {
  const mutations = [
    (e) => {
      e.witness.cancelled = false;
    }, // timeout or ordinary exit is not cancellation
    (e) => {
      e.after.snapshot.cancellationRequests = 0;
    }, // EOF can abort without a notification
    (e) => {
      e.witness.closed = false;
    },
    (e) => {
      e.witness.terminationConfirmed = false;
    },
    (e) => {
      e.witness.launches = 2;
    },
    (e) => {
      e.interruptAcknowledged = false;
    },
    (e) => {
      e.progressObserved = false;
    },
    (e) => {
      e.progressStopped = false;
    },
    (e) => {
      e.pending.snapshot.ownerSettled = 1;
    },
    (e) => {
      e.unusedBytes = 1;
    },
    (e) => {
      e.endpointRemoved = false;
    },
    (e) => {
      e.stickyLoss = false;
    },
    (e) => {
      e.after.snapshot.connectionId = '22345678-1234-1234-1234-123456789012';
    },
    (e) => {
      e.after.snapshot.client.version = '9.9.9';
    },
    (e) => {
      e.after.snapshot.sequence = 2;
    },
    (e) => {
      e.after.snapshot.privatePath = 'PRIVATE';
    },
    (e) => {
      e.providerIdentity = 'verified';
    },
    (e) => {
      e.timedOut = true;
    },
    (e) => {
      e.cancelled = true;
    },
    (e) => {
      e.exceeded = true;
    },
    (e) => {
      e.providerResult = null;
    },
    (e) => {
      e.providerResult.subtype = 'error_max_turns';
    },
    (e) => {
      e.exitCode = 2;
    },
  ];
  for (const mutate of mutations) {
    const e = evidence();
    mutate(e);
    expect(cancellationPassed(e)).toBe(false);
  }
});
