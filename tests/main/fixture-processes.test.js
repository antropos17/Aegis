import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { createFixtureProcesses } from '../helpers/fixture-processes';

describe('owned fixture process teardown', () => {
  it('waits for helper close after a failed test requests termination', async () => {
    const child = new EventEmitter();
    child.kill = vi.fn();
    const owned = createFixtureProcesses();
    owned.track(child);
    let settled = false;
    const teardown = owned.stopAndWait().then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(settled).toBe(false);
    child.emit('close');
    await teardown;
    expect(settled).toBe(true);
  });

  it('fails teardown when an owned descendant survives the bounded wait', async () => {
    const kill = vi.fn(() => true);
    const owned = createFixtureProcesses({ kill, timeoutMs: 30 });
    await expect(owned.stopAndWait([12345])).rejects.toThrow('fixture-processes-still-running');
    expect(kill).toHaveBeenCalledWith(12345, 'SIGKILL');
    expect(kill).toHaveBeenCalledWith(12345, 0);
  });
});
