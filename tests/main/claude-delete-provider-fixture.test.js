import { expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { PassThrough } from 'node:stream';
import {
  captureDeleteToolResult,
  deleteScenarioPassed,
  replyWithDeleteTool,
} from '../../scripts/claude-delete-provider-fixture.mjs';
import { observeDeletePreview } from '../../scripts/claude-delete-review-observer.mjs';
import { fixtureModes } from '../../scripts/claude-action-mcp-options.mjs';

const TOOL = 'mcp__aegis__aegis_delete_selected_file';
const TOOL_ID = 'toolu_aegisdelete0001';
const require = createRequire(import.meta.url);
const terminal = require('../../src/main/action-confirmation-terminal');

function observed(name = 'approved-delete') {
  const approved = name === 'approved-delete';
  const refused = name === 'refused-delete';
  return {
    name,
    toolDiscovered: true,
    toolResultCount: 1,
    exitCode: 0,
    brokerCode: 0,
    timedOut: false,
    cancelled: false,
    exceeded: false,
    stdoutPrivacyPass: true,
    privacyPass: true,
    privacyLeakDetected: false,
    brokerClosed: true,
    endpointRemoved: true,
    ownerAbortRequired: false,
    neighborPreserved: true,
    previewCount: approved || refused ? 1 : 0,
    freshChallengeObserved: approved || refused,
    affirmativeAnswerObserved: approved,
    negativeAnswerObserved: refused,
    targetRemoved: approved,
    targetRetained: !approved,
    resultIsError: !approved,
    report: {
      schemaVersion: 1,
      mode: 'action-delete-file',
      decision: approved ? 'allow' : 'deny',
      reason: approved ? 'file-deleted' : refused ? 'confirmation-denied' : 'policy-deny',
      operation: { state: approved ? 'deleted' : 'not-started' },
      control: 'selected-file-only',
      outsideRouteCoverage: 'unknown',
    },
  };
}

it('exposes the bounded opt-in terminal mode', () => {
  expect(fixtureModes(['--delete-review'])).toMatchObject({
    deleteReview: true,
    review: false,
    catalog: false,
  });
});

it('asks only for the discovered selected-file tool with empty arguments', () => {
  const response = { writeHead: vi.fn(), end: vi.fn() };
  const scenario = { requests: 1, toolDiscovered: false, toolResultCount: 0 };
  replyWithDeleteTool(response, { stream: false, tools: [{ name: TOOL }], messages: [] }, scenario);
  expect(scenario.toolDiscovered).toBe(true);
  expect(JSON.parse(response.end.mock.calls[0][0]).content).toEqual([
    { type: 'tool_use', id: TOOL_ID, name: TOOL, input: {} },
  ]);
  const absent = { writeHead: vi.fn(), end: vi.fn() };
  replyWithDeleteTool(absent, { stream: false, tools: [], messages: [] }, scenario);
  expect(JSON.parse(absent.end.mock.calls[0][0]).content).toEqual([{ type: 'text', text: 'OK' }]);
});

it('accepts an actual matching tool_result JSON block and redacts its fields', () => {
  const scenario = { toolResultCount: 0 };
  const report = observed().report;
  captureDeleteToolResult(
    {
      messages: [
        {
          content: [
            { type: 'tool_result', tool_use_id: 'another-call', content: JSON.stringify(report) },
            {
              type: 'tool_result',
              tool_use_id: TOOL_ID,
              content: [{ type: 'text', text: `MCP result:\n${JSON.stringify(report)}` }],
              is_error: false,
            },
          ],
        },
      ],
    },
    scenario,
  );
  expect(scenario).toMatchObject({
    toolResultCount: 1,
    resultIsError: false,
    privacyPass: true,
    report,
  });
  expect(JSON.stringify(scenario)).not.toContain('another-call');
});

it('does not turn model prose, a wrong tool ID or a private path into deletion evidence', () => {
  const scenario = { toolResultCount: 0, privacyPass: false };
  captureDeleteToolResult(
    {
      messages: [
        {
          content: [
            { type: 'tool_result', tool_use_id: 'different', content: observed().report },
            { type: 'text', text: JSON.stringify(observed().report) },
            {
              type: 'tool_result',
              tool_use_id: TOOL_ID,
              content: [{ type: 'text', text: 'The file was deleted.' }],
            },
          ],
        },
      ],
    },
    scenario,
  );
  expect(scenario.toolResultCount).toBe(1);
  expect(scenario.report).toBeUndefined();
  expect(deleteScenarioPassed({ ...observed(), ...scenario, report: scenario.report })).toBe(false);
  captureDeleteToolResult(
    {
      messages: [
        {
          content: [
            {
              type: 'tool_result',
              tool_use_id: TOOL_ID,
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ ...observed().report, leak: 'PRIVATE_PATH' }),
                },
              ],
            },
          ],
        },
      ],
    },
    scenario,
  );
  expect(scenario.privacyLeakDetected).toBe(true);
  expect(scenario.privacyPass).toBe(false);
});

it.each(['approved-delete', 'refused-delete', 'policy-deny'])(
  'requires complete provider, terminal and filesystem evidence for %s',
  (name) => {
    expect(deleteScenarioPassed(observed(name))).toBe(true);
    for (const change of [
      { toolDiscovered: false },
      { toolResultCount: 0 },
      { toolResultCount: 2 },
      { exitCode: 1 },
      { brokerCode: 2 },
      { timedOut: true },
      { cancelled: true },
      { exceeded: true },
      { stdoutPrivacyPass: false },
      { privacyPass: false },
      { privacyLeakDetected: true },
      { brokerClosed: false },
      { endpointRemoved: false },
      { ownerAbortRequired: true },
      { neighborPreserved: false },
      { resultIsError: name === 'approved-delete' },
      { targetRemoved: name !== 'approved-delete' },
      { targetRetained: name === 'approved-delete' },
      { previewCount: 2 },
    ])
      expect(deleteScenarioPassed({ ...observed(name), ...change })).toBe(false);
    for (const reportChange of [
      { decision: 'unknown' },
      { reason: 'unexpected' },
      { operation: { state: 'unknown' } },
      { control: 'unexpected' },
      { outsideRouteCoverage: 'unexpected' },
    ]) {
      const item = observed(name);
      Object.assign(item.report, reportChange);
      expect(deleteScenarioPassed(item)).toBe(false);
    }
  },
);

it('requires affirmative and negative terminal answers for their respective cases', () => {
  expect(deleteScenarioPassed({ ...observed(), affirmativeAnswerObserved: false })).toBe(false);
  expect(deleteScenarioPassed({ ...observed(), freshChallengeObserved: false })).toBe(false);
  expect(
    deleteScenarioPassed({ ...observed('refused-delete'), negativeAnswerObserved: false }),
  ).toBe(false);
  expect(
    deleteScenarioPassed({ ...observed('refused-delete'), freshChallengeObserved: false }),
  ).toBe(false);
});

it('observes only a drained delete preview for the exact owned target', () => {
  const target = 'C:\\owned\\target.txt';
  const calls = [];
  const output = {
    write(value, callback) {
      calls.push(value);
      callback?.();
      return true;
    },
  };
  const original = output.write;
  const found = [];
  const restore = observeDeletePreview(output, target, (challenge) => found.push(challenge));
  const preview =
    'AEGIS terminal confirmation - ONE file deletion\n' +
    'The exact file path is displayed below. Terminal history may retain it.\n' +
    'Exact operation (JSON escapes are literal):\n' +
    JSON.stringify({ kind: 'delete-file', path: target }, null, 2) +
    '\nType DELETE 1234abcd to remove this file once within 60 seconds. Any other answer denies.\n> ';
  output.write(preview.replace(JSON.stringify(target), JSON.stringify('C:\\other.txt')));
  expect(found).toEqual([]);
  output.write(preview);
  expect(found).toEqual(['1234abcd']);
  restore();
  expect(output.write).toBe(original);
  output.write(preview);
  expect(found).toEqual(['1234abcd']);
  expect(calls).toHaveLength(3);
});

it('recognizes a Unicode scratch path rendered by the production terminal', async () => {
  const target = 'C:\\owned\\café-🛡.txt';
  const input = new PassThrough();
  const output = new PassThrough();
  input.isTTY = true;
  output.isTTY = true;
  terminal._setDepsForTest({ input, output, randomBytes: () => Buffer.from('1234abcd', 'hex') });
  const found = [];
  const restore = observeDeletePreview(output, target, (challenge) => {
    found.push(challenge);
    input.write('no\n');
  });
  try {
    expect(
      await terminal.confirmInTerminal(
        { kind: 'delete-file', path: target },
        { kind: 'delete-file' },
      ),
    ).toBe(false);
    expect(found).toEqual(['1234abcd']);
  } finally {
    restore();
    terminal._resetForTest();
    input.destroy();
    output.destroy();
  }
});
