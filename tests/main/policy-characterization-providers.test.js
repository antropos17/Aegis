import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { PassThrough } from 'node:stream';
const require = createRequire(import.meta.url);
const { createSelection } = require('../fixtures/policy-characterization/selection.cjs');
const { createClaudeAdapter } = require('../../src/main/provider-claude-adapter');
const { createCodexAdapter } = require('../../src/main/provider-codex-adapter');
const claudeHook = require('../../src/main/action-policy-hook');
const geminiHook = require('../../src/main/gemini-beforetool-hook');
let fixture;
const adapters = [];
beforeEach(() => {
  fixture = createSelection();
});
afterEach(() => {
  for (const adapter of adapters.splice(0)) adapter.close();
  claudeHook._resetForTest();
  geminiHook._resetForTest();
  fixture.cleanup();
});
const json = (value) => Buffer.from(JSON.stringify(value));
const policy = (decision, rules = [{ tool: 'Bash', input: fixture.input, decision }]) => ({
  schemaVersion: 1,
  cwd: fixture.root,
  defaultDecision: 'ask',
  rules,
});
async function hookOutput(hook, method, flag, request) {
  const input = new PassThrough();
  hook._setDepsForTest({ input });
  const output = [];
  const pending = hook[method]([flag, fixture.policyPath], (text) => output.push(JSON.parse(text)));
  input.end(json(request));
  expect(await pending).toBe(0);
  expect(output).toHaveLength(1);
  return output[0];
}

describe('policy characterization: real evaluator through provider boundaries', () => {
  it.each(['claude', 'codex'])(
    'records complete %s outputs for explicit decisions, default ask and invalid policy',
    async (provider) => {
      for (const kind of ['allow', 'ask', 'deny', 'default-ask', 'invalid']) {
        fixture.write(
          kind === 'invalid'
            ? { ...policy('allow'), unknown: true }
            : policy(kind, kind === 'default-ask' ? [] : undefined),
        );
        const adapter = (provider === 'claude' ? createClaudeAdapter : createCodexAdapter)({
          policyPath: fixture.policyPath,
          cwd: fixture.root,
          sessionId: 'fixture_session',
        });
        adapters.push(adapter);
        const decision = kind === 'invalid' ? 'deny' : kind === 'default-ask' ? 'ask' : kind;
        const unsupported = provider === 'codex' && decision === 'ask';
        const request = {
          ...fixture.providerRequest,
          ...(provider === 'codex' ? { turn_id: 'fixture_turn', model: 'fixture_model' } : {}),
        };
        // The session intentionally publishes a fixed policy decision reason,
        // including when the underlying evaluator rejected a malformed policy.
        expect(await adapter.before(json(request))).toEqual({
          provider,
          adapterVersion: `${provider}-hook-subset-v1`,
          decision,
          reason: unsupported ? 'approval-unsupported' : `policy-${decision}`,
          approvalSupported: provider === 'claude',
          launchAllowed: false,
          wire: {
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              permissionDecision: unsupported ? 'deny' : decision,
              permissionDecisionReason: unsupported
                ? 'AEGIS adapter cannot request approval on this hook.'
                : 'AEGIS selected policy decision.',
            },
          },
        });
        adapter.close();
      }
    },
  );

  it('keeps Claude default ask in the native hook wire instead of a direct-execution descriptor', async () => {
    fixture.write(policy('ask', []));
    expect(
      await hookOutput(
        claudeHook,
        'handleActionPolicyHook',
        '--action-policy-hook',
        fixture.providerRequest,
      ),
    ).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: 'AEGIS policy requires confirmation of this tool request.',
      },
    });
  });
});

describe('policy characterization: Gemini has a separate denial-only schema 1', () => {
  const deny = { decision: 'deny', reason: 'AEGIS policy does not allow this tool request.' };
  const request = (toolInput = fixture.input) => ({
    hook_event_name: 'BeforeTool',
    tool_name: 'run_shell_command',
    cwd: fixture.root,
    tool_input: toolInput,
    futureProviderMetadata: { private: 'IGNORED_METADATA' },
  });
  const selection = (entries) => ({
    schemaVersion: 1,
    provider: 'gemini-cli',
    hook: 'BeforeTool',
    cwd: fixture.root,
    tool: 'run_shell_command',
    deny: entries,
  });
  const wire = (value) =>
    hookOutput(geminiHook, 'handleGeminiBeforeToolHook', '--gemini-beforetool-hook', value);

  it.each(['forward', 'reverse'])(
    'emits exact deny or empty wire for disjoint predicates in %s order',
    async (order) => {
      const entries = [fixture.input, { command: 'OTHER', description: null }];
      if (order === 'reverse') entries.reverse();
      fixture.write(selection(entries));
      for (const input of entries) expect(await wire(request(input))).toEqual(deny);
      expect(await wire(request({ ...fixture.input, extra: true }))).toEqual({});
    },
  );

  it('denies an unmatched request when any denial predicate is invalid or duplicated', async () => {
    const reordered = { options: { labels: ['a', 'b'], timeout: 1 }, command: 'PRIVATE_COMMAND' };
    for (const entries of [
      [fixture.input, { command: '' }],
      [fixture.input, reordered],
    ]) {
      fixture.write(selection(entries));
      expect(await wire(request({ command: 'UNMATCHED' }))).toEqual(deny);
    }
  });

  it('refuses the Claude schema 1 in Gemini and Gemini schema 1 in the Claude hook', async () => {
    fixture.write(policy('allow'));
    expect(await wire(request({ command: 'UNMATCHED' }))).toEqual(deny);
    fixture.write(selection([fixture.input]));
    expect(
      await hookOutput(
        claudeHook,
        'handleActionPolicyHook',
        '--action-policy-hook',
        fixture.providerRequest,
      ),
    ).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: deny.reason,
      },
    });
  });
});
