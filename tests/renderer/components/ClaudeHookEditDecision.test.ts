import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { request } from 'node:http';
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ClaudeHookProfile from '../../../frontend/observatory/components/ClaudeHookProfile.svelte';
import type { Host } from '../../../frontend/observatory/runtime/host';

const require = createRequire(import.meta.url);
const { startClaudeGuardReceiver } = require('../../../src/main/claude-guard-receiver');

function post(port: number, route: string, body: string, token?: string) {
  return new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path: route,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        let result = '';
        res.on('data', (chunk) => (result += chunk));
        res.on('end', () => resolve({ status: res.statusCode, body: result }));
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

it('shows an actual patch-review hook decision without claiming its effect or exposing input', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'aegis-edit-decision-'));
  const policy = path.join(directory, 'policy.json');
  let receiver: Awaited<ReturnType<typeof startClaudeGuardReceiver>> | undefined;
  try {
    writeFileSync(
      policy,
      JSON.stringify({
        schemaVersion: 2,
        cwd: directory,
        profile: 'aegis-windows-project-review-v1',
      }),
      { flag: 'wx' },
    );
    receiver = await startClaudeGuardReceiver({
      selection: {
        executable: path.join(directory, 'claude.exe'),
        settings: path.join(directory, 'settings.json'),
        cwd: directory,
      },
      approve: async (code: string) => code === '123456',
      verify: async () => true,
    });
    const claimed = await post(
      receiver.port,
      `/claim/${receiver.sessionId}`,
      JSON.stringify({ code: '123456', nonce: 'c'.repeat(32) }),
    );
    expect(claimed.status).toBe(200);
    const token = JSON.parse(claimed.body).token as string;
    const started = await post(receiver.port, `/start/${receiver.sessionId}`, '{}', token);
    expect(started.status).toBe(204);

    const child = spawn(process.execPath, ['src/main/main.js', '--action-policy-hook', policy], {
      env: {
        ...process.env,
        AEGIS_CLAUDE_GUARD_PORT: String(receiver.port),
        AEGIS_CLAUDE_GUARD_SESSION: receiver.sessionId,
        AEGIS_CLAUDE_GUARD_CAPABILITY: token,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.stdin.end(
      JSON.stringify({
        hook_event_name: 'PreToolUse',
        session_id: 'private-session',
        tool_use_id: 'private-tool',
        tool_name: 'Bash',
        cwd: directory,
        tool_input: { command: 'git apply -- private.patch', description: 'PRIVATE_DESCRIPTION' },
      }),
    );
    const timer = setTimeout(() => child.kill(), 6000);
    const [code] = await once(child, 'close');
    clearTimeout(timer);
    expect(code).toBe(0);
    expect(stderr).toBe('');
    const decision = JSON.parse(stdout).hookSpecificOutput;
    expect(decision.permissionDecision).toBe('ask');
    expect(decision.permissionDecisionReason).toContain(
      'Patch contents, paths written, and the executable are unverified',
    );
    expect(decision.permissionDecisionReason).not.toContain('private.patch');
    expect(receiver.snapshot().entries).toEqual([
      { decision: 'ask', reason: 'project-review-edit' },
    ]);

    const invalid = await post(
      receiver.port,
      `/decision/${receiver.sessionId}`,
      JSON.stringify({ decision: 'allow', reason: 'project-review-edit' }),
      token,
    );
    expect(invalid.status).toBe(422);
    const state = receiver.snapshot();
    expect(state).toMatchObject({
      sender: 'unverified',
      delivery: 'unknown',
      effect: 'unknown',
      lossDetected: true,
    });
    expect(JSON.stringify(state)).not.toContain(token);
    expect(JSON.stringify(state)).not.toContain('private.patch');
    expect(JSON.stringify(state)).not.toContain('PRIVATE_DESCRIPTION');
    render(ClaudeHookProfile, {
      host: {
        reviewClaudeHookProfile: vi.fn().mockResolvedValue({
          success: true,
          code: 'READY',
          // Production wraps the receiver snapshot with launcher admission metadata.
          guardSession: { ...state, afterHooks: false, afterHooksAtAdmission: false },
        }),
      } as Host,
    });
    expect(
      await screen.findByText(
        'ASK: Patch contents, written paths and executable are unverified; provider confirmation requested · Provider result unknown · Effect unknown',
      ),
    ).toBeVisible();
    expect(
      screen.getByText('Some reporting may have been lost or discarded; delivery remains unknown.'),
    ).toBeVisible();
    expect(screen.queryByText(/private\.patch|PRIVATE_DESCRIPTION/)).toBeNull();
  } finally {
    if (receiver) await receiver.close();
    unlinkSync(policy);
    rmdirSync(directory);
  }
});
