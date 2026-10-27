import { afterEach, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { PassThrough } from 'node:stream';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {
  reportClaudeGuardDecision,
  correlateClaudeGuardAttempt,
} = require('../../src/main/claude-guard-report');
const hook = require('../../src/main/action-policy-hook');
const token = 'a'.repeat(64);
const session = 'b'.repeat(32);
let server;

afterEach(async () => {
  hook._resetForTest();
  if (server) await new Promise((resolve) => server.close(resolve));
  server = null;
});

it('reports only the fixed decision category after emitting the provider response', async () => {
  const requests = [];
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      requests.push({ path: req.url, authorization: req.headers.authorization, body });
      res.writeHead(204);
      res.end();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const env = {
    AEGIS_CLAUDE_GUARD_PORT: String(server.address().port),
    AEGIS_CLAUDE_GUARD_SESSION: session,
    AEGIS_CLAUDE_GUARD_CAPABILITY: token,
  };
  const input = new PassThrough();
  const output = [];
  hook._setDepsForTest({
    input,
    evaluate: async () => ({ decision: 'deny', reason: 'project-deny-sensitive' }),
    report: (event) => reportClaudeGuardDecision(event, env),
  });
  const pending = hook.handleActionPolicyHook(['--action-policy-hook', 'PRIVATE_POLICY'], (value) =>
    output.push(JSON.parse(value)),
  );
  input.end('PRIVATE_RAW_REQUEST');
  expect(await pending).toBe(0);
  expect(output[0].hookSpecificOutput.permissionDecision).toBe('deny');
  expect(requests).toEqual([
    {
      path: `/decision/${session}`,
      authorization: `Bearer ${token}`,
      body: '{"decision":"deny","reason":"project-deny-sensitive"}',
    },
  ]);
  expect(JSON.stringify(requests)).not.toContain('PRIVATE');
});

it('keeps the same provider decision when reporting is unavailable', async () => {
  const input = new PassThrough();
  const output = [];
  hook._setDepsForTest({
    input,
    evaluate: async () => ({ decision: 'ask' }),
    report: () => Promise.reject(Error('PRIVATE_REPORT_FAILURE')),
  });
  const pending = hook.handleActionPolicyHook(['--action-policy-hook', 'PRIVATE_POLICY'], (value) =>
    output.push(JSON.parse(value)),
  );
  input.end('{}');
  expect(await pending).toBe(0);
  expect(output[0].hookSpecificOutput).toEqual({
    hookEventName: 'PreToolUse',
    permissionDecision: 'ask',
    permissionDecisionReason: 'AEGIS policy requires confirmation of this tool request.',
  });
});

it('refuses malformed capabilities and non-whitelisted event fields without connecting', async () => {
  const env = {
    AEGIS_CLAUDE_GUARD_PORT: '1',
    AEGIS_CLAUDE_GUARD_SESSION: session,
    AEGIS_CLAUDE_GUARD_CAPABILITY: 'not-a-capability',
  };
  await expect(
    reportClaudeGuardDecision({ decision: 'allow', reason: 'generic' }, env),
  ).resolves.toBeUndefined();
  env.AEGIS_CLAUDE_GUARD_CAPABILITY = token;
  await expect(
    reportClaudeGuardDecision({ decision: 'allow', reason: 'generic', input: 'PRIVATE' }, env),
  ).resolves.toBeUndefined();
});

it('correlates only the same private attempt and exact input under the same launch key', () => {
  const env = { AEGIS_CLAUDE_GUARD_CAPABILITY: token };
  const before = {
    session_id: 'PRIVATE_SESSION',
    tool_use_id: 'PRIVATE_TOOL',
    cwd: path.resolve('fixture'),
    tool_name: 'Bash',
    hook_event_name: 'PreToolUse',
    tool_input: { command: 'PRIVATE_COMMAND', nested: { b: 2, a: 1 } },
  };
  const after = {
    ...before,
    hook_event_name: 'PostToolUse',
    tool_input: { nested: { a: 1, b: 2 }, command: 'PRIVATE_COMMAND' },
    tool_response: 'PRIVATE_OUTPUT',
  };
  const key = correlateClaudeGuardAttempt(Buffer.from(JSON.stringify(before)), ['PreToolUse'], env);
  expect(key).toMatch(/^[a-f0-9]{64}$/);
  expect(
    correlateClaudeGuardAttempt(Buffer.from(JSON.stringify(after)), ['PostToolUse'], env),
  ).toBe(key);
  expect(
    correlateClaudeGuardAttempt(
      Buffer.from(JSON.stringify({ ...after, tool_use_id: 'OTHER' })),
      ['PostToolUse'],
      env,
    ),
  ).not.toBe(key);
  expect(
    correlateClaudeGuardAttempt(
      Buffer.from(JSON.stringify({ ...after, tool_input: { command: 'CHANGED' } })),
      ['PostToolUse'],
      env,
    ),
  ).not.toBe(key);
  expect(
    correlateClaudeGuardAttempt(Buffer.from(JSON.stringify(after)), ['PostToolUse'], {
      AEGIS_CLAUDE_GUARD_CAPABILITY: 'b'.repeat(64),
    }),
  ).not.toBe(key);
  expect(key).not.toContain('PRIVATE');
});

it.each([
  ['PostToolUse', 'reported-completed'],
  ['PostToolUseFailure', 'reported-failed'],
])('emits only an opaque %s observation and never provider output', async (phase, outcome) => {
  const env = { AEGIS_CLAUDE_GUARD_CAPABILITY: token };
  const input = new PassThrough();
  const reports = [];
  hook._setDepsForTest({ input, env, reportOutcome: (event) => reports.push(event) });
  const done = hook.handleActionPolicyAfterHook(['--action-policy-after-hook', 'PRIVATE_POLICY']);
  input.end(
    JSON.stringify({
      session_id: 'PRIVATE_SESSION',
      tool_use_id: 'PRIVATE_TOOL',
      cwd: path.resolve('fixture'),
      tool_name: 'Bash',
      hook_event_name: phase,
      tool_input: { command: 'PRIVATE_COMMAND' },
      tool_response: 'PRIVATE_OUTPUT',
      error: 'PRIVATE_ERROR',
    }),
  );
  expect(await done).toBe(0);
  expect(reports).toEqual([{ attempt: expect.stringMatching(/^[a-f0-9]{64}$/), outcome }]);
  expect(JSON.stringify(reports)).not.toContain('PRIVATE');
});

it('marks malformed after input as lost and never fails the provider result', async () => {
  const input = new PassThrough(),
    reports = [];
  hook._setDepsForTest({ input, reportOutcome: (event) => reports.push(event) });
  const done = hook.handleActionPolicyAfterHook(['--action-policy-after-hook', 'PRIVATE_POLICY']);
  input.end('{');
  expect(await done).toBe(0);
  expect(reports).toEqual([{ outcome: 'loss' }]);
});

it('marks oversized after input and invalid arguments as lost without a provider failure', async () => {
  for (const [args, data] of [
    [['--action-policy-after-hook', 'POLICY'], 'x'.repeat(hook.LIMITS.inputBytes + 1)],
    [['--action-policy-after-hook'], '{}'],
  ]) {
    const input = new PassThrough(),
      reports = [];
    hook._setDepsForTest({ input, reportOutcome: (event) => reports.push(event) });
    const done = hook.handleActionPolicyAfterHook(args);
    input.end(data);
    expect(await done).toBe(0);
    expect(reports).toEqual([{ outcome: 'loss' }]);
  }
});
