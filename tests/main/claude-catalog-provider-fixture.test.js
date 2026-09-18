import { afterEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { PassThrough } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  catalogScenarioPassed,
  verifyCatalogRoute,
} from '../../scripts/claude-catalog-provider-fixture.mjs';
import {
  configureCatalogScenario,
  replyWithCatalogTools,
} from '../../scripts/claude-catalog-model-fixture.mjs';

const roots = [];
afterEach(() => {
  for (const owned of roots.splice(0)) {
    expect(path.dirname(owned)).toBe(path.resolve(os.tmpdir()));
    expect(fs.lstatSync(owned).isSymbolicLink()).toBe(false);
    fs.rmSync(owned, { recursive: true, force: true });
  }
});
function step(tool, decision = 'allow', reason = 'child-exited') {
  return {
    tool,
    toolResultSeen: true,
    privacyPass: true,
    resultIsError: decision !== 'allow',
    report: {
      schemaVersion: 1,
      mode: 'action-exec',
      decision,
      reason,
      execution: {
        state: decision === 'allow' ? 'exited' : 'not-started',
        exitCode: decision === 'allow' ? 0 : null,
        outputComplete: true,
      },
      control: 'direct-child-only',
      descendantControl: 'unsupported',
    },
  };
}
function valid(name) {
  const item = {
    name,
    toolDiscovered: true,
    protocolError: false,
    privacyLeakDetected: false,
    timedOut: false,
    exceeded: false,
    stdoutPrivacyPass: true,
    cancelled: false,
    exitCode: 0,
    steps: [step('first'), step('second')],
    observations: [
      { firstBytes: 1, secondBytes: 0 },
      { firstBytes: 1, secondBytes: 1 },
    ],
    completedSteps: 2,
    requestedSteps: 2,
    firstBytes: 1,
    secondBytes: 1,
  };
  if (name === 'catalog-review') {
    Object.assign(item, {
      requestedSteps: 3,
      cancelled: true,
      exitCode: 1,
      treeCleanupConfirmed: true,
      brokerClosed: true,
      brokerCode: 0,
      endpointRemoved: true,
      ownerAbortRequired: false,
      negativeAnswerObserved: true,
      previewCount: 3,
      secondBytes: 0,
    });
    Object.assign(item.steps[0].report, {
      authorization: 'operator-confirmed',
      policyDecision: 'ask',
    });
    item.steps[1] = step('second', 'deny', 'confirmation-denied');
    item.steps.push({
      tool: 'second',
      toolDiscovered: true,
      toolResultSeen: false,
      privacyPass: false,
    });
    item.observations[1].secondBytes = 0;
  } else if (name !== 'two-allowed') {
    const decision = name === 'denied-second' ? 'deny' : 'ask';
    Object.assign(item, {
      steps: [step('second', decision, 'policy-' + decision)],
      completedSteps: 1,
      requestedSteps: 1,
      firstBytes: 0,
      secondBytes: 0,
      observations: [{ firstBytes: 0, secondBytes: 0 }],
    });
  }
  return item;
}
it.each(['two-allowed', 'denied-second', 'ask-second', 'catalog-review'])(
  'accepts strict actual observations for %s',
  (name) => {
    expect(catalogScenarioPassed(valid(name))).toBe(true);
  },
);
it.each([
  'toolDiscovered',
  'stdoutPrivacyPass',
  'brokerClosed',
  'endpointRemoved',
  'treeCleanupConfirmed',
  'negativeAnswerObserved',
  'cancelled',
])('rejects missing review proof %s', (field) => {
  const item = valid('catalog-review');
  item[field] = false;
  expect(catalogScenarioPassed(item)).toBe(false);
});
it.each(['timedOut', 'exceeded', 'protocolError', 'privacyLeakDetected', 'ownerAbortRequired'])(
  'rejects review failure %s',
  (field) => {
    const item = valid('catalog-review');
    item[field] = true;
    expect(catalogScenarioPassed(item)).toBe(false);
  },
);
it.each([
  (i) => {
    i.steps[0].report.authorization = undefined;
  },
  (i) => {
    i.steps[0].report.policyDecision = 'allow';
  },
  (i) => {
    i.steps[1].report.reason = 'confirmation-unavailable';
  },
  (i) => {
    i.steps.push(step('second'));
    i.completedSteps++;
  },
  (i) => {
    i.observations[0].secondBytes = 1;
  },
  (i) => {
    i.firstBytes = 2;
  },
  (i) => {
    i.secondBytes = 1;
  },
  (i) => {
    i.previewCount = 2;
  },
  (i) => {
    i.requestedSteps = 2;
  },
])('rejects weakened review sequence %#', (mutate) => {
  const item = valid('catalog-review');
  mutate(item);
  expect(catalogScenarioPassed(item)).toBe(false);
});
it('rejects reused first action and missing baseline isolation in direct checks', () => {
  const item = valid('two-allowed');
  item.steps[1].tool = 'first';
  expect(catalogScenarioPassed(item)).toBe(false);
  const denied = valid('denied-second');
  denied.firstBytes = 1;
  expect(catalogScenarioPassed(denied)).toBe(false);
});

it('rejects malformed observation records without throwing', () => {
  const item = valid('catalog-review');
  item.steps[0] = null;
  expect(catalogScenarioPassed(item)).toBe(false);
  const other = valid('two-allowed');
  other.observations[0] = null;
  expect(catalogScenarioPassed(other)).toBe(false);
});

it('accepts the actual planner shape with two completed reports and a third pending call', () => {
  const item = valid('catalog-review');
  const reports = item.steps.slice(0, 2).map((entry) => entry.report);
  configureCatalogScenario(item, ['first', 'second', 'second'], ['PRIVATE']);
  const input = {
    tools: ['first', 'second'].map((tool) => ({ name: 'mcp__aegis__aegis_action_' + tool })),
    messages: [],
  };
  for (let index = 0; index < 3; index++) {
    item.requests = index + 1;
    let reply;
    replyWithCatalogTools(
      {
        writeHead() {},
        end(text) {
          reply = JSON.parse(text);
        },
      },
      input,
      item,
    );
    const block = reply.content[0];
    expect(block.type).toBe('tool_use');
    if (index < 2)
      input.messages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: block.id,
            is_error: index === 1,
            content: JSON.stringify(reports[index]),
          },
        ],
      });
  }
  expect(item.steps).toHaveLength(3);
  expect(item.completedSteps).toBe(2);
  expect(catalogScenarioPassed(item)).toBe(true);
  item.brokerCode = 2;
  expect(catalogScenarioPassed(item)).toBe(true);
  item.brokerCode = 1;
  expect(catalogScenarioPassed(item)).toBe(false);
  item.brokerCode = 0;
  item.steps[2].report = step('second').report;
  expect(catalogScenarioPassed(item)).toBe(false);
});

it('transport reset returns status 2 only after pending review cleanup settles', async () => {
  const require = createRequire(import.meta.url);
  const transport = require('../../src/main/action-mcp-stdio');
  const peer = new PassThrough();
  let complete;
  const session = {
    receive: vi.fn(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    ),
    close: vi.fn(),
  };
  transport._setDepsForTest({ createSession: () => session });
  let settled = false;
  try {
    const done = transport
      .serveActionMcp({ input: peer, output: peer, catalogPath: 'owned-catalog' })
      .then((code) => {
        settled = true;
        return code;
      });
    peer.write('{"jsonrpc":"2.0","id":1,"method":"tools/call"}\n');
    peer.destroy(Object.assign(Error('synthetic transport reset'), { code: 'ECONNRESET' }));
    await new Promise(setImmediate);
    expect(session.close).toHaveBeenCalledOnce();
    expect(settled).toBe(false);
    complete(null);
    expect(await done).toBe(2);
  } finally {
    complete?.(null);
    peer.destroy();
    transport._resetForTest();
  }
});

it.each([false, true])(
  'writes bounded two-action files and records actual model results (leaked stdout=%s)',
  async (leak) => {
    const owned = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-provider-test-')));
    roots.push(owned);
    let scenario;
    let runs = 0;
    const receipt = { scenarios: [], rejectedProxyRequests: 0 };
    const configPath = path.join(owned, 'mcp.json');
    const run = async (argv, options) => {
      runs++;
      expect(options.timeoutMs).toBe(20000);
      expect(argv.slice(argv.indexOf('--tools'), argv.indexOf('--tools') + 2)).toEqual([
        '--tools',
        '',
      ]);
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8')).mcpServers.aegis;
      expect(config.args[1]).toBe('--action-mcp-catalog-stdio');
      const manifest = JSON.parse(fs.readFileSync(config.args[2], 'utf8'));
      expect(manifest.actions.map((a) => a.id)).toEqual(['first', 'second']);
      const input = {
        tools: manifest.actions.map((a) => ({ name: 'mcp__aegis__aegis_action_' + a.id })),
        messages: [],
      };
      for (let count = 0; count < 4; count++) {
        let reply;
        scenario.requests++;
        replyWithCatalogTools(
          {
            writeHead() {},
            end(text) {
              reply = JSON.parse(text);
            },
          },
          input,
          scenario,
        );
        const block = reply.content[0];
        if (block.type !== 'tool_use') break;
        const selected = manifest.actions.find((a) => block.name.endsWith('_' + a.id));
        const policy = JSON.parse(fs.readFileSync(selected.policyPath, 'utf8'));
        const request = JSON.parse(fs.readFileSync(selected.requestPath, 'utf8'));
        expect(policy.rules[0].action).toEqual(request.action);
        expect(request.action.args[1]).toContain('appendFileSync');
        const decision = policy.rules[0].decision;
        if (decision === 'allow')
          fs.appendFileSync(path.join(owned, 'PRIVATE_' + selected.id.toUpperCase()), 'x');
        input.messages.push({ role: 'assistant', content: [block] });
        input.messages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: block.id,
              is_error: decision !== 'allow',
              content: JSON.stringify(
                step(
                  selected.id,
                  decision,
                  decision === 'allow' ? 'child-exited' : 'policy-' + decision,
                ).report,
              ),
            },
          ],
        });
      }
      return {
        code: 0,
        stdout: leak ? owned : 'OK',
        timedOut: false,
        exceeded: false,
        cancelled: false,
      };
    };
    await verifyCatalogRoute({
      owned,
      repo: owned,
      env: {},
      run,
      receipt,
      action: { executable: process.execPath, cwd: owned, env: {} },
      configPath,
      setScenario(value) {
        scenario = value;
      },
      review: false,
    });
    expect(receipt.pass).toBe(!leak);
    expect(runs).toBe(leak ? 1 : 3);
    expect(JSON.stringify(receipt)).not.toContain(owned);
    expect(JSON.stringify(receipt)).not.toContain('PRIVATE_');
    expect(scenario).toBeNull();
  },
);
