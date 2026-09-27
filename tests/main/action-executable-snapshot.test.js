import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const { captureExecutableSnapshot, HASH_MS } = require('../../src/main/action-executable-snapshot');
const whoami = path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'whoami.exe');

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe.skipIf(process.platform !== 'win32')('bounded executable approval snapshot', () => {
  it('captures only a private size and digest before the terminal review', async () => {
    const snapshot = await captureExecutableSnapshot(whoami);
    expect(snapshot).toEqual({
      path: whoami,
      size: fs.statSync(whoami).size,
      sha256: createHash('sha256').update(fs.readFileSync(whoami)).digest('hex'),
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
  });

  it('rejects at the deadline even when one filesystem operation never settles', async () => {
    vi.useFakeTimers();
    vi.spyOn(fs.promises, 'lstat').mockImplementation(() => new Promise(() => {}));
    const pending = captureExecutableSnapshot(whoami);
    const rejected = expect(pending).rejects.toThrow('executable-unavailable');
    await vi.advanceTimersByTimeAsync(HASH_MS);
    await rejected;
  });

  it('rejects cancellation while an asynchronous filesystem operation is pending', async () => {
    vi.spyOn(fs.promises, 'lstat').mockImplementation(() => new Promise(() => {}));
    const controller = new AbortController();
    const pending = captureExecutableSnapshot(whoami, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow('executable-unavailable');
  });
});
