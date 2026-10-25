import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { withRebootHost } from '../../tools/development/etw-reboot-host.mjs';

describe('qualification collector failure evidence', () => {
  it('retains only bounded finite collector failure diagnostics without changing child exit codes', async () => {
    const diagnostic = { stage: 'trace-start', kind: 'win32', code: 5 };
    const exchange = async (childDiagnostics, childExitCodes = [2]) => {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new Writable({
        write(_chunk, _encoding, callback) {
          child.stdout.write(
            JSON.stringify({
              type: 'host-finished',
              launches: childExitCodes.length,
              liveChildren: 0,
              childExitCodes,
              childDiagnostics,
              exitCode: 0,
            }) + '\n',
          );
          child.emit('close', 0);
          callback();
        },
      });
      queueMicrotask(() =>
        child.stdout.write(
          JSON.stringify({
            type: 'host-ready',
            address: 'a'.repeat(32) + ':71:134000000000001111',
          }) + '\n',
        ),
      );
      return withRebootHost('fixture-helper', 'fixture-output', {}, async () => 'observed', {
        spawnProcess: () => child,
      });
    };
    const good = await exchange([diagnostic]);
    expect(good.failure).toBeNull();
    expect(good.host).toMatchObject({ childExitCodes: [2], childDiagnostics: [diagnostic] });
    const legacy = await exchange(undefined);
    expect(legacy.failure).toBeNull();
    expect(legacy.host).not.toHaveProperty('childDiagnostics');
    expect((await exchange([null], [0])).failure).toBeNull();
    expect(
      (await exchange([{ stage: 'custody', kind: 'hresult', code: -2147024891 }])).failure,
    ).toBeNull();
    for (const [diagnostics, exits] of [
      [[], [2]],
      [[diagnostic, null], [2]],
      [[diagnostic], [0]],
      [[diagnostic], [2.5]],
      [[diagnostic], [2147483648]],
      [[{ ...diagnostic, stage: 'PRIVATE_PATH_CANARY' }], [2]],
      [[{ ...diagnostic, kind: 'exception' }], [2]],
      [[{ ...diagnostic, code: 5.5 }], [2]],
      [[{ ...diagnostic, code: 2147483648 }], [2]],
      [[{ ...diagnostic, code: -2147483649 }], [2]],
      [[{ ...diagnostic, message: 'PRIVATE_PATH_CANARY' }], [2]],
      [[{ stage: 'peer', code: 2 }], [2]],
      [[true], [2]],
      [null, [2]],
      [Array(5).fill(diagnostic), Array(5).fill(2)],
      [Array(65).fill(null), Array(65).fill(2)],
    ]) {
      const rejected = await exchange(diagnostics, exits);
      expect(rejected.failure).toBe('Invalid host frame');
      expect(rejected.host).not.toHaveProperty('childDiagnostics');
      expect(JSON.stringify(rejected)).not.toContain('PRIVATE_PATH_CANARY');
    }
  });
});
