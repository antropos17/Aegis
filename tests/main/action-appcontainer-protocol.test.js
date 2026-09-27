import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

const require = createRequire(import.meta.url);
const adapter = require('../../src/main/mcp-gateway-windows-job');
let helper;
let spawn;
let frame;
beforeEach(() => {
  for (const name of Object.keys(process.env))
    if (name.toLowerCase() === 'systemroot') vi.stubEnv(name, undefined);
  vi.stubEnv('SystemRoot', 'C:\\Windows');
  helper = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
    unref: vi.fn(),
  });
  frame = '';
  helper.stdin.on('data', (chunk) => {
    frame += chunk.toString();
  });
  spawn = vi.fn(() => helper);
  adapter._setDepsForTest({ spawn });
});
afterEach(() => {
  helper?.emit('exit', 1);
  helper?.emit('close', 1);
  for (const stream of [helper?.stdin, helper?.stdout, helper?.stderr]) stream?.destroy();
  adapter._resetForTest();
  vi.unstubAllEnvs();
});
function start() {
  const child = adapter.spawnActionInAppContainer(
    {
      executable: 'C:\\Windows\\System32\\cmd.exe',
      cwd: 'C:\\new-workspace',
      args: ['/d', '/c', 'exit 0'],
      env: { SystemRoot: 'C:\\Windows' },
    },
    process.execPath,
  );
  child.on('error', () => {});
  return child;
}
function close(status, code = 0) {
  helper.stderr.write(status);
  helper.emit('exit', code);
  helper.emit('close', code);
}
describe('distinct AppContainer native protocol', () => {
  it('requests the isolated purpose with a clean helper environment and consumes fragmented receipts', () => {
    const child = start();
    expect(JSON.parse(frame).purpose).toBe('appcontainer-action');
    expect(spawn.mock.calls[0][2].env).toEqual({ SystemRoot: 'C:\\Windows' });
    helper.stdout.write('S');
    helper.stderr.write('S,C,1,0,12,');
    close('3,1,0,1,1,1\n');
    expect(child.isolationVerified).toBe(true);
    expect(child.cleanupConfirmed).toBe(true);
    expect(child.actionOutcome).toMatchObject({
      isolationVerified: true,
      workspaceRetained: true,
      profileCleanup: true,
      stdoutBytes: 12,
      stderrBytes: 3,
      exitCode: 0,
    });
  });

  it('rejects legacy ready even with a plausible isolated final status', () => {
    const child = start();
    helper.stdout.write('R');
    close('S,C,1,0,0,0,1,0,1,1,1\n');
    expect(child.isolationVerified).toBe(false);
    expect(child.cleanupConfirmed).toBe(false);
    expect(helper.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it.each([
    'A,C,1,0,0,0,1,0\n',
    'S,C,1,0,0,0,1,0,1,1\n',
    'S,C,1,0,65536,1,1,0,1,1,1\n',
    'S,C,1,0,0,0,1,0,1,1,1\nPRIVATE',
    'S,C,1,2147483648,0,0,1,0,1,1,1\n',
    Buffer.from([0xd3, ...Buffer.from(',C,1,0,0,0,1,0,1,1,1\n')]),
  ])('rejects malformed, downgraded or extra status data %#', (receipt) => {
    const child = start();
    helper.stdout.write('S');
    close(receipt);
    expect(child.cleanupConfirmed).toBe(false);
    expect(child.actionOutcome).toBeNull();
  });

  it('rejects unexpected helper output and nonzero helper exit', () => {
    const child = start();
    helper.stdout.write('Sprivate-output');
    close('S,C,1,0,0,0,1,0,1,1,1\n', 1);
    expect(child.cleanupConfirmed).toBe(false);
    expect(child.stdout.read()).toBeNull();
  });
});
