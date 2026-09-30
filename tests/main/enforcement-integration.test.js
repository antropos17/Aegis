import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import {
  createWorkflowFixture,
  SCOPE,
  TOOLS,
  SECRET,
} from '../../scripts/qualification/mcp-workflow-fixture.mjs';
import { cleanup } from '../../scripts/qualification/enforcement-evidence-fixtures.mjs';

const require = createRequire(import.meta.url);
const { createMcpGateway } = require('../../src/main/mcp-gateway');
const { captureGatewayRoute } = require('../../src/main/mcp-gateway-route');
const { initializeGatewayCredentialKey } = require('../../src/main/mcp-gateway-grants');
const rpc = (id, method, params) => ({
  jsonrpc: '2.0',
  ...(id === undefined ? {} : { id }),
  method,
  params,
});
const save = (file, value) =>
  fs.writeFile(file, JSON.stringify(value), { flag: 'wx', mode: 0o600 });

it.each(['allow', 'secret-request', 'secret-response'])(
  'correlates the merged workflow receiver, shared secret guard and durable gateway evidence: %s',
  async (mode) => {
    const parent = await fs.realpath(os.tmpdir());
    const root = await fs.mkdtemp(path.join(parent, 'aegis-evidence-'));
    const gateways = [];
    let receiver;
    try {
      receiver = await createWorkflowFixture(root);
      if (mode === 'secret-response') receiver.control.mode = 'secret-response';
      const endpointPath = path.join(root, 'endpoint.json');
      const manifestPath = path.join(root, 'manifest.json');
      const secretPolicyPath = path.join(root, 'secrets.json');
      const grantStorePath = path.join(root, 'grants');
      await fs.mkdir(grantStorePath);
      await save(endpointPath, {
        schemaVersion: 1,
        url: receiver.url,
        bearerToken: receiver.token,
      });
      const key = await initializeGatewayCredentialKey(grantStorePath);
      const controller = new AbortController();
      let route, credentialTag;
      try {
        route = await captureGatewayRoute({ endpointPath }, controller.signal);
        credentialTag = route.credentialTag(key);
      } finally {
        key.fill(0);
        route?.close();
        controller.abort();
      }
      const args = { ...SCOPE, payload: mode === 'secret-request' ? SECRET : SCOPE.payload };
      const grantId = 'g'.repeat(32);
      const receiptPath = path.join(
        grantStorePath,
        createHash('sha256').update(grantId).digest('hex') + '.used',
      );
      await save(manifestPath, {
        schemaVersion: 4,
        route: { transport: 'http', url: receiver.url },
        credentialTag,
        tools: TOOLS,
        grants: [
          {
            id: grantId,
            taskId: 't'.repeat(32),
            notBefore: Date.now() - 1000,
            expiresAt: Date.now() + 60000,
            tool: TOOLS[0].name,
            arguments: args,
          },
        ],
      });
      await save(secretPolicyPath, { schemaVersion: 1, values: [SECRET] });
      const events = [],
        consumedRecords = [],
        effectEvents = [];
      receiver.control.onEffect = () => effectEvents.push(events.map((event) => event.code));
      const open = async () => {
        const gateway = createMcpGateway({
          endpointPath,
          manifestPath,
          secretPolicyPath,
          grantStorePath,
          onFailure() {},
          onEvidence(event) {
            events.push(event);
            if (event.code === 'consumed') consumedRecords.push(readFileSync(receiptPath, 'utf8'));
          },
        });
        gateways.push(gateway);
        const initialized = await gateway.receive(
          rpc(1, 'initialize', {
            protocolVersion: '2025-11-25',
            capabilities: {},
            clientInfo: { name: 'dummy', version: '1' },
          }),
        );
        expect(initialized?.result).toBeDefined();
        await gateway.receive(rpc(undefined, 'notifications/initialized', {}));
        return gateway;
      };
      const gateway = await open();
      const call = (id) => rpc(id, 'tools/call', { name: TOOLS[0].name, arguments: args });
      const response = await gateway.receive(call(2));
      const expectedCodes =
        mode === 'allow'
          ? ['consumed', 'dispatch', 'completed']
          : mode === 'secret-request'
            ? ['consumed', 'failed']
            : ['consumed', 'dispatch', 'failed'];
      expect(events.map((event) => event.code)).toEqual(expectedCodes);
      expect(events.map((event) => event.seq)).toEqual(expectedCodes.map((_, index) => index));
      expect(new Set(events.map((event) => event.operationId)).size).toBe(1);
      expect(events[0].operationId).toMatch(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
      expect(events.every(Object.isFrozen)).toBe(true);
      expect(consumedRecords).toEqual(['{"consumed":true}\n']);
      expect(await gateway.finishEvidence()).toMatchObject({ lost: 0, pending: 0 });
      const expectedEffects = mode === 'secret-request' ? 0 : 1;
      expect(effectEvents).toEqual(expectedEffects ? [['consumed', 'dispatch']] : []);
      const beforeReplay = await receiver.observe();
      expect(beforeReplay).toMatchObject({
        deliveries: expectedEffects,
        effects: expectedEffects,
        forbidden: 0,
        errors: 0,
        forbiddenBytes: null,
        approved: expectedEffects ? Buffer.from(SCOPE.payload) : null,
      });
      if (mode === 'allow') expect(response?.result?.structuredContent.accepted).toBe(true);
      else {
        expect(response).toMatchObject({ error: { message: 'gateway-call-failed' } });
        expect(response).not.toHaveProperty('result');
        expect(events.map((event) => event.code)).not.toContain('completed');
      }
      const exposed = JSON.stringify({ response, events });
      for (const privateValue of [
        SECRET,
        Buffer.from(SECRET).toString('base64'),
        Buffer.from(SECRET).toString('hex'),
        receiver.token,
        receiver.url,
      ])
        expect(exposed).not.toContain(privateValue);
      expect((await gateway.receive(call(3)))?.result).toBeUndefined();
      gateway.close();
      await gateway.finish();
      const reopened = await open();
      expect(await reopened.receive(call(2))).toMatchObject({
        error: { message: 'gateway-call-failed' },
      });
      expect(await reopened.finishEvidence()).toMatchObject({ lost: 0, pending: 0 });
      expect(events.slice(expectedCodes.length).map((event) => event.code)).toEqual(['failed']);
      expect((await receiver.observe()).effects).toBe(expectedEffects);
      expect((await receiver.observe()).deliveries).toBe(expectedEffects);
      expect(await fs.readFile(receiptPath, 'utf8')).toBe('{"consumed":true}\n');
      expect(consumedRecords).toHaveLength(1);
    } finally {
      for (const gateway of gateways) {
        gateway.close();
        await gateway.finish();
      }
      await receiver?.close();
      await cleanup(root, parent);
    }
  },
  15000,
);
