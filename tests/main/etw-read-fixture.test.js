import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', async (original) => ({
  ...(await original()),
  spawn: mocks.spawn,
}));
import { readFixture } from '../../frontend/observatory/tests/etw-support.mjs';
import { projectReadFixtureFailure } from '../../frontend/observatory/tests/etw-read-fixture-protocol.mjs';

const canary = 'PRIVATE_FIXTURE_CONTENT_path_token';
let child;
const emit = (value) => child.stdout.write(JSON.stringify(value) + '\n');
const ready = () => ({ command: 'ready', pid: 42, birth: '123', reads: 0 });
const dpiResponse = (overrides = {}) => ({
  command: 'window-dpi',
  schema: 'aegis-window-dpi/1',
  windowExists: true,
  ownerMatched: true,
  dpi: 96,
  ...overrides,
});
const settle = () => vi.advanceTimersByTimeAsync(20);
const finish = (code = 0) => {
  child.exitCode = code;
  child.emit('exit', code, null);
  child.emit('close', code, null);
};
const start = async (short = false) => {
  const fixture = readFixture('owned.exe', 'owned-file', {}, short);
  emit(ready());
  await fixture.next();
  return fixture;
};

describe('actual native read fixture protocol', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    child = Object.assign(new EventEmitter(), {
      pid: 42,
      exitCode: null,
      signalCode: null,
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    });
    mocks.spawn.mockReturnValue(child);
  });

  afterEach(() => {
    for (const stream of [child.stdin, child.stdout, child.stderr]) stream.destroy();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('classifies EOF after a ready command without leaking child output', async () => {
    const fixture = readFixture('owned.exe', 'owned-file', {});
    emit(ready());
    await fixture.next();
    const result = fixture.command('sync').catch((error) => error);
    child.stderr.write(canary);
    child.stdout.end();
    await vi.advanceTimersByTimeAsync(20);
    const error = await result;
    expect(error).toMatchObject({ code: 'AEGIS_READ_FIXTURE_STDOUT_ENDED' });
    expect(error.fixtureDiagnostic).toMatchObject({
      expectedCommand: 'sync',
      stdoutEnded: true,
      stdinFailed: false,
    });
    expect(JSON.stringify({ message: error.message, ...error.fixtureDiagnostic })).not.toContain(
      canary,
    );
  });

  it('roundtrips a target-bound window DPI query through the actual fixture transport', async () => {
    const fixture = await start();
    const response = {
      command: 'window-dpi',
      schema: 'aegis-window-dpi/1',
      windowExists: true,
      ownerMatched: true,
      dpi: 96,
    };
    const pending = Promise.resolve()
      .then(() => fixture.windowDpi({ mainPid: 8872, handle: '1234567890123' }))
      .catch((error) => error);
    await Promise.resolve();
    emit(response);
    await settle();
    expect(child.stdin.read()?.toString()).toBe('window-dpi 8872 1234567890123\n');
    expect(await pending).toEqual(response);
    const read = fixture.command('sync');
    emit({ command: 'sync', reads: 160 });
    await settle();
    expect((await read).reads).toBe(160);
    finish();
    await fixture.close();
  });

  it.each([
    { windowExists: false, ownerMatched: false, dpi: 0 },
    { windowExists: true, ownerMatched: true, dpi: 0xffffffff },
  ])(
    'preserves valid native DPI flags and uint32 values without defaulting (%j)',
    async (flags) => {
      const fixture = await start();
      const pending = fixture.windowDpi({ mainPid: 0x7fffffff, handle: '9223372036854775807' });
      emit(dpiResponse(flags));
      await settle();
      expect(await pending).toEqual(dpiResponse(flags));
      expect(child.stdin.read().toString()).toBe('window-dpi 2147483647 9223372036854775807\n');
    },
  );

  it.each([
    ['zero PID', { mainPid: 0, handle: '1' }],
    ['negative PID', { mainPid: -1, handle: '1' }],
    ['overflow PID', { mainPid: 2147483648, handle: '1' }],
    ['fractional PID', { mainPid: 42.5, handle: '1' }],
    ['text PID', { mainPid: '42', handle: '1' }],
    ['missing target', null],
    ['zero HWND', { mainPid: 42, handle: '0' }],
    ['padded HWND', { mainPid: 42, handle: '01' }],
    ['negative HWND', { mainPid: 42, handle: '-1' }],
    ['whitespace HWND', { mainPid: 42, handle: ' 1' }],
    ['injected HWND', { mainPid: 42, handle: '1\nasync' }],
    ['overflow HWND', { mainPid: 42, handle: '9223372036854775808' }],
    ['numeric HWND', { mainPid: 42, handle: 1 }],
  ])('rejects %s before writing a DPI command', async (_name, target) => {
    const fixture = await start();
    const error = await fixture.windowDpi(target).catch((value) => value);
    expect(error.code).toBe('AEGIS_READ_FIXTURE_PROTOCOL_STATE');
    expect(child.stdin.read()).toBeNull();
  });

  it.each([
    ['schema', { schema: canary }],
    ['command', { command: 'sync' }],
    ['window flag', { windowExists: 1 }],
    ['owner flag', { ownerMatched: 'true' }],
    ['negative DPI', { dpi: -1 }],
    ['fractional DPI', { dpi: 96.5 }],
    ['overflow DPI', { dpi: 4294967296 }],
    ['text DPI', { dpi: '96' }],
    ['extra key', { raw: canary }],
    ['missing key', { ownerMatched: undefined }],
  ])(
    'refuses a malformed DPI %s without retaining the response or target',
    async (_name, patch) => {
      const fixture = await start();
      const pending = fixture
        .windowDpi({ mainPid: 8872, handle: '1234567890123' })
        .catch((error) => error);
      emit(dpiResponse(patch));
      await settle();
      const error = await pending;
      expect(error.code).toBe('AEGIS_READ_FIXTURE_UNEXPECTED_RESPONSE');
      const snapshot = projectReadFixtureFailure(error);
      expect(snapshot).toMatchObject({ phase: 'command', expectedCommand: 'window-dpi' });
      expect(JSON.stringify(snapshot)).not.toContain(canary);
      expect(JSON.stringify(snapshot)).not.toContain('1234567890123');
      expect(JSON.stringify(snapshot)).not.toContain('8872');
      expect(await fixture.command('sync').catch((value) => value)).toBe(error);
      expect(child.stdin.read().toString()).toBe('window-dpi 8872 1234567890123\n');
      expect(child.stdin.read()).toBeNull();
    },
  );

  it.each(['before-ready', 'short'])(
    'requires normal ready ownership before DPI (%s)',
    async (mode) => {
      const fixture = readFixture('owned.exe', 'owned-file', {}, mode === 'short');
      if (mode === 'short') {
        emit(ready());
        await fixture.next();
      }
      const error = await fixture.windowDpi({ mainPid: 42, handle: '1' }).catch((value) => value);
      expect(error.code).toBe('AEGIS_READ_FIXTURE_PROTOCOL_STATE');
      expect(child.stdin.read()).toBeNull();
    },
  );

  it('does not admit raw DPI wire text through the legacy read-command API', async () => {
    const fixture = await start();
    const error = await fixture.command('window-dpi 42 1').catch((value) => value);
    expect(error.code).toBe('AEGIS_READ_FIXTURE_PROTOCOL_STATE');
    expect(child.stdin.read()).toBeNull();
  });

  it('gives a DPI query sole response ownership without writing an overlapping read', async () => {
    const fixture = await start();
    const pending = fixture.windowDpi({ mainPid: 42, handle: '1' }).catch((value) => value);
    const overlapping = await fixture.command('sync').catch((value) => value);
    await settle();
    expect(overlapping.code).toBe('AEGIS_READ_FIXTURE_PROTOCOL_STATE');
    expect(await pending).toBe(overlapping);
    expect(child.stdin.read().toString()).toBe('window-dpi 42 1\n');
    expect(child.stdin.read()).toBeNull();
  });

  it('keeps the same twelve-second DPI bound and retains only its closed tag on timeout', async () => {
    const fixture = await start();
    const pending = fixture
      .windowDpi({ mainPid: 8872, handle: '1234567890123' })
      .catch((value) => value);
    await vi.advanceTimersByTimeAsync(12000);
    const error = await pending;
    expect(error.code).toBe('AEGIS_READ_FIXTURE_TIMEOUT');
    const snapshot = projectReadFixtureFailure(error);
    expect(snapshot).toMatchObject({ phase: 'command', expectedCommand: 'window-dpi' });
    expect(JSON.stringify(snapshot)).not.toContain('1234567890123');
    expect(JSON.stringify(snapshot)).not.toContain('8872');
    expect(await fixture.windowDpi({ mainPid: 42, handle: '1' }).catch((value) => value)).toBe(
      error,
    );
    expect(child.stdin.read().toString()).toBe('window-dpi 8872 1234567890123\n');
    expect(child.stdin.read()).toBeNull();
    finish();
    await fixture.close();
    expect(projectReadFixtureFailure(error)).toEqual(snapshot);
  });

  it('preserves chunked ready and serial sync/async response identity without changing native fields', async () => {
    const fixture = readFixture('owned.exe', 'owned-file', {}, false, true);
    const witness = { ...ready(), label: '😀' };
    const line = Buffer.from(JSON.stringify(witness) + '\r\n');
    const split = line.indexOf(Buffer.from('😀')) + 2;
    child.stdout.write(line.subarray(0, split));
    child.stdout.write(line.subarray(split));
    expect(await fixture.next()).toEqual(witness);
    for (const mode of ['sync', 'async']) {
      const response = {
        command: mode,
        pid: 42,
        birth: '123',
        reads: 160,
        pending: mode === 'async' ? 2 : 0,
      };
      const pending = fixture.command(mode);
      emit(response);
      await settle();
      expect(await pending).toEqual(response);
      expect(child.stdin.read().toString()).toBe(mode + '\n');
    }
    finish();
    await fixture.close();
    expect(child.stdin.writableEnded).toBe(true);
    expect(mocks.spawn.mock.calls[0][1]).toEqual(['owned-file', 'deny-delete-share']);
  });

  it('preserves both prequeued short frames after stdout EOF and a successful child exit', async () => {
    const fixture = readFixture('owned.exe', 'owned-file', {}, true);
    emit(ready());
    const response = { command: 'short', pid: 42, birth: '123', reads: 64 };
    emit(response);
    child.stdout.end();
    finish();
    await settle();
    expect(await fixture.next()).toEqual(ready());
    expect(await fixture.next()).toEqual(response);
    await fixture.close();
    expect(child.stdin.writableEnded).toBe(true);
  });

  it.each(['stdout', 'stderr', 'combined'])(
    'counts raw %s output before retaining unterminated data',
    async (stream) => {
      const fixture = readFixture('owned.exe', 'owned-file', {});
      if (stream === 'combined') {
        child.stdout.write('x'.repeat(8192));
        child.stderr.write(canary.padEnd(8193, '.'));
      } else child[stream].write(canary.padEnd(32768, '.'));
      const error = await fixture.next().catch((value) => value);
      expect(error.code).toBe('AEGIS_READ_FIXTURE_OUTPUT_BUDGET');
      const receipt = projectReadFixtureFailure(error);
      expect(receipt.stdoutBytes + receipt.stderrBytes).toBeGreaterThan(16384);
      expect(Math.max(receipt.stdoutBytes, receipt.stderrBytes)).toBeLessThanOrEqual(16385);
      expect(JSON.stringify({ receipt, message: error.message })).not.toContain(canary);
      emit(ready());
      expect(await fixture.next().catch((value) => value)).toBe(error);
      finish();
      await fixture.close();
    },
  );

  it('refuses unsolicited frame floods instead of silently dropping frames or later accepting them', async () => {
    const fixture = readFixture('owned.exe', 'owned-file', {});
    child.stdout.write((JSON.stringify(ready()) + '\n').repeat(9));
    const error = await fixture.next().catch((value) => value);
    expect(error.code).toBe('AEGIS_READ_FIXTURE_UNEXPECTED_RESPONSE');
    expect(error.fixtureDiagnostic.queuedLines).toBe(1);
    expect(await fixture.command('sync').catch((value) => value)).toBe(error);
    expect(child.stdin.read()).toBeNull();
  });

  it('counts line separators at the exact combined lifetime output boundary', async () => {
    const fixture = readFixture('owned.exe', 'owned-file', {});
    const line = JSON.stringify(ready()) + '\n';
    child.stdout.write(line);
    child.stderr.write('x'.repeat(16384 - Buffer.byteLength(line)));
    expect(await fixture.next()).toEqual(ready());
    child.stderr.write('x');
    const error = await fixture.command('sync').catch((value) => value);
    expect(error.code).toBe('AEGIS_READ_FIXTURE_OUTPUT_BUDGET');
    expect(error.fixtureDiagnostic.stdoutBytes + error.fixtureDiagnostic.stderrBytes).toBe(16385);
    expect(child.stdin.read()).toBeNull();
  });

  it.each([
    ['invalid-response', '{' + canary + '\n'],
    ['unexpected-response', JSON.stringify({ command: canary }) + '\n'],
    ['unexpected-response', 'null\n'],
    ['unexpected-response', '[]\n'],
  ])('closes %s without retaining raw response text', async (code, output) => {
    const fixture = readFixture('owned.exe', 'owned-file', {});
    child.stdout.write(output);
    const error = await fixture.next().catch((value) => value);
    expect(error.message).toBe('Read fixture refused: ' + code);
    expect(JSON.stringify(projectReadFixtureFailure(error))).not.toContain(canary);
  });

  it('keeps the 12 second response bound and never retries a timed out command', async () => {
    const fixture = await start();
    const pending = fixture.command('sync').catch((value) => value);
    await vi.advanceTimersByTimeAsync(11980);
    let settled = false;
    pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    await settle();
    const error = await pending;
    expect(error.code).toBe('AEGIS_READ_FIXTURE_TIMEOUT');
    expect(error.fixtureDiagnostic.expectedCommand).toBe('sync');
    expect(child.stdin.read().toString()).toBe('sync\n');
    expect(await fixture.command('async').catch((value) => value)).toBe(error);
    expect(child.stdin.read()).toBeNull();
  });

  it.each(['spawn', 'stdin', 'stdout', 'stderr', 'write-callback', 'write-throw'])(
    'classifies %s failure and preserves a private first snapshot through cleanup',
    async (kind) => {
      const fixture = await start();
      if (kind === 'write-callback')
        vi.spyOn(child.stdin, 'write').mockImplementation((_data, callback) => {
          callback(new Error(canary));
          return false;
        });
      if (kind === 'write-throw')
        vi.spyOn(child.stdin, 'write').mockImplementation(() => {
          throw new Error(canary);
        });
      const pending = fixture.command('sync').catch((value) => value);
      if (kind === 'spawn') child.emit('error', new Error(canary));
      else if (['stdin', 'stdout', 'stderr'].includes(kind))
        child[kind].emit('error', new Error(canary));
      await settle();
      const error = await pending;
      const code = kind.startsWith('write') ? 'stdin' : kind;
      expect(error.message).toBe('Read fixture refused: ' + code + '-error');
      const before = projectReadFixtureFailure(error);
      expect(before.exitCode).toBeNull();
      finish();
      await fixture.close();
      expect(projectReadFixtureFailure(error)).toEqual(before);
      expect(JSON.stringify({ before, message: error.message })).not.toContain(canary);
    },
  );

  it('rejects overlapping commands and mismatched responses before accepting another response', async () => {
    const fixture = await start();
    const first = fixture.command('sync').catch((value) => value);
    const second = await fixture.command('async').catch((value) => value);
    expect(second.code).toBe('AEGIS_READ_FIXTURE_PROTOCOL_STATE');
    await settle();
    expect(await first).toBe(second);
    expect(child.stdin.read().toString()).toBe('sync\n');
  });

  it('rejects an old ready response during sync without accepting an unrelated JSON reply', async () => {
    const fixture = await start();
    const pending = fixture.command('sync').catch((value) => value);
    emit(ready());
    await settle();
    expect((await pending).code).toBe('AEGIS_READ_FIXTURE_UNEXPECTED_RESPONSE');
  });

  it('refuses a null-command frame when no response is authorized, including before close', async () => {
    const fixture = await start();
    emit({ command: null });
    finish();
    const error = await fixture.close().catch((value) => value);
    expect(error).toMatchObject({ code: 'AEGIS_READ_FIXTURE_UNEXPECTED_RESPONSE' });
    expect(child.stdin.read()).toBeNull();
  });

  it.each([11999, 12000])(
    'uses frame arrival against the exact response deadline (%s)',
    async (at) => {
      const fixture = await start();
      const pending = fixture.command('sync').catch((value) => value);
      setTimeout(() => emit({ command: 'sync', reads: 160 }), at);
      await vi.advanceTimersByTimeAsync(12000);
      const value = await pending;
      if (at < 12000) expect(value).toMatchObject({ command: 'sync', reads: 160 });
      else expect(value).toMatchObject({ code: 'AEGIS_READ_FIXTURE_TIMEOUT' });
    },
  );

  it('requires stdin write acknowledgement before the same response deadline', async () => {
    const fixture = await start();
    vi.spyOn(child.stdin, 'write').mockImplementation((_data, callback) => {
      setTimeout(() => callback(), 12000);
      return true;
    });
    const pending = fixture.command('sync').catch((value) => value);
    setTimeout(() => emit({ command: 'sync', reads: 160 }), 11999);
    await vi.advanceTimersByTimeAsync(12000);
    expect(await pending).toMatchObject({ code: 'AEGIS_READ_FIXTURE_TIMEOUT' });
  });

  it.each([2, null])('keeps exact exit zero and the 10 second close bound (%s)', async (code) => {
    const fixture = await start();
    if (code !== null) finish(code);
    const pending = fixture.close().catch((value) => value);
    if (code === null) await vi.advanceTimersByTimeAsync(10000);
    const error = await pending;
    expect(error.code).toBe(
      code === null ? 'AEGIS_READ_FIXTURE_CLOSE_UNCONFIRMED' : 'AEGIS_READ_FIXTURE_EXIT_FAILED',
    );
    expect(child.stdin.writableEnded).toBe(true);
  });

  it.each([9999, 10000])(
    'uses drained process-close arrival against the exact close deadline (%s)',
    async (at) => {
      const fixture = await start();
      const pending = fixture.close().catch((value) => value);
      setTimeout(() => finish(), at);
      await vi.advanceTimersByTimeAsync(10000);
      const value = await pending;
      if (at < 10000) expect(value).toBeUndefined();
      else expect(value).toMatchObject({ code: 'AEGIS_READ_FIXTURE_CLOSE_UNCONFIRMED' });
    },
  );

  it('waits for stdio closure and refuses late output after the last accepted response', async () => {
    const fixture = await start();
    const pending = fixture.command('sync');
    emit({ command: 'sync', reads: 160 });
    await settle();
    expect((await pending).reads).toBe(160);
    const closing = fixture.close().catch((value) => value);
    child.exitCode = 0;
    child.emit('exit', 0, null);
    let settled = false;
    closing.then(() => {
      settled = true;
    });
    await settle();
    expect(settled).toBe(false);
    child.stderr.write(canary.padEnd(16385, '.'));
    child.emit('close', 0, null);
    await settle();
    const error = await closing;
    expect(error.code).toBe('AEGIS_READ_FIXTURE_OUTPUT_BUDGET');
    expect(error.fixtureDiagnostic.phase).toBe('close');
    expect(JSON.stringify(projectReadFixtureFailure(error))).not.toContain(canary);
    await fixture.close();
  });

  it('projects only recognized finite receipt fields and rejects unrecognized error metadata', async () => {
    const fixture = await start();
    const pending = fixture.command('sync').catch((value) => value);
    child.stdout.end();
    await settle();
    const error = await pending;
    const unsafe = { ...error, fixtureDiagnostic: { ...error.fixtureDiagnostic, raw: canary } };
    const receipt = projectReadFixtureFailure(unsafe);
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(Object.keys(receipt)).toEqual([
      'schema',
      'failureCode',
      'phase',
      'expectedCommand',
      'stdoutBytes',
      'stderrBytes',
      'queuedLines',
      'exitCode',
      'signalCode',
      'stdoutEnded',
      'stdinFailed',
    ]);
    expect(JSON.stringify(receipt)).not.toContain(canary);
    expect(projectReadFixtureFailure(new Error(canary))).toBeNull();
    for (const [key, value] of Object.entries({
      expectedCommand: canary,
      stdoutBytes: 16386,
      stderrBytes: -1,
      queuedLines: 9,
      phase: canary,
      signalCode: canary,
      exitCode: 2 ** 40,
      stdoutEnded: 'true',
      stdinFailed: 1,
    })) {
      expect(
        projectReadFixtureFailure({
          ...unsafe,
          fixtureDiagnostic: { ...unsafe.fixtureDiagnostic, [key]: value },
        }),
      ).toBeNull();
    }
    expect(projectReadFixtureFailure({ ...unsafe, code: canary })).toBeNull();
  });
});
