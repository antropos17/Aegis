import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { createSelection } = require('../fixtures/policy-characterization/selection.cjs');
const mcp = require('../../src/main/action-mcp');
const execution = require('../../src/main/action-execution');
const terminal = require('../../src/main/action-confirmation-terminal');
let fixture;
const servers = [];
let spawn;
beforeEach(() => {
  fixture = createSelection();
  spawn = vi.fn(() => {
    throw Error('unexpected-launch');
  });
  execution._setDepsForTest({ spawn });
  vi.spyOn(terminal, 'isTerminalAvailable').mockReturnValue(true);
  vi.spyOn(terminal, 'watchTerminalLifetime').mockReturnValue(() => {});
  vi.spyOn(terminal, 'confirmInTerminal').mockResolvedValue(false);
});
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
  execution._resetForTest();
  vi.restoreAllMocks();
  fixture.cleanup();
});
async function callSelected(kind = 'execute') {
  const server = mcp.createActionMcp({
    policyPath: fixture.policyPath,
    requestPath: fixture.requestPath,
    kind,
  });
  servers.push(server);
  const initialized = await server.receive({
    jsonrpc: '2.0',
    id: 0,
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'fixture', version: '1' },
    },
  });
  expect(initialized).not.toHaveProperty('error');
  await server.receive({ jsonrpc: '2.0', method: 'notifications/initialized' });
  return server.receive({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: kind === 'execute' ? mcp.NAME : mcp.DELETE_NAME,
      arguments: {},
    },
  });
}
function expectWire(response, report) {
  expect(response).toEqual({
    jsonrpc: '2.0',
    id: 1,
    result: {
      content: [{ type: 'text', text: JSON.stringify(report) }],
      structuredContent: report,
      isError: true,
    },
  });
  expect(JSON.stringify(response)).not.toContain(fixture.root);
  expect(spawn).not.toHaveBeenCalled();
}

describe('policy characterization: selected MCP uses actual bound policy decisions', () => {
  it.each(['explicit-ask', 'default-ask', 'review-required', 'deny', 'invalid-policy'])(
    'preserves complete %s execution outcome without launching',
    async (kind) => {
      const rules =
        kind === 'default-ask'
          ? []
          : [{ action: fixture.action, decision: kind === 'deny' ? 'deny' : 'ask' }];
      let policy = {
        schemaVersion: 2,
        defaultDecision: kind === 'default-ask' ? 'ask' : 'deny',
        rules,
      };
      if (kind === 'review-required')
        policy = {
          ...policy,
          schemaVersion: 3,
          rules: [{ action: fixture.action, decision: 'allow' }],
          reviewRequired: [fixture.action],
        };
      if (kind === 'invalid-policy') policy = { ...policy, unknown: true };
      fixture.write(policy);
      const decision = ['deny', 'invalid-policy'].includes(kind) ? 'deny' : 'ask';
      expectWire(await callSelected(), {
        schemaVersion: 1,
        mode: 'action-exec',
        decision,
        reason: kind === 'review-required' ? 'review-required' : `policy-${decision}`,
        execution: {
          state: 'not-started',
          exitCode: null,
          termination: 'not-requested',
          stdoutBytes: 0,
          stderrBytes: 0,
          outputComplete: true,
        },
        control: 'direct-child-only',
        descendantControl: 'unsupported',
      });
    },
  );
});

describe('policy characterization: deletion does not inherit execution ask semantics', () => {
  it.each([
    'explicit-ask',
    'default-ask',
    'deny',
    'unmatched',
    'unknown-field',
    'execution-schema',
  ])('returns the complete %s deletion report before confirmation', async (kind) => {
    const target = path.join(fixture.root, 'keep.txt');
    fs.writeFileSync(target, 'fixture remains');
    const operation = { kind: 'delete-file', path: target };
    let policy = {
      schemaVersion: 1,
      defaultDecision: 'deny',
      rules: [{ operation, decision: 'deny' }],
    };
    if (kind === 'explicit-ask') policy.rules[0].decision = 'ask';
    if (kind === 'default-ask') policy.defaultDecision = 'ask';
    if (kind === 'unmatched')
      policy.rules = [
        {
          operation: { ...operation, path: path.join(fixture.root, 'other.txt') },
          decision: 'allow',
        },
      ];
    if (kind === 'unknown-field') policy = { ...policy, reviewRequired: [operation] };
    if (kind === 'execution-schema')
      policy = {
        schemaVersion: 2,
        defaultDecision: 'deny',
        rules: [{ action: fixture.action, decision: 'allow' }],
      };
    fixture.write(policy, { schemaVersion: 1, operation });
    expectWire(await callSelected('delete-file'), {
      schemaVersion: 1,
      mode: 'action-delete-file',
      decision: 'deny',
      reason: ['deny', 'unmatched'].includes(kind) ? 'policy-deny' : 'policy-invalid',
      operation: { state: 'not-started' },
      control: 'selected-file-only',
      outsideRouteCoverage: 'unknown',
    });
    expect(terminal.confirmInTerminal).not.toHaveBeenCalled();
    expect(fs.readFileSync(target, 'utf8')).toBe('fixture remains');
  });
});
