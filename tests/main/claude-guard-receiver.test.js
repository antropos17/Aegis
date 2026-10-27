import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { createHmac } from 'node:crypto';
import http from 'node:http';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { startClaudeGuardReceiver, LIMITS } = require('../../src/main/claude-guard-receiver');
const selection = {
  executable: path.resolve('fixture', 'claude.exe'),
  settings: path.resolve('fixture', 'settings.json'),
  cwd: path.resolve('fixture'),
};
const opened = [];
const nonce = 'a'.repeat(32);
const claimBody = (code) => ({ code, nonce });

async function start(options = {}) {
  const receiver = await startClaudeGuardReceiver({ selection, approve: () => true, ...options });
  opened.push(receiver);
  return receiver;
}
function post(receiver, route, payload, headers = {}) {
  return new Promise((resolve, reject) => {
    const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: receiver.port,
        path: `/${route}/${receiver.sessionId}`,
        method: 'POST',
        agent: false,
        headers: { 'Content-Type': 'application/json', ...headers },
      },
      (res) => {
        const data = [];
        res.on('data', (chunk) => data.push(chunk));
        res.on('error', reject);
        res.on('end', () =>
          resolve({ status: res.statusCode, body: Buffer.concat(data).toString() }),
        );
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}
async function claim(receiver) {
  const result = await post(receiver, 'claim', claimBody('123456'));
  expect(result.status).toBe(200);
  return JSON.parse(result.body);
}
afterEach(async () => {
  await Promise.all(opened.splice(0).map((receiver) => receiver.close()));
});

describe('finite Claude Guard decision observer', () => {
  it('accepts a confirmed claim and only the bounded fixed decision, never paths or token in snapshots', async () => {
    const approve = vi.fn(() => true);
    const receiver = await start({ approve });
    const admitted = await claim(receiver);
    expect(approve).toHaveBeenCalledExactlyOnceWith('123456');
    expect(admitted).toEqual({
      ...selection,
      token: expect.stringMatching(/^[a-f0-9]{64}$/),
      proof: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(receiver.launchKey).toMatch(/^[a-f0-9]{24}$/);
    const expectedProof = createHmac('sha256', Buffer.from(receiver.launchKey, 'ascii'))
      .update(
        JSON.stringify([
          receiver.sessionId,
          '123456',
          nonce,
          admitted.token,
          selection.executable,
          selection.settings,
          selection.cwd,
        ]),
      )
      .digest('hex');
    expect(admitted.proof).toBe(expectedProof);
    const ok = await post(
      receiver,
      'decision',
      { decision: 'ask', reason: 'project-review-ordinary' },
      {
        Authorization: `Bearer ${admitted.token}`,
      },
    );
    expect(ok.status).toBe(204);
    const report = receiver.snapshot();
    expect(report).toEqual({
      status: 'active',
      available: true,
      lossDetected: false,
      delivery: 'unknown',
      sender: 'unverified',
      effect: 'unknown',
      entries: [{ decision: 'ask', reason: 'project-review-ordinary' }],
    });
    const text = JSON.stringify(report);
    for (const privateValue of [
      admitted.token,
      receiver.launchKey,
      admitted.proof,
      selection.executable,
      selection.cwd,
      selection.settings,
      '123456',
    ])
      expect(text).not.toContain(privateValue);
    report.entries[0].decision = 'deny';
    expect(receiver.snapshot().entries[0].decision).toBe('ask');
  });

  it('reserves one claim before awaiting human confirmation, and rejects concurrent claims', async () => {
    let resolveApproval;
    const approve = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveApproval = resolve;
        }),
    );
    const receiver = await start({ approve });
    const first = post(receiver, 'claim', claimBody('123456'));
    await vi.waitFor(() => expect(approve).toHaveBeenCalledTimes(1));
    const second = await post(receiver, 'claim', claimBody('654321'));
    expect(second.status).toBe(409);
    expect(receiver.snapshot().status).toBe('awaiting-confirmation');
    resolveApproval(true);
    expect((await first).status).toBe(200);
    expect(receiver.snapshot().lossDetected).toBe(true);
  });

  it('rejects incorrect bearer, ambiguous input, origins and invalid reason/decision pairs', async () => {
    const receiver = await start();
    const { token } = await claim(receiver);
    const auth = { Authorization: `Bearer ${token}` };
    expect(
      (
        await post(
          receiver,
          'decision',
          { decision: 'allow', reason: 'generic' },
          {
            Authorization: `Bearer ${'0'.repeat(64)}`,
          },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await post(
          receiver,
          'decision',
          { decision: 'allow', reason: 'project-deny-sensitive' },
          auth,
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await post(
          receiver,
          'decision',
          '{"decision":"deny","decision":"allow","reason":"generic"}',
          auth,
        )
      ).status,
    ).toBe(422);
    expect(
      (
        await post(
          receiver,
          'decision',
          { decision: 'deny', reason: 'generic' },
          { ...auth, Origin: '' },
        )
      ).status,
    ).toBe(400);
    expect(receiver.snapshot().entries).toEqual([]);
    expect(receiver.snapshot().lossDetected).toBe(true);
  });

  it('refuses an unconfirmed claim, revokes the endpoint, and does not disclose selection', async () => {
    const receiver = await start({ approve: () => false });
    const result = await post(receiver, 'claim', claimBody('123456'));
    expect(result.status).toBe(403);
    expect(result.body).toBe('');
    await vi.waitFor(() => expect(receiver.snapshot().status).toBe('refused'));
    await expect(post(receiver, 'claim', claimBody('123456'))).rejects.toThrow();
  });

  it('does not grant a late approval after closure and reports incomplete delivery', async () => {
    let resolveApproval;
    const approve = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveApproval = resolve;
        }),
    );
    const receiver = await start({ approve });
    const pending = post(receiver, 'claim', claimBody('123456')).catch(() => null);
    await vi.waitFor(() => expect(approve).toHaveBeenCalledTimes(1));
    await receiver.close();
    resolveApproval(true);
    expect(await pending).toBeNull();
    expect(receiver.snapshot()).toMatchObject({
      status: 'ended',
      available: false,
      lossDetected: true,
    });
  });

  it('treats an interrupted partial claim as lost and consumes the only attempt', async () => {
    const approve = vi.fn(() => true);
    const receiver = await start({ approve });
    const req = http.request({
      hostname: '127.0.0.1',
      port: receiver.port,
      path: `/claim/${receiver.sessionId}`,
      method: 'POST',
      agent: false,
      headers: { 'Content-Type': 'application/json', 'Content-Length': '40' },
    });
    req.on('error', () => {});
    req.write('{"code":"');
    await vi.waitFor(() => expect(receiver.snapshot().status).toBe('awaiting-confirmation'));
    req.destroy();
    await vi.waitFor(() => expect(receiver.snapshot().status).toBe('refused'));
    expect(receiver.snapshot().lossDetected).toBe(true);
    expect(approve).not.toHaveBeenCalled();
    await expect(post(receiver, 'claim', claimBody('123456'))).rejects.toThrow();
  });

  it('caps retained reports, marks eviction, and expires on elapsed monotonic time', async () => {
    let clock = 0;
    const receiver = await start({ now: () => clock });
    const { token } = await claim(receiver);
    const auth = { Authorization: `Bearer ${token}` };
    for (let index = 0; index < LIMITS.records + 2; index++) {
      const decision = index === 0 ? 'allow' : 'deny';
      expect((await post(receiver, 'decision', { decision, reason: 'generic' }, auth)).status).toBe(
        204,
      );
    }
    expect(receiver.snapshot().entries).toHaveLength(32);
    expect(receiver.snapshot().entries.every((entry) => entry.decision === 'deny')).toBe(true);
    expect(receiver.snapshot().lossDetected).toBe(true);
    clock = LIMITS.durationMs;
    expect(receiver.snapshot()).toMatchObject({ status: 'expired', available: false });
    await receiver.close();
    await expect(
      post(receiver, 'decision', { decision: 'deny', reason: 'generic' }, auth),
    ).rejects.toThrow();
  });
});
