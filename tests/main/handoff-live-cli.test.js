import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { once } from 'node:events';
const require = createRequire(import.meta.url);
const { startHandoffCollector } = require('../../src/main/handoff-live');
const token = 'b'.repeat(64);
const body = JSON.stringify({
  hook_event_name: 'SubagentStart',
  session_id: 'PRIVATE_SESSION',
  agent_id: 'PRIVATE_AGENT',
  prompt: 'PRIVATE_SECRET',
  decision: 'deny',
});

function launch(args, input = '', extraEnv = {}) {
  const child = spawn(process.execPath, ['src/main/main.js', ...args], {
    env: { ...process.env, AEGIS_HANDOFF_TOKEN: token, ...extraEnv },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  child.stdin.on('error', () => {});
  child.stdin.end(input);
  const timer = setTimeout(() => child.kill(), 10000);
  const done = once(child, 'close').then(([code]) => {
    clearTimeout(timer);
    return { code, stdout, stderr };
  });
  return { child, done };
}

describe('live CLI boundaries', () => {
  it('runs listener and sender through real Node entrypoints, emitting no hook decisions or secrets', async () => {
    const listener = launch(['--handoff-listen-json', 'claude-code', '0', '3']);
    try {
      const ready = await new Promise((resolve, reject) => {
        let text = '';
        const read = (chunk) => {
          text += chunk;
          if (text.includes('\n')) {
            listener.child.stdout.removeListener('data', read);
            resolve(text.split('\n')[0]);
          }
        };
        listener.child.stdout.on('data', read);
        listener.child.once('close', () => reject(new Error('listener-not-ready')));
      });
      const port = JSON.parse(ready.trim()).port;
      const sent = await launch(['--handoff-send'], body, { AEGIS_HANDOFF_PORT: String(port) })
        .done;
      expect(sent).toEqual({ code: 0, stdout: '', stderr: '' });
      const result = await listener.done;
      expect(result.code).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).not.toMatch(/PRIVATE|bbbbbb/);
      const records = result.stdout.trim().split('\n').map(JSON.parse);
      expect(records).toHaveLength(2);
      expect(records[1]).toMatchObject({
        mode: 'handoff-live',
        reason: 'deadline',
        producerVersion: 'unknown',
        events: [{ phase: 'observation', decision: 'not-applicable' }],
      });
    } finally {
      listener.child.kill();
      await listener.done;
    }
  }, 15000);

  it.each([
    ['--handoff-listen-json'],
    ['--handoff-listen-json', 'PRIVATE', '0', '1'],
    ['--handoff-listen-json', 'claude-code', '65536', '1'],
    ['--handoff-listen-json', 'claude-code', '0', '901'],
    ['--handoff-listen-json', 'claude-code', '0', '0'],
  ])('rejects malformed listen arguments %# with fixed output', async (...args) => {
    const result = await launch(args).done;
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({ error: 'live-configuration-invalid' });
    expect(result.stderr).toBe('');
  });

  it('rejects missing credentials and invalid sender arguments without hook output', async () => {
    expect(await launch(['--handoff-send', 'PRIVATE'], body).done).toEqual({
      code: 1,
      stdout: '',
      stderr: '',
    });
    expect(await launch(['--handoff-send'], body, { AEGIS_HANDOFF_TOKEN: '' }).done).toEqual({
      code: 1,
      stdout: '',
      stderr: '',
    });
  });

  it('returns a fixed startup error when the selected port is occupied', async () => {
    const collector = await startHandoffCollector({ port: 0, token, durationMs: 10000 });
    try {
      const result = await launch([
        '--handoff-listen-json',
        'claude-code',
        String(collector.port),
        '1',
      ]).done;
      expect(result.code).toBe(1);
      expect(JSON.parse(result.stdout)).toEqual({ error: 'live-listen-unavailable' });
    } finally {
      await collector.close();
    }
  });
});
