import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import controller from '../../../src/main/platform/linux-process-control.js';

const require = createRequire(import.meta.url);
const WITNESS = '11111111-1111-4111-8111-111111111111:492781';
afterEach(() => controller._setExecFileForTest(null));

describe('Linux generation-bound process signals', () => {
  it('resolves a readable helper outside app.asar in packaged Electron', () => {
    const resourcesPath = path.resolve('fixture', 'app resources');
    expect(controller.resolveHelperPath({ resourcesPath })).toBe(
      path.join(resourcesPath, 'linux-process-control.py'),
    );
    const development = controller.resolveHelperPath({});
    expect(fs.existsSync(development)).toBe(true);
    expect(controller.resolveHelperPath({ resourcesPath, defaultApp: true })).toBe(development);
  });

  it.each(['kill', 'suspend', 'resume'])(
    'launches only the isolated pidfd helper for %s',
    async (action) => {
      const run = vi.fn((_file, _args, _options, done) => done(null));
      controller._setExecFileForTest(run);
      expect(await controller.signalProcess(123, WITNESS, action)).toEqual({ success: true });
      expect(run).toHaveBeenCalledWith(
        '/usr/bin/python3',
        ['-I', expect.stringMatching(/linux-process-control\.py$/), '123', WITNESS, action],
        { timeout: 5000, maxBuffer: 4096, windowsHide: true },
        expect.any(Function),
      );
    },
  );

  it.each([
    [0, WITNESS, 'kill'],
    [-1, WITNESS, 'kill'],
    [2147483648, WITNESS, 'kill'],
    ['123', WITNESS, 'kill'],
    [123, '', 'kill'],
    [123, '492781', 'kill'],
    [123, WITNESS + '\n', 'kill'],
    [123, WITNESS, 'shell'],
  ])('rejects invalid inputs before launching (%s, %s, %s)', async (pid, witness, action) => {
    const run = vi.fn();
    controller._setExecFileForTest(run);
    expect((await controller.signalProcess(pid, witness, action)).success).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it.each([3, 4, 'ENOENT', 5, 'ETIMEDOUT'])(
    'denies failed helpers without a PID-only fallback (%s)',
    async (code) => {
      const run = vi.fn((_file, _args, _options, done) =>
        done(Object.assign(Error('PRIVATE_CANARY'), { code })),
      );
      controller._setExecFileForTest(run);
      const result = await controller.signalProcess(123, WITNESS, 'kill');
      expect(result.success).toBe(false);
      expect(JSON.stringify(result)).not.toContain('PRIVATE_CANARY');
      expect(run).toHaveBeenCalledTimes(1);
    },
  );

  it('contains synchronous launcher failures', async () => {
    controller._setExecFileForTest(() => {
      throw Error('PRIVATE_CANARY');
    });
    expect(await controller.signalProcess(123, WITNESS, 'kill')).toEqual({
      success: false,
      error: 'Linux process action failed',
    });
  });
});

const nativeAvailable =
  process.platform === 'linux' &&
  spawnSync(
    '/usr/bin/python3',
    [
      '-I',
      '-c',
      'import os,signal; assert hasattr(os,"pidfd_open") and hasattr(signal,"pidfd_send_signal")',
    ],
    { timeout: 5000 },
  ).status === 0;

it.runIf(nativeAvailable)(
  'native pidfd rejects a stale witness and preserves stop, resume and kill',
  async () => {
    controller._setExecFileForTest(null);
    const linux = require('../../../src/main/platform/linux.js');
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
    });
    const exited = new Promise((done) => child.once('exit', done));
    const wait = (ms) => new Promise((done) => setTimeout(done, ms));
    async function state(stopped) {
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        const text = fs.readFileSync(`/proc/${child.pid}/stat`, 'utf8');
        const value = text
          .slice(text.lastIndexOf(')') + 1)
          .trim()
          .split(/\s+/)[0];
        if ((value === 'T') === stopped) return;
        await wait(20);
      }
      throw Error('Disposable child did not reach expected signal state');
    }
    try {
      await wait(50);
      const observed = (await linux.getParentProcessMap()).get(child.pid);
      const separator = observed.witness.lastIndexOf(':');
      const wrong =
        observed.witness.slice(0, separator + 1) +
        (BigInt(observed.witness.slice(separator + 1)) + 1n);
      expect((await linux.killProcess(child.pid, wrong)).success).toBe(false);
      process.kill(child.pid, 0);
      expect((await linux.suspendProcess(child.pid, observed.witness)).success).toBe(true);
      await state(true);
      expect((await linux.resumeProcess(child.pid, observed.witness)).success).toBe(true);
      await state(false);
      expect((await linux.killProcess(child.pid, observed.witness)).success).toBe(true);
      await exited;
    } finally {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already exited */
      }
      await exited;
    }
  },
  10000,
);
