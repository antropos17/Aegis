import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

const require = createRequire(import.meta.url);
const api = require('../../src/main/action-confirmation-terminal');
const tick = () => new Promise(setImmediate);
const launch = () => ({
  executable: 'X:/PRIVATE/node.exe',
  cwd: 'X:/PRIVATE',
  args: ['literal'],
  env: { PRIVATE: 'value' },
});
function setup({ hold = false, tty = true, writeError = false, readable = false } = {}) {
  const input = readable
    ? Object.assign(new PassThrough(), { isTTY: tty })
    : Object.assign(new EventEmitter(), {
        isTTY: tty,
        resume: vi.fn(),
        pause: vi.fn(),
        setEncoding: vi.fn(),
      });
  const output = Object.assign(new EventEmitter(), { isTTY: tty });
  const processEvents = new EventEmitter();
  let preview = '';
  let drained;
  output.write = vi.fn((text, callback) => {
    preview += text;
    drained = callback;
    if (!hold) queueMicrotask(() => callback?.(writeError ? Error('PRIVATE_WRITE') : undefined));
    return true;
  });
  api._setDepsForTest({
    input,
    output,
    process: processEvents,
    randomBytes: () => Buffer.from('a1b2c3d4', 'hex'),
  });
  return {
    input,
    output,
    processEvents,
    preview: () => preview,
    drain: () => drained?.(),
    run: (value = launch(), options) => api.confirmInTerminal(value, options),
  };
}
afterEach(() => {
  api._resetForTest();
  vi.useRealTimers();
});

describe('terminal-owned explicit action confirmation', () => {
  it('explains creation and retention of the isolated workspace before confirmation', async () => {
    const t = setup();
    const pending = t.run(launch(), { kind: 'appcontainer-launch' });
    await tick();
    expect(t.preview()).toContain('Windows AppContainer');
    expect(t.preview()).toContain('cwd must be NEW');
    expect(t.preview()).toContain('retains its contents');
    expect(t.preview()).not.toContain('keeps your account privileges');
    t.input.emit('data', Buffer.from('RUN a1b2c3d4\n'));
    expect(await pending).toBe(true);
  });

  it('requires the deletion-specific challenge for an exact file operation', async () => {
    const t = setup();
    const operation = { kind: 'delete-file', path: 'X:/PRIVATE/file.txt' };
    const denied = t.run(operation, { kind: 'delete-file' });
    await tick();
    expect(t.preview()).toContain('ONE file deletion');
    expect(t.preview()).toContain(operation.path);
    t.input.emit('data', Buffer.from('RUN a1b2c3d4\n'));
    expect(await denied).toBe(false);
    const accepted = t.run(operation, { kind: 'delete-file' });
    await tick();
    t.input.emit('data', Buffer.from('DELETE a1b2c3d4\n'));
    expect(await accepted).toBe(true);
  });

  it('observes real stream EOF after accepted confirmation paused the terminal input', async () => {
    const input = Object.assign(new PassThrough(), { isTTY: true });
    const output = Object.assign(new PassThrough(), { isTTY: true });
    output.resume();
    api._setDepsForTest({
      input,
      output,
      process: new EventEmitter(),
      randomBytes: () => Buffer.from('a1b2c3d4', 'hex'),
    });
    const abort = vi.fn();
    const stopWatching = api.watchTerminalLifetime(abort);
    let stopReading;
    try {
      const done = api.confirmInTerminal(launch());
      await tick();
      input.write('RUN a1b2c3d4\n');
      expect(await done).toBe(true);
      expect(input.isPaused()).toBe(true);
      stopReading = api.monitorTerminalInput(abort);
      input.end();
      await tick();
      expect(input.readableEnded).toBe(true);
      expect(abort).toHaveBeenCalled();
    } finally {
      stopReading?.();
      stopWatching();
      input.destroy();
      output.destroy();
    }
  });

  it('caps discarded post-confirmation input and pauses a real stream on overflow', async () => {
    const input = Object.assign(new PassThrough(), { isTTY: true });
    const output = Object.assign(new PassThrough(), { isTTY: true });
    output.resume();
    api._setDepsForTest({
      input,
      output,
      process: new EventEmitter(),
      randomBytes: () => Buffer.from('a1b2c3d4', 'hex'),
    });
    const abort = vi.fn();
    let stopReading;
    try {
      const done = api.confirmInTerminal(launch());
      await tick();
      input.write('RUN a1b2c3d4\n');
      expect(await done).toBe(true);
      stopReading = api.monitorTerminalInput(abort);
      input.write(Buffer.alloc(api.LIMITS.inputBytes));
      await tick();
      expect(abort).not.toHaveBeenCalled();
      input.write('X');
      await tick();
      expect(abort).toHaveBeenCalledOnce();
      expect(input.isPaused()).toBe(true);
      stopReading();
      expect(input.listenerCount('data')).toBe(0);
    } finally {
      stopReading?.();
      input.destroy();
      output.destroy();
    }
  });
  it('continues watching terminal closure after a challenge has been accepted', async () => {
    const t = setup();
    const abort = vi.fn();
    const stop = api.watchTerminalLifetime(abort);
    try {
      const done = t.run();
      await tick();
      t.input.emit('data', Buffer.from('RUN a1b2c3d4\n'));
      expect(await done).toBe(true);
      t.input.emit('end');
      expect(abort).toHaveBeenCalledOnce();
    } finally {
      stop();
    }
    expect(t.input.listenerCount('end')).toBe(0);
  });
  it('accepts exactly one fresh challenge after the full preview drains', async () => {
    const t = setup();
    const done = t.run();
    await tick();
    expect(t.preview()).toContain('a1b2c3d4');
    expect(t.preview()).toContain('PRIVATE');
    t.input.emit('data', Buffer.from('RUN a1b2c3d4\n'));
    expect(await done).toBe(true);
    expect(t.input.listenerCount('data')).toBe(0);
    expect(t.processEvents.listenerCount('SIGINT')).toBe(0);
  });

  it.each(['yes\n', 'RUN deadbeef\n', 'RUN a1b2c3d4 EXTRA\n', 'run a1b2c3d4\n'])(
    'rejects a nonexact answer %j',
    async (answer) => {
      const t = setup();
      const done = t.run();
      await tick();
      t.input.emit('data', Buffer.from(answer));
      expect(await done).toBe(false);
    },
  );

  it('accepts a complete challenge split across input chunks', async () => {
    const t = setup();
    const done = t.run();
    await tick();
    t.input.emit('data', Buffer.from('RUN a1b2'));
    t.input.emit('data', Buffer.from('c3d4\r\n'));
    expect(await done).toBe(true);
  });

  it('escapes control and non-ASCII text instead of emitting terminal control sequences', async () => {
    const t = setup();
    const done = t.run({
      ...launch(),
      args: ['\u001b]52;c;PRIVATE\u0007', '\u202ePRIVATE', 'é', '\nFAKE COMMAND'],
    });
    await tick();
    expect(t.preview()).not.toMatch(/[\x00-\x08\x0b-\x1f\x7f-\uffff]/);
    expect(t.preview()).toContain('\\u001b');
    expect(t.preview()).toContain('\\u202e');
    expect(t.preview()).toContain('\\u00e9');
    t.input.emit('end');
    expect(await done).toBe(false);
  });

  it('denies overlong previews without displaying a truncated action', async () => {
    const t = setup();
    expect(await t.run({ ...launch(), args: ['X'.repeat(api.LIMITS.previewBytes)] })).toBe(false);
    expect(t.preview()).toBe('');
  });

  it('rejects piped input before any private preview is written', async () => {
    const t = setup({ tty: false });
    expect(api.isTerminalAvailable()).toBe(false);
    expect(await t.run()).toBe(false);
    expect(t.preview()).toBe('');
  });

  it.each(['end', 'close', 'error', 'SIGINT', 'abort'])(
    'denies on %s and detaches input listeners',
    async (event) => {
      const t = setup();
      const controller = new AbortController();
      const done = t.run(launch(), { signal: controller.signal });
      await tick();
      if (event === 'abort') controller.abort();
      else if (event === 'SIGINT') t.processEvents.emit(event);
      else t.input.emit(event, event === 'error' ? Error('PRIVATE_INPUT') : undefined);
      expect(await done).toBe(false);
      expect(t.input.listenerCount('data')).toBe(0);
    },
  );

  it('rejects oversized input and invalid UTF-8', async () => {
    for (const input of [Buffer.alloc(api.LIMITS.inputBytes + 1, 65), Buffer.from([0xff, 10])]) {
      const t = setup();
      const done = t.run();
      await tick();
      t.input.emit('data', input);
      expect(await done).toBe(false);
    }
  });

  it('denies write failure without accepting input', async () => {
    const t = setup({ writeError: true });
    expect(await t.run()).toBe(false);
    expect(t.input.listenerCount('data')).toBe(0);
  });

  it('absorbs the delayed stream error that can follow a failed write callback', async () => {
    const t = setup({ writeError: true });
    expect(await t.run()).toBe(false);
    expect(() => t.output.emit('error', Error('PRIVATE_LATE_ERROR'))).not.toThrow();
  });

  it('does not admit a response received before the preview drains', async () => {
    const t = setup({ hold: true });
    const done = t.run();
    t.input.emit('data', Buffer.from('RUN a1b2c3d4\n'));
    t.drain();
    t.input.emit('end');
    expect(await done).toBe(false);
  });

  it('rejects an exact response written to a real Readable before the preview drains', async () => {
    const t = setup({ hold: true, readable: true });
    try {
      const done = t.run();
      t.input.write('RUN a1b2c3d4\n');
      t.drain();
      expect(await done).toBe(false);
      expect(t.input.listenerCount('data')).toBe(0);
    } finally {
      t.input.destroy();
    }
  });

  it('refuses bytes already queued before review even when the preview callback completes immediately', async () => {
    const t = setup({ hold: true, readable: true });
    try {
      t.input.write('RUN a1b2c3d4\n');
      const done = t.run();
      t.drain();
      expect(await done).toBe(false);
      expect(t.input.listenerCount('data')).toBe(0);
    } finally {
      t.input.destroy();
    }
  });

  it('refuses input buffered during preview without waiting for its data event', async () => {
    const t = setup({ hold: true, readable: true });
    try {
      const done = t.run();
      t.input.pause();
      t.input.write('RUN a1b2c3d4\n');
      expect(t.input.readableLength).toBeGreaterThan(0);
      t.drain();
      expect(await done).toBe(false);
      expect(t.input.listenerCount('data')).toBe(0);
    } finally {
      t.input.destroy();
    }
  });

  it('accepts a fresh split response on a real Readable after preview drain and cleans its readers', async () => {
    const t = setup({ hold: true, readable: true });
    const controller = new AbortController();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const done = t.run(launch(), { signal: controller.signal });
      t.drain();
      t.input.write('RUN a1b2');
      t.input.write('c3d4\r\n');
      expect(await done).toBe(true);
      expect(t.input.isPaused()).toBe(true);
      expect(t.input.listenerCount('data')).toBe(0);
      expect(t.input.listenerCount('end')).toBe(0);
      expect(t.output.listenerCount('close')).toBe(0);
      expect(t.processEvents.listenerCount('SIGINT')).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      t.input.destroy();
    }
  });

  it('keeps cancellation final on a real Readable despite a late preview callback and answer', async () => {
    const t = setup({ hold: true, readable: true });
    const controller = new AbortController();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const done = t.run(launch(), { signal: controller.signal });
      controller.abort();
      expect(await done).toBe(false);
      t.drain();
      t.input.write('RUN a1b2c3d4\n');
      expect(t.input.isPaused()).toBe(true);
      expect(t.input.listenerCount('data')).toBe(0);
      expect(t.input.listenerCount('end')).toBe(0);
      expect(t.output.listenerCount('close')).toBe(0);
      expect(t.processEvents.listenerCount('SIGINT')).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      t.input.destroy();
    }
  });

  it('bounds preview drain and cannot accept a late callback or answer', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const t = setup({ hold: true });
    const done = t.run();
    await vi.advanceTimersByTimeAsync(api.LIMITS.drainMs + 1);
    expect(await done).toBe(false);
    t.drain();
    t.input.emit('data', Buffer.from('RUN a1b2c3d4\n'));
    expect(t.input.listenerCount('data')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds unanswered review and ignores late input', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const t = setup();
    const done = t.run();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(api.LIMITS.reviewMs + 1);
    expect(await done).toBe(false);
    t.input.emit('data', Buffer.from('RUN a1b2c3d4\n'));
    expect(t.input.listenerCount('data')).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
