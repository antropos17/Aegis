import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
const require = createRequire(import.meta.url);
const {
  createWindowsObserver,
  validateCwds,
  parseNativeHolders,
} = require('../../src/main/platform/windows-observer');

function harness(responses, options = {}) {
  const inputs = [];
  const execFile = vi.fn((file, args, settings, cb) => {
    const stdin = new EventEmitter();
    stdin.end = (text, encoding) => {
      inputs.push({ text, encoding });
      const result = responses.shift();
      queueMicrotask(() => (result instanceof Error ? cb(result) : cb(null, result)));
    };
    return { stdin };
  });
  return {
    execFile,
    inputs,
    client: createWindowsObserver({
      execFile,
      resolveExe: () => '/fixed/observer.exe',
      ...options,
    }),
  };
}
const response = (rows) => JSON.stringify({ version: 1, rows });

describe('one-shot Windows observer', () => {
  it.each([false, true])(
    'uses only the authoritative packaged/development helper path (%s)',
    async (development) => {
      const fs = require('node:fs'),
        path = require('node:path');
      const savedResources = Object.getOwnPropertyDescriptor(process, 'resourcesPath');
      const savedDefault = Object.getOwnPropertyDescriptor(process, 'defaultApp');
      const check = vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      try {
        Object.defineProperty(process, 'resourcesPath', {
          configurable: true,
          value: '/installed/resources',
        });
        Object.defineProperty(process, 'defaultApp', { configurable: true, value: development });
        const client = createWindowsObserver({ execFile: vi.fn(), mode: 'auto' });
        expect(await client.tryRequest('tcp', { pids: [42] }, (r) => r)).toBeNull();
        const expected = development
          ? path.join(
              path.dirname(require.resolve('../../src/main/platform/windows-observer')),
              '../../..',
              'build/sidecar/aegis-observer.exe',
            )
          : path.join('/installed/resources', 'sidecar/aegis-observer.exe');
        expect(check.mock.calls).toEqual([[expected]]);
      } finally {
        check.mockRestore();
        if (savedResources) Object.defineProperty(process, 'resourcesPath', savedResources);
        else delete process.resourcesPath;
        if (savedDefault) Object.defineProperty(process, 'defaultApp', savedDefault);
        else delete process.defaultApp;
      }
    },
  );
  it('uses bounded stdin transport, returns fresh empty observations and sends no paths in argv/env', async () => {
    const { client, execFile, inputs } = harness([
      response([{ index: 0, pids: [42] }]),
      response([{ index: 0, pids: [] }]),
    ]);
    const groups = [{ group: 'private-directory', reason: 'SSH', files: ['private-path'] }];
    const query = () =>
      client.tryRequest('holders', { groups: groups.map((g) => g.files) }, (rows) =>
        parseNativeHolders(rows, groups),
      );
    expect(await query()).toEqual([{ pid: 42, group: 'private-directory', reason: 'SSH' }]);
    expect(await query()).toEqual([]);
    expect(execFile.mock.calls[0].slice(0, 3)).toEqual([
      '/fixed/observer.exe',
      ['holders'],
      { timeout: 10000, maxBuffer: 2097152, windowsHide: true },
    ]);
    expect(inputs[0]).toEqual({ text: '{"groups":[["private-path"]]}', encoding: 'utf8' });
  });
  it.each([
    new Error('private OS error'),
    'broken',
    '{}',
    response(null),
    '{"version":2,"rows":[]}',
  ])('falls back on transport/protocol failure (%s)', async (failure) => {
    const { client } = harness([failure]);
    expect(await client.tryRequest('tcp', { pids: [42] }, (r) => r)).toBeNull();
  });
  it('cools down per kind, retries after 60 seconds and never reuses a reading', async () => {
    let now = 0;
    const { client, execFile } = harness(
      [new Error('failure'), response([]), response([{ ProcessId: 42, CommandLine: null }])],
      { now: () => now },
    );
    expect(await client.tryRequest('cwd', { pids: [42] }, (r) => r)).toBeNull();
    expect(await client.tryRequest('cwd', { pids: [42] }, (r) => r)).toBeNull();
    expect(await client.tryRequest('tcp', { pids: [42] }, (r) => r)).toEqual([]);
    now = 60000;
    expect(await client.tryRequest('cwd', { pids: [42] }, (r) => validateCwds(r, [42]))).toEqual([
      { ProcessId: 42, CommandLine: null },
    ]);
    expect(execFile).toHaveBeenCalledTimes(3);
  });
  it('falls back on invalid parsed rows rather than reporting healthy empty', async () => {
    const { client } = harness([response([{ ProcessId: 99, CommandLine: null }])]);
    expect(await client.tryRequest('cwd', { pids: [42] }, (r) => validateCwds(r, [42]))).toBeNull();
  });
  it.each([{ mode: 'powershell' }, { resolveExe: () => null }])(
    'supports rollback or missing binaries (%j)',
    async (options) => {
      const { client, execFile } = harness([], options);
      expect(await client.tryRequest('tcp', { pids: [42] }, (r) => r)).toBeNull();
      expect(execFile).not.toHaveBeenCalled();
    },
  );
  it('keeps oversized scopes on the fallback path', async () => {
    const { client, execFile } = harness([]);
    expect(await client.tryRequest('cwd', { pids: Array(2049).fill(42) }, (r) => r)).toBeNull();
    expect(
      await client.tryRequest('holders', { groups: [['x'.repeat(524288)]] }, (r) => r),
    ).toBeNull();
    expect(execFile).not.toHaveBeenCalled();
  });
  it('handles early stdin closure and synchronous launch failure', async () => {
    const execFile = (file, args, opts, cb) => {
      const stdin = new EventEmitter();
      stdin.end = () => {
        stdin.emit('error', new Error('EPIPE'));
        cb(new Error('exit'));
      };
      return { stdin };
    };
    expect(
      await createWindowsObserver({ execFile, resolveExe: () => '/helper' }).tryRequest(
        'cwd',
        { pids: [42] },
        (r) => r,
      ),
    ).toBeNull();
    expect(
      await createWindowsObserver({
        execFile: () => {
          throw new Error('spawn');
        },
        resolveExe: () => '/helper',
      }).tryRequest('cwd', { pids: [42] }, (r) => r),
    ).toBeNull();
  });
  it.each([
    [{ ProcessId: 42 }],
    [{ ProcessId: 99, CommandLine: null }],
    [{ ProcessId: 42, CommandLine: 12 }],
    [
      { ProcessId: 42, CommandLine: null },
      { ProcessId: 42, CommandLine: null },
    ],
  ])('rejects malformed or out-of-scope CWD rows (%j)', (...rows) => {
    expect(() => validateCwds(rows, [42])).toThrow();
  });
  it('preserves null, Unicode and exited PID absence in command lines', () => {
    const rows = [
      { ProcessId: 42, CommandLine: 'node --cwd "X:\\проект"' },
      { ProcessId: 43, CommandLine: null },
    ];
    expect(validateCwds(rows, [42, 43, 44])).toBe(rows);
  });
  it.each([[], [{ index: 1, pids: [42] }], [{ index: 0, pids: [-1] }], [{ index: 0, pids: null }]])(
    'rejects incomplete or invalid holder results (%j)',
    (...rows) => {
      expect(() => parseNativeHolders(rows, [{ group: 'x', reason: 'r' }])).toThrow();
    },
  );
});
