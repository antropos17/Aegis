import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs';
import { reviewFixture, wait } from '../helpers/review-cancellation-fixture.js';
const cleanups = [];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

it.each([
  ['single-action', 'pending'],
  ['catalog', 'pending'],
  ['single-action', 'running'],
  ['catalog', 'running'],
])(
  '%s %s review: cancellation crosses relay, revokes approval and preserves observation',
  async (selection, phase) => {
    const f = await reviewFixture(selection, cleanups);
    const call = (id) =>
      f.send({
        id,
        method: 'tools/call',
        params: {
          name: selection === 'catalog' ? 'aegis_action_first' : 'aegis_execute_selected',
          arguments: {},
        },
      });
    const cancel = (requestId) =>
      f.send({ method: 'notifications/cancelled', params: { requestId } });
    call(1);
    await wait(() => expect(f.prompts).toHaveLength(1));
    await wait(() =>
      expect(f.observer.snapshot().snapshot).toMatchObject({
        ownerInvocations: 1,
        ownerSettled: 0,
        cancellationRequests: 0,
      }),
    );
    const challenge = f.prompts[0];
    expect(f.launches).toHaveLength(0);
    if (phase === 'running') {
      f.terminalInput.write(challenge + '\n');
      await wait(() => expect(fs.existsSync(f.markers[0])).toBe(true));
      expect(f.launches).toHaveLength(1);
    }
    // Wrong type / unrelated ID must not abort the current review or child.
    cancel('1');
    cancel(99);
    f.send({ id: 11, method: 'tools/call', params: { name: 'aegis_route_status', arguments: {} } });
    await wait(() =>
      expect(f.messages.find((m) => m.id === 11)?.result?.structuredContent).toMatchObject({
        ownerInvocations: 1,
        ownerSettled: 0,
        cancellationRequests: 0,
      }),
    );
    if (phase === 'running') {
      const size = fs.statSync(f.markers[0]).size;
      await wait(() => expect(fs.statSync(f.markers[0]).size).toBeGreaterThan(size));
      expect(f.launches[0].exited).toBe(false);
    }
    cancel(1);
    cancel(1);
    await wait(() => expect(f.reports).toHaveLength(1));
    expect(f.reports[0]).toMatchObject(
      phase === 'running'
        ? {
            reason: 'action-cancelled',
            execution: { state: 'interrupted', termination: 'confirmed' },
          }
        : { reason: 'confirmation-denied', execution: { state: 'not-started' } },
    );
    if (phase === 'running') {
      expect(f.launches[0]).toMatchObject({ exited: true, closed: true });
      const finalSize = fs.statSync(f.markers[0]).size;
      await pause(100);
      expect(fs.statSync(f.markers[0]).size).toBe(finalSize);
    }
    await wait(() =>
      expect(f.observer.snapshot().snapshot).toMatchObject({
        ownerInvocations: 1,
        ownerSettled: 1,
        cancellationRequests: 1,
      }),
    );
    expect(f.observer.snapshot().state).toBe('observed');
    expect(f.observer.snapshot().snapshot.connectionId).toBe(f.before.snapshot.connectionId);
    expect(f.messages.some((m) => m.id === 1)).toBe(false);
    // A late exact answer while idle grants nothing; a new review also rejects it.
    f.terminalInput.write(challenge + '\n');
    call(1);
    await wait(() => expect(f.messages.find((m) => m.id === 1)?.error?.code).toBe(-32600));
    call(2);
    await wait(() => expect(f.prompts).toHaveLength(2));
    expect(f.prompts[1]).not.toBe(challenge);
    f.terminalInput.write(challenge + '\n');
    await wait(() => expect(f.reports).toHaveLength(2));
    expect(f.reports[1]).toMatchObject({
      reason: 'confirmation-denied',
      execution: { state: 'not-started' },
    });
    expect(f.launches).toHaveLength(phase === 'running' ? 1 : 0);
    expect(fs.existsSync(f.markers[1])).toBe(false);
    if (phase === 'pending') expect(fs.existsSync(f.markers[0])).toBe(false);
    await wait(() =>
      expect(f.observer.snapshot().snapshot).toMatchObject({
        ownerInvocations: 2,
        ownerSettled: 2,
        cancellationRequests: 1,
      }),
    );
    f.input.end();
    expect(await f.relayDone).toBe(0);
    await f.ownerDone;
    await f.source.close();
    await wait(() => expect(f.observer.snapshot().state).toBe('coverage-lost'));
    const lost = f.observer.snapshot();
    await pause(100);
    expect(f.observer.snapshot()).toEqual(lost);
    expect(fs.existsSync(f.endpoint)).toBe(false);
    expect(fs.existsSync(f.observation)).toBe(false);
    expect(f.transcript()).not.toContain(challenge);
    expect(f.transcript()).not.toContain(f.root);
    expect(JSON.stringify(lost)).not.toMatch(/PRIVATE|token|termination/);
  },
  15000,
);
