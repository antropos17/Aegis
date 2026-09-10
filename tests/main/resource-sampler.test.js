import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createResourceSampler } = require('../../src/main/resource-sampler');

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('resource sampling under load', () => {
  it('keeps one active query, skips busy ticks, and samples a fresh identity on the next tick', async () => {
    const pending = deferred();
    const collect = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce([]);
    const sampler = createResourceSampler(collect);
    const targets = [{ pid: 100, instanceId: '100:1000' }];
    const first = sampler.sample(targets);
    targets[0].instanceId = '100:2000';
    for (let tick = 0; tick < 20; tick++) expect(await sampler.sample(targets)).toBeNull();
    expect(collect).toHaveBeenCalledTimes(1);
    expect(collect).toHaveBeenNthCalledWith(1, [{ pid: 100, instanceId: '100:1000' }]);
    pending.resolve([{ pid: 100, instanceId: '100:1000' }]);
    expect(await first).toEqual([{ pid: 100, instanceId: '100:1000' }]);
    // Completing an old query must not start a queued, aging PID snapshot.
    expect(collect).toHaveBeenCalledTimes(1);
    await sampler.sample(targets);
    expect(collect).toHaveBeenNthCalledWith(2, [{ pid: 100, instanceId: '100:2000' }]);
  });

  it('suppresses results after invalidation and preserves the in-flight limit across resume', async () => {
    const pending = deferred();
    const collect = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce([]);
    const sampler = createResourceSampler(collect);
    const first = sampler.sample([{ pid: 1, instanceId: '1:1000' }]);
    sampler.invalidate();
    expect(await sampler.sample([{ pid: 2, instanceId: '2:2000' }])).toBeNull();
    pending.resolve([{ pid: 1, instanceId: '1:1000' }]);
    expect(await first).toBeNull();
    expect(await sampler.sample([])).toEqual([]);
    expect(collect).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])(
    'recovers after a provider failure (synchronous=%s)',
    async (synchronous) => {
      const error = new Error('provider failed');
      const collect = vi
        .fn()
        .mockImplementationOnce(() => {
          if (synchronous) throw error;
          return Promise.reject(error);
        })
        .mockResolvedValueOnce([]);
      const sampler = createResourceSampler(collect);
      await expect(sampler.sample([])).rejects.toBe(error);
      await expect(sampler.sample([])).resolves.toEqual([]);
    },
  );

  it('keeps distinct unstamped PIDs and valid empty results', async () => {
    const targets = [
      { pid: 1, instanceId: null },
      { pid: 2, instanceId: null },
    ];
    const collect = vi.fn().mockResolvedValue([]);
    expect(await createResourceSampler(collect).sample(targets)).toEqual([]);
    expect(collect).toHaveBeenCalledWith(targets);
  });
});
