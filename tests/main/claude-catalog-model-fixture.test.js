import { expect, it, vi } from 'vitest';
import {
  configureCatalogScenario,
  replyWithCatalogTools,
} from '../../scripts/claude-catalog-model-fixture.mjs';
const tools = ['first', 'second'].map((name) => ({ name: 'mcp__aegis__aegis_action_' + name }));
const result = (index, extra = {}) => ({
  type: 'tool_result',
  tool_use_id: 'toolu_aegiscatalog' + index,
  content: JSON.stringify({
    schemaVersion: 1,
    mode: 'action-exec',
    decision: 'allow',
    reason: 'child-exited',
    execution: { state: 'exited', exitCode: 0, outputComplete: true, termination: 'not-requested' },
    control: 'direct-child-only',
    descendantControl: 'unsupported',
    ...extra,
  }),
});
function configured(plan = ['first', 'second'], canaries = [], onStep) {
  const scenario = { requests: 0 };
  configureCatalogScenario(scenario, plan, canaries, onStep);
  return scenario;
}
function reply(scenario, blocks = [], options = {}) {
  scenario.requests++;
  let text = '';
  let headers;
  replyWithCatalogTools(
    {
      writeHead: (_code, value) => {
        headers = value;
      },
      write: (value) => {
        text += value;
      },
      end: (value = '') => {
        text += value;
      },
    },
    { tools, messages: [{ content: blocks }], ...options },
    scenario,
  );
  return headers['Content-Type'] === 'application/json' ? JSON.parse(text) : text;
}
it('requests two tools in order only after actual results and records callback before next emission', () => {
  const callback = vi.fn();
  const scenario = configured(undefined, [], callback);
  expect(reply(scenario).content[0]).toMatchObject({
    id: 'toolu_aegiscatalog1',
    name: tools[0].name,
  });
  expect(scenario.completedSteps).toBe(0);
  expect(reply(scenario, [result(1)]).content[0]).toMatchObject({
    id: 'toolu_aegiscatalog2',
    name: tools[1].name,
  });
  expect(callback).toHaveBeenCalledTimes(1);
  expect(reply(scenario, [result(1), result(2)]).stop_reason).toBe('end_turn');
  expect(scenario).toMatchObject({
    requestedSteps: 2,
    completedSteps: 2,
    toolDiscovered: true,
    protocolError: false,
  });
  expect(callback).toHaveBeenCalledTimes(2);
});
it('supports second-only and review sequence with two completed and third pending', () => {
  const single = configured(['second']);
  expect(reply(single).content[0].name).toBe(tools[1].name);
  expect(reply(single, [result(1)]).stop_reason).toBe('end_turn');
  const review = configured(['first', 'second', 'second']);
  reply(review);
  reply(review, [result(1)]);
  expect(reply(review, [result(1), result(2)]).content[0].id).toBe('toolu_aegiscatalog3');
  expect(review).toMatchObject({ completedSteps: 2, requestedSteps: 3 });
  expect(review.steps[2].toolResultSeen).toBe(false);
});
it.each(
  [[], [result(2)], [{ ...result(1), content: 'malformed' }], [result(1), result(1)]].map(
    (blocks) => [blocks],
  ),
)('fails closed on missing, wrong, malformed or duplicate current results', (blocks) => {
  const scenario = configured();
  reply(scenario);
  expect(reply(scenario, blocks).stop_reason).toBe('end_turn');
  expect(scenario.protocolError).toBe(true);
  expect(scenario.requestedSteps).toBe(1);
});
it('does not reuse old results as the next step', () => {
  const scenario = configured(['first', 'second', 'second']);
  reply(scenario);
  reply(scenario, [result(1)]);
  expect(reply(scenario, [result(1)]).stop_reason).toBe('end_turn');
  expect(scenario).toMatchObject({ protocolError: true, completedSteps: 1, requestedSteps: 2 });
});
it('detects unrelated canaries and changed leaking history with sticky private failure', () => {
  const token = 'ab'.repeat(32);
  const scenario = configured(undefined, [token]);
  reply(scenario);
  reply(scenario, [result(1)]);
  expect(reply(scenario, [{ ...result(1), arbitrary: token }, result(2)]).stop_reason).toBe(
    'end_turn',
  );
  expect(scenario.privacyLeakDetected).toBe(true);
  expect(scenario.steps.every((step) => !step.privacyPass)).toBe(true);
  expect(JSON.stringify(scenario)).not.toContain(token);
  reply(scenario, [result(1), result(2)]);
  expect(scenario.privacyLeakDetected).toBe(true);
  const unrelated = configured(undefined, [token]);
  reply(unrelated);
  reply(unrelated, [result(1), { type: 'tool_result', tool_use_id: 'unrelated', content: token }]);
  expect(unrelated.privacyLeakDetected).toBe(true);
});
it('keeps raw errors and private plan/canaries/callbacks out of serialized receipts', () => {
  const scenario = configured(['second'], ['secret-token'], () => {
    throw Error('PRIVATE_CALLBACK');
  });
  reply(scenario);
  reply(scenario, [
    result(1, { ignored: 'arbitrary-opaque-payload', reason: 'unknown-secret-reason' }),
  ]);
  expect(scenario.protocolError).toBe(true);
  expect(scenario.steps[0].report.reason).toBe('unexpected');
  const encoded = JSON.stringify({ ...scenario });
  for (const privateValue of [
    'secret-token',
    'PRIVATE_CALLBACK',
    'arbitrary-opaque-payload',
    'unknown-secret-reason',
  ])
    expect(encoded).not.toContain(privateValue);
});
it('requires all planned tools on first request and fixed request-one start', () => {
  const scenario = configured();
  expect(reply(scenario, [], { tools: [tools[0]] }).stop_reason).toBe('end_turn');
  expect(scenario.toolDiscovered).toBe(false);
  const late = configured();
  late.requests = 1;
  expect(reply(late).stop_reason).toBe('end_turn');
  expect(late.protocolError).toBe(true);
});
it('emits valid SSE tool blocks with unique fixed ids', () => {
  const scenario = configured();
  const text = reply(scenario, [], { stream: true });
  expect(text).toContain('event: message_start');
  expect(text).toContain('"id":"toolu_aegiscatalog1"');
  expect(text).toContain('"stop_reason":"tool_use"');
});
it.each([[], ['third'], ['first', 'second', 'first', 'second'], Array(1)].map((plan) => [plan]))(
  'rejects invalid bounded plans',
  (plan) => {
    expect(() => configured(plan)).toThrow('catalog-fixture-invalid');
  },
);

it('accepts provider-rewritten old wrappers only when sanitized result semantics stay identical', () => {
  const scenario = configured(['first', 'second', 'second']);
  reply(scenario);
  reply(scenario, [result(1)]);
  const rewritten = {
    ...result(1),
    content: [{ type: 'text', text: 'Provider result:\n' + result(1).content }],
  };
  expect(reply(scenario, [rewritten, result(2)]).content[0].id).toBe('toolu_aegiscatalog3');
  expect(scenario.protocolError).toBe(false);
});

it.each([
  { ...result(1), is_error: true },
  result(1, { decision: 'deny', reason: 'policy-deny' }),
  result(1, { execution: { state: 'exited', exitCode: 7, outputComplete: true } }),
])('rejects changed prior actual report semantics', (changed) => {
  const scenario = configured(['first', 'second', 'second']);
  reply(scenario);
  reply(scenario, [result(1)]);
  expect(reply(scenario, [changed, result(2)]).stop_reason).toBe('end_turn');
  expect(scenario.protocolError).toBe(true);
  expect(scenario.requestedSteps).toBe(2);
});
