import { afterEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import {
  createProviderCorpus,
  providerMessage,
  writeProviderPolicy,
} from '../../scripts/qualification/provider-replay-corpus.mjs';
const require = createRequire(import.meta.url);
const policySession = require('../../src/main/action-policy-session');
const { createClaudeAdapter } = require('../../src/main/provider-claude-adapter');
const { createCodexAdapter } = require('../../src/main/provider-codex-adapter');
const fixtures = [],
  adapters = [];
async function owner(provider, decision = 'allow') {
  const fixture = await createProviderCorpus();
  fixtures.push(fixture);
  const policy = await writeProviderPolicy(fixture.root, decision);
  const adapter = (provider === 'codex' ? createCodexAdapter : createClaudeAdapter)({
    cwd: fixture.root,
    sessionId: 'dummy-session',
    policyPath: policy.policyPath,
  });
  adapters.push(adapter);
  return { fixture, adapter };
}
afterEach(async () => {
  for (const adapter of adapters) adapter.close();
  adapters.length = 0;
  policySession._resetForTest();
  vi.useRealTimers();
  for (const fixture of fixtures) await fixture.cleanup();
  fixtures.length = 0;
});

it.each(['claude', 'codex'])(
  'admits only its own %s schema and dispatches the independently verified positive control',
  async (provider) => {
    const a = await owner(provider);
    const input = providerMessage(provider, a.fixture.root, 'edit');
    const pending = a.adapter.before(input);
    input.fill(0);
    expect(await pending).toMatchObject({ decision: 'allow', launchAllowed: false });
    await a.fixture.receive('edit');
    expect(a.adapter.after(providerMessage(provider, a.fixture.root, 'edit', true))).toMatchObject({
      status: 'linked',
      outcome: 'reported-completed',
    });
    expect(await a.fixture.observe('edit')).toEqual({ present: true, bytesMatch: true });
    const b = await owner(provider);
    const wrong = providerMessage(
      provider === 'codex' ? 'claude' : 'codex',
      b.fixture.root,
      'edit',
    );
    const decision = await b.adapter.before(wrong);
    if (decision.decision === 'allow') await b.fixture.receive('edit');
    expect(decision.decision).toBe('deny');
    expect(b.fixture.deliveries()).toBe(0);
    expect(await b.fixture.observe('edit')).toEqual({ present: false, bytesMatch: false });
  },
);

it.each(['claude', 'codex'])(
  'keeps %s denied and pending decisions distinct without effects',
  async (provider) => {
    for (const decision of ['deny', 'ask']) {
      const a = await owner(provider, decision);
      const result = await a.adapter.before(providerMessage(provider, a.fixture.root, 'edit'));
      expect(result.decision).toBe(decision);
      expect(result.wire.hookSpecificOutput.permissionDecision).toBe(
        provider === 'codex' && decision === 'ask' ? 'deny' : decision,
      );
      expect(result.approvalSupported).toBe(provider === 'claude');
      expect(a.fixture.deliveries()).toBe(0);
    }
  },
);

it.each(['session_id', 'cwd', 'tool_name', 'tool_input', 'schemaVersion'])(
  'refuses changed %s input before the byte receiver',
  async (key) => {
    const a = await owner('codex');
    const value = JSON.parse(providerMessage('codex', a.fixture.root, 'edit'));
    value[key] = key === 'tool_input' ? { command: 'never-executed-substitution' } : 'substitution';
    const result = await a.adapter.before(Buffer.from(JSON.stringify(value)));
    if (result.decision === 'allow') await a.fixture.receive('edit');
    expect(result.decision).toBe('deny');
    expect(a.fixture.deliveries()).toBe(0);
  },
);

it.each(['turn_id', 'model', 'tool_input', 'tool_use_id'])(
  'rejects a changed Codex completion %s and refuses later admission',
  async (key) => {
    const a = await owner('codex');
    await a.adapter.before(providerMessage('codex', a.fixture.root, 'edit'));
    const value = JSON.parse(providerMessage('codex', a.fixture.root, 'edit', true));
    value[key] = key === 'tool_input' ? { command: 'never-executed-substitution' } : 'other';
    expect(a.adapter.after(Buffer.from(JSON.stringify(value))).status).toBe('rejected');
    expect(
      (await a.adapter.before(providerMessage('codex', a.fixture.root, 'other'))).decision,
    ).toBe('deny');
  },
);

it('distinguishes a linked provider completion from missing independent file effects', async () => {
  const a = await owner('claude');
  await a.adapter.before(providerMessage('claude', a.fixture.root, 'edit'));
  expect(a.adapter.after(providerMessage('claude', a.fixture.root, 'edit', true)).outcome).toBe(
    'reported-completed',
  );
  expect(await a.fixture.observe('edit')).toEqual({ present: false, bytesMatch: false });
  expect(a.adapter.snapshot().observation.activityCoverage).toBe('unknown');
});

it('closes on duplicate completions and bounds finite preparation quotas without refund', async () => {
  const a = await owner('claude');
  for (let index = 0; index < 64; index++) {
    const id = 'action-' + index;
    expect((await a.adapter.before(providerMessage('claude', a.fixture.root, id))).decision).toBe(
      'allow',
    );
    expect(a.adapter.after(providerMessage('claude', a.fixture.root, id, true)).status).toBe(
      'linked',
    );
  }
  expect(
    (await a.adapter.before(providerMessage('claude', a.fixture.root, 'exhausted'))).decision,
  ).toBe('deny');
  expect(a.adapter.snapshot()).toMatchObject({ closed: true, limitExceeded: true });
  const b = await owner('claude');
  await b.adapter.before(providerMessage('claude', b.fixture.root, 'edit'));
  expect(b.adapter.after(providerMessage('claude', b.fixture.root, 'edit', true)).status).toBe(
    'linked',
  );
  expect(b.adapter.after(providerMessage('claude', b.fixture.root, 'edit', true)).status).toBe(
    'rejected',
  );
});

it('reuses the actual session deadline for a missing evaluator result and rejects its late completion', async () => {
  vi.useFakeTimers();
  policySession._setDepsForTest({ evaluate: () => new Promise(() => {}) });
  const a = await owner('codex');
  const running = a.adapter.before(providerMessage('codex', a.fixture.root, 'edit'));
  await vi.advanceTimersByTimeAsync(1501);
  expect(await running).toMatchObject({ decision: 'deny', reason: 'decision-timeout' });
  expect(a.adapter.after(providerMessage('codex', a.fixture.root, 'edit', true)).status).toBe(
    'rejected',
  );
  expect(a.fixture.deliveries()).toBe(0);
});
