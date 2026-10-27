import { afterEach, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { PassThrough } from 'node:stream';

const require = createRequire(import.meta.url);
const { reportClaudeGuardDecision } = require('../../src/main/claude-guard-report');
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
