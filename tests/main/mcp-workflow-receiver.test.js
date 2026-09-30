import { afterEach, beforeEach, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  createWorkflowFixture,
  SCOPE,
  TOOLS,
  SECRET,
} from '../../scripts/qualification/mcp-workflow-fixture.mjs';
import { summarizeMcpWorkflow } from '../../scripts/qualification/mcp-workflow-report.mjs';

const require = createRequire(import.meta.url);
const { exchange } = require('../../src/main/mcp-gateway-http-wire');
const { parseHttpEndpoint } = require('../../src/main/mcp-gateway-route');
const { validResult } = require('../../src/main/mcp-gateway-schema');
let root, fixture;
beforeEach(async () => {
  const parent = await fs.realpath(os.tmpdir());
  root = await fs.mkdtemp(path.join(parent, 'aegis-mcp-receiver-'));
  fixture = await createWorkflowFixture(root);
});
afterEach(async () => {
  await fixture.close();
  if (
    !path.basename(root).startsWith('aegis-mcp-receiver-') ||
    (await fs.lstat(root)).isSymbolicLink()
  )
    throw Error('fixture-cleanup-unsafe');
  await fs.rm(root, { recursive: true, force: true });
});

async function bypass(args, token = fixture.token, tool = TOOLS[0].name) {
  const endpoint = parseHttpEndpoint({ schemaVersion: 1, url: fixture.url, bearerToken: token });
  const response = await exchange(endpoint, {
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: tool, arguments: args },
    }),
  });
  expect(response.status).toBe(200);
  const result = JSON.parse(response.body.toString('utf8')).result;
  response.body.fill(0);
  return result;
}
const report = async (mode) =>
  summarizeMcpWorkflow(mode, {
    observed: await fixture.observe(),
    returnedResult: true,
    alternateRequests: 0,
    replayRefused: null,
    durableConsumed: false,
  });

it.each(Object.keys(SCOPE))(
  'detects an actual %s effect when the gateway is bypassed',
  async (key) => {
    await bypass({ ...SCOPE, [key]: `other-${key}` });
    const result = await report(`${key}-substitution`);
    expect(result).toMatchObject({
      passed: false,
      deliveries: 1,
      effects: 1,
      forbiddenDeliveries: 1,
      forbiddenBytesAbsent: false,
    });
  },
);

it('detects a changed credential mapped to another dummy account', async () => {
  await bypass({ ...SCOPE }, fixture.replacementToken);
  expect(await report('credential-reconnect')).toMatchObject({
    passed: false,
    deliveries: 1,
    effects: 1,
    forbiddenDeliveries: 1,
    forbiddenBytesAbsent: false,
  });
});

it('detects delivery to a substituted tool even when that tool has a valid dummy schema', async () => {
  await bypass({ ...SCOPE }, fixture.token, TOOLS[1].name);
  expect(await report('tool-substitution')).toMatchObject({
    passed: false,
    deliveries: 1,
    effects: 1,
  });
});

it('detects an actual request reaching a forbidden route receiver', async () => {
  await bypass({ ...SCOPE });
  const observed = await fixture.observe();
  const result = summarizeMcpWorkflow('route-reconnect', {
    observed: { ...observed, deliveries: 0, effects: 0, approved: null },
    returnedResult: false,
    alternateRequests: observed.requests,
    replayRefused: null,
    durableConsumed: false,
  });
  expect(result.passed).toBe(false);
  expect(result.alternateRequests).toBe(1);
});

it('checks actual bytes independently of the receiver success response and counters', async () => {
  await bypass({ ...SCOPE });
  await fs.writeFile(path.join(root, 'approved.bin'), Buffer.from('changed bytes'));
  const result = summarizeMcpWorkflow('allow-filesystem', {
    observed: await fixture.observe(),
    returnedResult: true,
    alternateRequests: 0,
    replayRefused: null,
    durableConsumed: true,
  });
  expect(result).toMatchObject({
    passed: false,
    deliveries: 1,
    effects: 1,
    approvedBytesMatch: false,
  });
});

it('supplies a schema-valid secret response so refusal tests reach the known-secret guard', async () => {
  fixture.control.mode = 'secret-response';
  const result = await bypass({ ...SCOPE });
  expect(validResult(TOOLS[0], result)).toBe(true);
  expect(result.structuredContent.note).toBe(SECRET);
});

it('bounds disposable byte writes even when an overlong payload bypasses gateway validation', async () => {
  const endpoint = parseHttpEndpoint({
    schemaVersion: 1,
    url: fixture.url,
    bearerToken: fixture.token,
  });
  const response = await exchange(endpoint, {
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: TOOLS[0].name, arguments: { ...SCOPE, payload: 'x'.repeat(129) } },
    }),
  });
  expect(response.status).toBe(500);
  response.body.fill(0);
  const observed = await fixture.observe();
  expect(observed).toMatchObject({
    deliveries: 1,
    effects: 0,
    forbidden: 1,
    errors: 1,
    approved: null,
    forbiddenBytes: null,
  });
});
