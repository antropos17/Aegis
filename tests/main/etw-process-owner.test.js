import { afterEach, describe, expect, test, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const api = require('../../src/main/platform/etw-process-owner');
const generation = '11111111222233334444555555555555';
const provider = '22fb2cd6-0e7b-422b-a0c7-2fad1fd0e716';
const receipt = {
  callbacks: 0,
  admitted: 0,
  unknown: 0,
  dropped: 0,
  providerFailures: 0,
  nativeStopStatus: 0,
  consumerCompleted: true,
  consumerSucceeded: true,
  loss: { nativeEventsLost: 0, nativeBuffersLost: 0 },
};
const wire = () =>
  Buffer.from(
    JSON.stringify(
      ['begin', 'stopping', 'stop'].map((type, i) => ({
        protocol: 'aegis-etw-process-diagnostic',
        version: 1,
        provider,
        generation,
        sequence: i + 1,
        type,
        observation: null,
        receipt: i === 2 ? receipt : null,
      })),
    ),
  );
function harness(options = {}) {
  vi.useFakeTimers();
  let clock = 100;
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn(() => true);
  const launchFixture = vi.fn(() => child);
  api._setDepsForTest({ launchFixture, mono: () => clock });
  const owner = api.createProcessOwner({
    budgetMs: 100,
    graceMs: 20,
    maxOutputBytes: 4096,
    ...options,
  });
  const done = owner.runFixture('normal', generation);
  const advance = async (ms) => {
    clock += ms;
    await vi.advanceTimersByTimeAsync(ms);
  };
  const close = (code = 0) => {
    child.emit('exit', code, null);
    child.stdout.emit('close');
    child.stderr.emit('close');
  };
  return {
    child,
    owner,
    done,
    advance,
    close,
    launchFixture,
    setClock: (value) => {
      clock = value;
    },
  };
}
afterEach(() => {
  api._resetForTest();
  vi.useRealTimers();
});

describe('one original child lifetime', () => {
  test('requires exit and both output stream closures before admitting terminal evidence', async () => {
    const h = harness();
    h.child.stdout.emit('data', wire());
    h.child.emit('exit', 0, null);
    expect(h.owner.snapshot().state).toBe('running');
    h.child.stdout.emit('close');
    expect(h.owner.snapshot().state).toBe('running');
    h.child.stderr.emit('close');
    const result = await h.done;
    expect(result.state).toBe('closed');
    expect(result.nativeStopStatus).toBe(0);
    expect(result.transportDrained).toBe(true);
    expect(result.launchAllowed).toBe(false);
    expect(h.child.kill).not.toHaveBeenCalled();
    expect(() => h.owner.runFixture('normal', generation)).toThrow('owner-used');
    expect(h.launchFixture).toHaveBeenCalledTimes(1);
  });
  test('blocked stop triggers one original-handle termination and sticky unknown cleanup', async () => {
    const h = harness();
    await h.advance(100);
    expect(h.child.kill).toHaveBeenCalledTimes(1);
    expect(() => api.createProcessOwner().runFixture('normal', generation)).toThrow(
      'owner-cleanup-pending',
    );
    await h.advance(20);
    const result = await h.done;
    expect(result.state).toBe('cleanup-unknown');
    expect(result.cleanupUnknown).toBe(true);
    expect(result.nativeStopStatus).toBeNull();
    expect(result.finalCounter).toBeNull();
    expect(result.loss).toEqual({ nativeEventsLost: null, nativeBuffersLost: null });
    h.child.stdout.emit('data', wire());
    h.close();
    expect(h.owner.snapshot().cleanupUnknown).toBe(true);
    expect(h.owner.snapshot().diagnosticComplete).toBe(false);
    expect(() => api.createProcessOwner().runFixture('normal', generation)).toThrow(
      'owner-cleanup-pending',
    );
    expect(() => h.owner.runFixture('normal', generation)).toThrow('owner-used');
    expect(h.child.kill).toHaveBeenCalledTimes(1);
  });
  test('absolute deadline rejects output even when the timer callback has not run', async () => {
    const h = harness();
    h.setClock(201);
    h.child.stdout.emit('data', wire());
    h.close();
    const result = await h.done;
    expect(result.failure).toBe('deadline');
    expect(result.nativeStopStatus).toBeNull();
    expect(result.transportDrained).toBe(false);
    expect(h.child.kill).toHaveBeenCalledTimes(1);
  });
  test('closure past cleanup grace stays unknown even when no timer callback ran', async () => {
    const h = harness();
    h.child.stdout.emit('data', wire());
    h.setClock(221);
    h.close();
    const result = await h.done;
    expect(result.cleanupUnknown).toBe(true);
    expect(result.state).toBe('cleanup-unknown');
    expect(result.nativeStopStatus).toBeNull();
    expect(() => api.createProcessOwner().runFixture('normal', generation)).toThrow(
      'owner-cleanup-pending',
    );
  });
  test('another owner cannot acquire a concurrent child lifetime', async () => {
    const h = harness();
    expect(() => api.createProcessOwner().runFixture('normal', generation)).toThrow(
      'owner-cleanup-pending',
    );
    h.child.stdout.emit('data', wire());
    h.close();
    await h.done;
    expect(h.launchFixture).toHaveBeenCalledTimes(1);
  });
  test('partial output and wall-clock changes cannot renew the monotonic deadline', async () => {
    const h = harness();
    await h.advance(60);
    h.child.stdout.emit('data', Buffer.from('['));
    vi.setSystemTime(new Date('2035-01-01T00:00:00Z'));
    await h.advance(40);
    expect(h.owner.snapshot().failure).toBe('deadline');
    h.close();
    expect((await h.done).nativeStopStatus).toBeNull();
  });
  test('a false kill result is only an attempt and never establishes exit', async () => {
    const h = harness();
    h.child.kill.mockReturnValue(false);
    await h.advance(120);
    const result = await h.done;
    expect(result.cleanupUnknown).toBe(true);
    expect(result.exited).toBe(false);
    expect(result.terminationAttempted).toBe(true);
    expect(h.child.kill).toHaveBeenCalledTimes(1);
  });
  test('stream closures without original exit cannot establish closed', async () => {
    const h = harness();
    h.child.stdout.emit('data', wire());
    h.child.stdout.emit('close');
    h.child.stderr.emit('close');
    await h.advance(120);
    const result = await h.done;
    expect(result.state).toBe('cleanup-unknown');
    expect(result.exited).toBe(false);
    expect(result.nativeStopStatus).toBeNull();
  });
  test.each(['stderr', 'stream-error', 'nonzero-exit', 'missing-stop', 'native-failure'])(
    '%s cannot admit complete evidence',
    async (mode) => {
      const h = harness();
      let frames = JSON.parse(wire());
      if (mode === 'missing-stop') frames = frames.slice(0, 2);
      if (mode === 'native-failure') frames[2].receipt.nativeStopStatus = 5;
      h.child.stdout.emit('data', Buffer.from(JSON.stringify(frames)));
      if (mode === 'stderr') h.child.stderr.emit('data', Buffer.from('private detail'));
      if (mode === 'stream-error') h.child.stdout.emit('error', new Error('private detail'));
      h.close(mode === 'nonzero-exit' ? 7 : 0);
      const result = await h.done;
      expect(result.transportDrained).toBe(false);
      expect(result.nativeStopStatus).toBeNull();
      expect(JSON.stringify(result)).not.toContain('private detail');
    },
  );
  test('a failed kill never establishes cleanup, and an exit without stream closure is insufficient', async () => {
    const h = harness();
    h.child.kill.mockImplementation(() => {
      throw new Error('private detail');
    });
    await h.advance(100);
    h.child.emit('exit', 0, null);
    await h.advance(20);
    const result = await h.done;
    expect(result.state).toBe('cleanup-unknown');
    expect(result.streamsClosed).toBe(false);
    expect(result.failure).toBe('deadline');
    expect(JSON.stringify(result)).not.toContain('private detail');
  });
  test.each(['partial', 'malformed', 'missing'])(
    'exit cannot manufacture native success for %s output',
    async (mode) => {
      const h = harness();
      if (mode !== 'missing')
        h.child.stdout.emit('data', Buffer.from(mode === 'partial' ? '[' : '{}'));
      h.close();
      const result = await h.done;
      expect(result.nativeStopStatus).toBeNull();
      expect(result.finalCounter).toBeNull();
      expect(result.transportDrained).toBe(false);
      expect(result.diagnosticComplete).toBe(false);
    },
  );
  test('bounds combined output, discards content and terminates only once', async () => {
    const h = harness({ maxOutputBytes: 64 });
    h.child.stderr.emit('data', Buffer.alloc(65, 120));
    h.child.stdout.emit('data', Buffer.alloc(50000, 121));
    expect(h.owner.snapshot().retainedBytes).toBeLessThanOrEqual(64);
    expect(h.child.kill).toHaveBeenCalledTimes(1);
    h.close();
    const result = await h.done;
    expect(result.failure).toBe('output-limit');
    expect(result.nativeStopStatus).toBeNull();
    expect(result).not.toHaveProperty('stdout');
  });
  test('late exit after deadline invalidates otherwise valid pre-deadline output', async () => {
    const h = harness();
    h.child.stdout.emit('data', wire());
    h.setClock(200);
    h.close();
    expect((await h.done).nativeStopStatus).toBeNull();
  });
  test('spawn errors and child errors stay sanitized and cannot admit another child', async () => {
    const h = harness();
    h.child.emit('error', new Error('private detail'));
    h.close();
    expect((await h.done).failure).toBe('child-error');
    expect(h.child.kill).toHaveBeenCalledTimes(1);
    expect(() => h.owner.runFixture('normal', generation)).toThrow('owner-used');
  });
  test('launch failure is terminal and sanitized', async () => {
    api._setDepsForTest({
      launchFixture: () => {
        throw new Error('private');
      },
    });
    const owner = api.createProcessOwner();
    expect((await owner.runFixture('normal', generation)).failure).toBe('launch-failed');
    expect(() => owner.runFixture('normal', generation)).toThrow('owner-used');
  });
  test('expired preparation does not launch a child or renew the original deadline', async () => {
    let clock = 0;
    const launchFixture = vi.fn();
    api._setDepsForTest({ mono: () => clock, launchFixture });
    const owner = api.createProcessOwner({ budgetMs: 10 });
    clock = 10;
    expect((await owner.runFixture('normal', generation)).state).toBe('not-launched');
    expect(launchFixture).not.toHaveBeenCalled();
  });
  test('refuses command-like modes, malformed generations and unbounded configuration', () => {
    const owner = api.createProcessOwner();
    expect(() => owner.runFixture('--capture', generation)).toThrow('invalid-fixture');
    expect(() => owner.runFixture('normal', '../private')).toThrow('invalid-fixture');
    expect(() => api.createProcessOwner({ budgetMs: Infinity })).toThrow('owner-invalid-bound');
    expect(() => api.createProcessOwner({ maxOutputBytes: 1048577 })).toThrow(
      'owner-invalid-bound',
    );
  });
});

describe('actual disposable nonprivileged JavaScript child', () => {
  test.each(['normal', 'partial', 'malformed', 'overflow', 'blocked-stop', 'blocked-consumer'])(
    '%s stays inside fixed fixture boundary',
    async (mode) => {
      const owner = api.createProcessOwner({
        budgetMs: mode.startsWith('blocked') ? 300 : 2000,
        graceMs: 1000,
      });
      const result = await owner.runFixture(mode, generation);
      expect(result.exited).toBe(true);
      expect(result.streamsClosed).toBe(true);
      expect(result.cleanupUnknown).toBe(false);
      expect(result.launchAllowed).toBe(false);
      expect(result.evidenceScope).toBe('synthetic-supervision');
      if (mode === 'normal') expect(result.diagnosticComplete).toBe(true);
      else {
        expect(result.failure).toBe(
          mode.startsWith('blocked')
            ? 'deadline'
            : mode === 'overflow'
              ? 'output-limit'
              : 'invalid-terminal',
        );
        expect(result.terminationAttempted).toBe(mode.startsWith('blocked') || mode === 'overflow');
        expect(result.diagnosticComplete).toBe(false);
        expect(result.nativeStopStatus).toBeNull();
        expect(result.finalCounter).toBeNull();
      }
    },
  );
});

const compiledDll = process.env.AEGIS_PROCESS_SHUTDOWN_FIXTURE_DLL;
const dotnet = process.env.AEGIS_PROCESS_SHUTDOWN_DOTNET;
const requireCompiled = process.env.AEGIS_PROCESS_SHUTDOWN_REQUIRE_COMPILED === '1';
describe('unchanged C# coordinator with fake session and consumer', () => {
  test
    .skipIf(!requireCompiled && (!compiledDll || !dotnet))
    .each(['normal', 'blocked-stop', 'blocked-consumer', 'partial', 'malformed'])(
    '%s has original-child terminal evidence',
    async (mode) => {
      expect(
        compiledDll && path.isAbsolute(compiledDll) && fs.existsSync(compiledDll),
      ).toBeTruthy();
      expect(dotnet && path.isAbsolute(dotnet) && fs.existsSync(dotnet)).toBeTruthy();
      let blockedStopEntered = false;
      let markerText = '';
      api._setDepsForTest({
        launchFixture: (selected, id) => {
          const child = spawn(dotnet, [compiledDll, selected, id], {
            windowsHide: true,
            shell: false,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: {
              SystemRoot: process.env.SystemRoot,
              TEMP: process.env.TEMP,
              TMP: process.env.TMP,
              DOTNET_EnableDiagnostics: '0',
            },
          });
          child.stderr.on('data', (bytes) => {
            markerText = (markerText + bytes.toString('utf8')).slice(0, 128);
            if (markerText.includes('fixture-blocked-stop-entered')) blockedStopEntered = true;
          });
          return child;
        },
      });
      const owner = api.createProcessOwner({
        budgetMs: mode === 'blocked-stop' ? 500 : 2000,
        graceMs: 1000,
      });
      const result = await owner.runFixture(mode, generation);
      expect(result.exited).toBe(true);
      expect(result.streamsClosed).toBe(true);
      expect(result.cleanupUnknown).toBe(false);
      expect(result.launchAllowed).toBe(false);
      if (mode === 'blocked-stop') expect(blockedStopEntered).toBe(true);
      if (mode === 'normal') {
        expect(result.diagnosticComplete).toBe(true);
        expect(result.nativeStopStatus).toBe(0);
      } else {
        expect(result.nativeStopStatus).toBeNull();
        expect(result.finalCounter).toBeNull();
        expect(result.loss).toEqual({ nativeEventsLost: null, nativeBuffersLost: null });
        expect(result.transportDrained).toBe(false);
        expect(result.diagnosticComplete).toBe(false);
        expect(result.failure).toBe(
          mode === 'blocked-stop'
            ? 'deadline'
            : mode === 'blocked-consumer'
              ? 'incomplete-terminal'
              : 'invalid-terminal',
        );
      }
    },
  );
});
