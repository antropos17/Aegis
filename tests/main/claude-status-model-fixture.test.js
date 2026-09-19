import { expect, it, vi } from 'vitest';
import {
  configureStatusScenario,
  replyWithStatusTools,
} from '../../scripts/claude-status-model-fixture.mjs';

const snapshot = (after = false, catalog = false) => ({
  schemaVersion: 1,
  mode: 'action-route-status',
  scope: 'current-mcp-connection',
  selection: catalog ? 'catalog' : 'single-action',
  selectedActionCount: catalog ? 2 : 1,
  activity: 'idle',
  messagesObserved: after ? 6 : 4,
  actionAttempts: after ? 1 : 0,
  selectionRejected: 0,
  ownerInvocations: after ? 1 : 0,
  ownerSettled: after ? 1 : 0,
  ownerFailures: 0,
  cancellationRequests: 0,
  limits: { messages: 128, actionAttempts: 16 },
  authorization: 'none',
  control: 'direct-child-only',
  outsideRouteCoverage: 'unknown',
  descendantControl: 'unsupported',
  blockingVerification: 'not-performed',
  providerIdentity: 'unverified',
});
const action = {
  schemaVersion: 1,
  mode: 'action-exec',
  decision: 'allow',
  reason: 'child-exited',
  execution: { state: 'exited', exitCode: 0, outputComplete: true, termination: 'not-requested' },
  control: 'direct-child-only',
  descendantControl: 'unsupported',
};
function setup(catalog = false, onStep) {
  const scenario = { requests: 0 };
  configureStatusScenario(scenario, { catalog }, ['secret-marker', '/owned/path'], onStep);
  const input = {
    tools: [
      { name: 'mcp__aegis__aegis_route_status' },
      { name: catalog ? 'mcp__aegis__aegis_action_second' : 'mcp__aegis__aegis_execute_selected' },
    ],
    messages: [],
  };
  const reply = () => {
    scenario.requests++;
    let result;
    replyWithStatusTools(
      {
        writeHead() {},
        end(text) {
          result = JSON.parse(text);
        },
      },
      input,
      scenario,
    );
    return result.content[0];
  };
  const add = (id, report, extra = {}) => {
    const block = {
      type: 'tool_result',
      tool_use_id: id,
      content: JSON.stringify(report),
      ...extra,
    };
    input.messages.push({ role: 'user', content: [block] });
    return block;
  };
  return { scenario, input, reply, add };
}

it.each([false, true])(
  'completes the correlated status/action/status plan for catalog=%s',
  (catalog) => {
    const onStep = vi.fn();
    const t = setup(catalog, onStep);
    const first = t.reply();
    expect(first.name).toBe('mcp__aegis__aegis_route_status');
    t.add(first.id, snapshot(false, catalog));
    const second = t.reply();
    expect(second.name).toBe(t.input.tools[1].name);
    t.add(second.id, action);
    const third = t.reply();
    expect(third.name).toBe(first.name);
    t.add(third.id, snapshot(true, catalog));
    expect(t.reply().type).toBe('text');
    expect(new Set([first.id, second.id, third.id]).size).toBe(3);
    expect(t.scenario).toMatchObject({
      completedSteps: 3,
      requestedSteps: 3,
      protocolError: false,
      privacyLeakDetected: false,
    });
    expect(t.scenario.steps.map((s) => s.tool)).toEqual(['status', 'action', 'status']);
    expect(
      t.scenario.steps.every((s) => s.toolResultSeen && s.privacyPass && !s.resultIsError),
    ).toBe(true);
    expect(onStep.mock.calls.map((args) => args[1])).toEqual([0, 1, 2]);
    expect(JSON.stringify(t.scenario)).not.toMatch(/secret-marker|owned\/path|canaries|names/);
  },
);

it('accepts equivalent old wrappers and identical duplicate report representations', () => {
  const t = setup();
  const first = t.reply();
  const old = t.add(first.id, snapshot(), {
    content: {
      structuredContent: snapshot(),
      content: [{ type: 'text', text: JSON.stringify(snapshot()) }],
    },
  });
  const second = t.reply();
  old.content = `Tool result heading\n${JSON.stringify(snapshot())}`;
  t.add(second.id, action);
  expect(t.reply().type).toBe('tool_use');
  expect(t.scenario.protocolError).toBe(false);
});

it.each([
  (r) => {
    r.ownerInvocations = 1;
  },
  (r) => {
    r.ownerSettled = -1;
  },
  (r) => {
    r.ownerFailures = 1;
  },
  (r) => {
    r.actionAttempts = 17;
  },
  (r) => {
    r.messagesObserved = 129;
  },
  (r) => {
    r.messagesObserved = 0;
  },
  (r) => {
    r.messagesObserved = 1.1;
  },
  (r) => {
    r.actionAttempts = '0';
  },
  (r) => {
    delete r.cancellationRequests;
  },
  (r) => {
    r.cancellationRequests = true;
  },
  (r) => {
    r.authorization = 'approved';
  },
  (r) => {
    r.providerIdentity = 'verified';
  },
  (r) => {
    r.selection = 'catalog';
  },
  (r) => {
    r.selectedActionCount = 2;
  },
  (r) => {
    r.limits.actionAttempts = 100;
  },
  (r) => {
    r.extra = 'untrusted';
  },
  (r) => {
    r.scope = 'global';
  },
  (r) => {
    r.activity = 'cancellation-requested';
  },
])('rejects unsafe, missing, mismatched or reflected status fields %#', (mutate) => {
  const t = setup();
  const first = t.reply();
  const report = snapshot();
  mutate(report);
  t.add(first.id, report);
  expect(t.reply().type).toBe('text');
  expect(t.scenario.protocolError).toBe(true);
  expect(t.scenario.completedSteps).toBe(0);
  expect(t.scenario.steps[0].report).toBeUndefined();
});

it('parses consistent pending and cancellation lifecycle snapshots without claiming termination', () => {
  for (const activity of ['owner-pending', 'cancellation-requested']) {
    const t = setup();
    const first = t.reply();
    t.add(first.id, {
      ...snapshot(),
      activity,
      actionAttempts: 1,
      ownerInvocations: 1,
      cancellationRequests: activity === 'cancellation-requested' ? 1 : 0,
    });
    expect(t.reply().type).toBe('tool_use');
    expect(t.scenario.steps[0].report.activity).toBe(activity);
    expect(t.scenario.steps[0].report).not.toHaveProperty('termination');
  }
});

it.each(['missing', 'unknown', 'duplicate', 'status-error', 'plain-text', 'ambiguous'])(
  'rejects uncorrelated or invalid status result %s',
  (kind) => {
    const t = setup();
    const first = t.reply();
    if (kind !== 'missing') {
      const block = t.add(kind === 'unknown' ? 'toolu_unknown' : first.id, snapshot());
      if (kind === 'duplicate') t.input.messages[0].content.push({ ...block });
      if (kind === 'status-error') block.is_error = true;
      if (kind === 'plain-text') block.content = 'aegis_route_status reports everything looks fine';
      if (kind === 'ambiguous')
        block.content = [snapshot(), { ...snapshot(), messagesObserved: 5 }];
    }
    expect(t.reply().type).toBe('text');
    expect(t.scenario.protocolError).toBe(true);
  },
);

it.each(['current-adjacent', 'historical-adjacent', 'unknown', 'deeply-escaped'])(
  'scans private data in %s raw results',
  (kind) => {
    const t = setup();
    const first = t.reply();
    const old = t.add(first.id, snapshot());
    if (kind === 'current-adjacent') old.content = [snapshot(), { text: 'secret-marker' }];
    else if (kind === 'deeply-escaped')
      old.content = JSON.stringify({ report: snapshot(), text: JSON.stringify('/owned/path') });
    else {
      const second = t.reply();
      t.add(second.id, action);
      if (kind === 'historical-adjacent') old.content = [snapshot(), { text: 'secret-marker' }];
      else t.add('unknown', { text: 'secret-marker' });
    }
    expect(t.reply().type).toBe('text');
    expect(t.scenario.privacyLeakDetected).toBe(true);
    expect(t.scenario.steps.every((s) => !s.privacyPass)).toBe(true);
    expect(JSON.stringify(t.scenario)).not.toContain('secret-marker');
  },
);

it('rejects changed semantic history and duplicate old results', () => {
  for (const duplicate of [false, true]) {
    const t = setup();
    const first = t.reply();
    const old = t.add(first.id, snapshot());
    const second = t.reply();
    t.add(second.id, action);
    if (duplicate) t.input.messages[0].content.push({ ...old });
    else old.content = JSON.stringify({ ...snapshot(), messagesObserved: 5 });
    expect(t.reply().type).toBe('text');
    expect(t.scenario.protocolError).toBe(true);
    expect(t.scenario.completedSteps).toBe(1);
  }
});

it.each(['depth', 'bytes', 'frames', 'messages', 'fifth-reply'])(
  'bounds %s work and stops emitting tools',
  (kind) => {
    const t = setup();
    const first = t.reply();
    let content = snapshot();
    if (kind === 'depth') for (let i = 0; i < 15; i++) content = { nested: content };
    if (kind === 'bytes') content = 'x'.repeat(65537);
    t.add(first.id, content);
    if (kind === 'frames')
      t.input.messages[0].content = Array(129).fill({ type: 'text', text: 'x' });
    if (kind === 'messages') t.input.messages = Array(129).fill({ content: [] });
    if (kind === 'fifth-reply') {
      const second = t.reply();
      t.add(second.id, action);
      const third = t.reply();
      t.add(third.id, snapshot(true));
      t.reply();
    }
    expect(t.reply().type).toBe('text');
    expect(t.scenario.protocolError).toBe(true);
  },
);

it('does not emit another action after a callback exception', () => {
  const t = setup(false, () => {
    throw Error('secret-marker');
  });
  const first = t.reply();
  t.add(first.id, snapshot());
  expect(t.reply().type).toBe('text');
  expect(t.scenario.protocolError).toBe(true);
  expect(JSON.stringify(t.scenario)).not.toContain('secret-marker');
});

it.each([null, [], undefined, false, 1, 'untrusted'])(
  'handles malformed top-level input %# without throwing',
  (input) => {
    const t = setup();
    let response;
    expect(() =>
      replyWithStatusTools(
        {
          writeHead() {},
          end(text) {
            response = JSON.parse(text);
          },
        },
        input,
        t.scenario,
      ),
    ).not.toThrow();
    expect(response.content[0]).toEqual({ type: 'text', text: 'OK' });
    expect(t.scenario.protocolError).toBe(true);
  },
);
