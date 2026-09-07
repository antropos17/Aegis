import { describe, it, expect } from 'vitest';
import { createQueue } from '../../src/main/watch-event-queue.js';

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('worker event backpressure', () => {
  it('holds one message in flight, bounds pending events and reports every rejected event', async () => {
    const sent = [];
    const q = createQueue((batch) => sent.push(batch), { maxEvents: 4, batchSize: 2 });
    q.event('add', 'first');
    await tick();
    for (let i = 0; i < 1000; i++) q.event('change', `file-${i}`);
    q.ready();
    q.error();
    await tick();
    expect(sent).toHaveLength(1);
    q.ack(999); // A stray acknowledgement cannot release the gate.
    await tick();
    expect(sent).toHaveLength(1);
    q.ack(sent[0].seq);
    await tick();
    expect(sent[1]).toMatchObject({
      ready: true,
      error: 'watch-worker-provider-error',
      dropped: 996,
    });
    expect(sent[1].events.map((e) => e.path)).toEqual(['file-0', 'file-1']);
    q.ack(sent[1].seq);
    await tick();
    expect(sent[2].events.map((e) => e.path)).toEqual(['file-2', 'file-3']);
    q.ack(sent[2].seq);
    await tick();
    expect(sent).toHaveLength(3);
    q.close();
  });

  it('bounds path bytes even below the event cap, without losing control state', async () => {
    const sent = [];
    const q = createQueue((batch) => sent.push(batch), { maxBytes: 100 });
    q.event('add', 'é'.repeat(40)); // 80 bytes plus envelope exceeds the budget.
    q.event('unlink', 'kept');
    q.ready();
    await tick();
    expect(sent[0]).toMatchObject({
      dropped: 1,
      ready: true,
      events: [{ type: 'unlink', path: 'kept' }],
    });
    q.close();
  });

  it('cancels scheduled and queued delivery on close', async () => {
    const sent = [];
    const q = createQueue((batch) => sent.push(batch));
    q.event('add', 'discarded-on-stop');
    q.close();
    q.ready();
    q.error();
    q.event('change', 'late');
    await tick();
    expect(sent).toEqual([]);
  });
});
