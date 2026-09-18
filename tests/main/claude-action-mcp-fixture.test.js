import { expect, it } from 'vitest';
import {
  captureToolResult,
  hasPrivateCanary,
  setPrivateCanaries,
} from '../../scripts/claude-action-mcp-fixture.mjs';

const report = (extra = {}) => ({
  schemaVersion: 1,
  mode: 'action-exec',
  decision: 'allow',
  reason: 'child-exited',
  execution: { state: 'exited', exitCode: 0, outputComplete: true, termination: 'not-requested' },
  control: 'direct-child-only',
  descendantControl: 'unsupported',
  ...extra,
});
const block = (content, extra = {}) => ({
  type: 'tool_result',
  tool_use_id: 'toolu_aegislocal0001',
  content,
  ...extra,
});
const capture = (scenario, ...blocks) =>
  captureToolResult({ messages: [{ content: blocks }] }, scenario);

it('retains only verified approval and fixed reason fields in a provider-heading report', () => {
  const scenario = {};
  capture(
    scenario,
    block([
      {
        type: 'text',
        text:
          'Tool result:\n' +
          JSON.stringify(
            report({
              authorization: 'operator-confirmed',
              policyDecision: 'ask',
            }),
          ),
      },
    ]),
  );
  expect(scenario.report).toMatchObject({
    decision: 'allow',
    reason: 'child-exited',
    authorization: 'operator-confirmed',
    policyDecision: 'ask',
  });
  expect(scenario.privacyPass).toBe(true);
});

it.each(['allow', 'ask', 'deny'])(
  'preserves existing %s decisions and fixed policy metadata',
  (decision) => {
    const scenario = {};
    capture(
      scenario,
      block(report({ decision, reason: `policy-${decision}`, policyDecision: decision })),
    );
    expect(scenario.report.decision).toBe(decision);
    expect(scenario.report.reason).toBe(`policy-${decision}`);
    expect(scenario.report.policyDecision).toBe(decision);
  },
);

it.each([undefined, 'secret-not-a-fixed-code', { nested: 'secret-value' }])(
  'drops unsupported optional metadata and sanitizes unknown or missing reasons',
  (unknown) => {
    const scenario = {};
    capture(
      scenario,
      block(report({ reason: unknown, authorization: unknown, policyDecision: unknown })),
    );
    expect(scenario.report.reason).toBe('unexpected');
    expect(scenario.report).not.toHaveProperty('authorization');
    expect(scenario.report).not.toHaveProperty('policyDecision');
    expect(JSON.stringify(scenario)).not.toContain('secret');
  },
);

it('detects a descriptor bearer anywhere in the full result and keeps failure sticky across clean duplicates', () => {
  const scenario = {};
  const token = 'ab'.repeat(32);
  setPrivateCanaries(scenario, [token]);
  capture(scenario, block(report(), { providerDetail: { leaked: token } }), block(report()));
  expect(scenario.privacyLeakDetected).toBe(true);
  expect(scenario.privacyPass).toBe(false);
  expect(hasPrivateCanary('provider stdout ' + token, scenario)).toBe(true);
  expect(JSON.stringify({ ...scenario })).not.toContain(token);
});

it('detects raw and nested JSON-escaped paths without adding enumerable private state', () => {
  const scenario = {};
  const marker = 'X:\\owned\\operator "review"\\endpoint.json';
  const values = [marker];
  setPrivateCanaries(scenario, values);
  values[0] = 'changed-after-registration';
  expect(Object.keys(scenario)).toEqual([]);
  expect(JSON.stringify(scenario)).toBe('{}');
  expect(hasPrivateCanary(marker, scenario)).toBe(true);
  let escaped = marker;
  for (let depth = 0; depth < 4; depth++) {
    escaped = JSON.stringify(escaped);
    expect(hasPrivateCanary(escaped, scenario)).toBe(true);
  }
  capture(scenario, block([{ type: 'text', text: JSON.stringify({ ...report(), path: marker }) }]));
  expect(scenario.privacyPass).toBe(false);
  expect(JSON.stringify({ ...scenario })).not.toContain('endpoint.json');
});

it('keeps legacy markers and ordinary stdout checks independent of registered values', () => {
  expect(hasPrivateCanary('PRIVATE_detail', {})).toBe(true);
  expect(hasPrivateCanary({ text: 'aegis-mcp-owned-fixture' }, {})).toBe(true);
  expect(hasPrivateCanary('ordinary provider output', {})).toBe(false);
});

it.each([null, [''], [7], ['a'.repeat(1025)], Array(9).fill('marker')])(
  'rejects malformed or oversized registration with a fixed error',
  (values) => {
    expect(() => setPrivateCanaries({}, values)).toThrow('fixture-canaries-invalid');
  },
);

it('rejects invalid sinks and accepts the exact bounded registration limit', () => {
  expect(() => setPrivateCanaries(null, ['marker'])).toThrow('fixture-canaries-invalid');
  const scenario = {};
  setPrivateCanaries(scenario, Array(8).fill('m'.repeat(1024)));
  expect(hasPrivateCanary('m'.repeat(1024), scenario)).toBe(true);
});
