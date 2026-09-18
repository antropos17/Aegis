import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const require = createRequire(import.meta.url);
const runner = require('../../src/main/action-execution');
afterEach(() => runner._resetForTest());
describe('execution owner cancellation', () => {
  it('does not even prepare a request whose owner already closed', async () => {
    const prepare = vi.fn(),
      launch = vi.fn();
    const controller = new AbortController();
    controller.abort();
    runner._setDepsForTest({ prepare, spawn: launch });
    expect(
      await runner.executeAction('private', 'private', { signal: controller.signal }),
    ).toMatchObject({
      decision: 'deny',
      reason: 'action-cancelled',
      execution: { state: 'not-started' },
    });
    expect(prepare).not.toHaveBeenCalled();
    expect(launch).not.toHaveBeenCalled();
  });
  it('settles cancellation before a hung evaluator and never launches its late allow', async () => {
    let finish;
    const launch = vi.fn();
    const controller = new AbortController();
    runner._setDepsForTest({
      prepare: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      spawn: launch,
    });
    const pending = runner.executeAction('private', 'private', { signal: controller.signal });
    await Promise.resolve();
    controller.abort();
    expect(await pending).toMatchObject({ decision: 'deny', reason: 'action-cancelled' });
    finish({
      decision: 'allow',
      launch: { executable: process.execPath, cwd: process.cwd(), args: [], env: {} },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(launch).not.toHaveBeenCalled();
  });
  it('stops an actually spawned direct child on cancellation and observes its exit', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-cancel-'));
    const policy = path.join(root, 'policy.json'),
      request = path.join(root, 'request.json');
    const controller = new AbortController();
    const action = {
      executable: process.execPath,
      cwd: root,
      args: ['-e', 'setTimeout(()=>process.exit(0),15000)'],
      env:
        process.platform === 'win32'
          ? {
              SYSTEMROOT: process.env.SystemRoot,
              WINDIR: process.env.SystemRoot,
              TEMP: root,
              TMP: root,
            }
          : {},
    };
    fs.writeFileSync(
      policy,
      JSON.stringify({
        schemaVersion: 2,
        defaultDecision: 'deny',
        rules: [{ action, decision: 'allow' }],
      }),
    );
    fs.writeFileSync(request, JSON.stringify({ schemaVersion: 1, action }));
    runner._setDepsForTest({
      spawn: (...args) => {
        const child = spawn(...args);
        child.once('spawn', () => controller.abort());
        return child;
      },
    });
    try {
      const result = await runner.executeAction(policy, request, { signal: controller.signal });
      expect(result).toMatchObject({
        decision: 'allow',
        reason: 'action-cancelled',
        execution: { state: 'interrupted', termination: 'confirmed' },
      });
    } finally {
      expect(path.dirname(root)).toBe(path.resolve(os.tmpdir()));
      expect(fs.lstatSync(root).isSymbolicLink()).toBe(false);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
