import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createEvidenceReceiver, tool } from './enforcement-evidence-receiver.mjs';
const require = createRequire(import.meta.url);
const { evaluateActionPolicy } = require('../../src/main/action-policy');
const { createMcpGateway } = require('../../src/main/mcp-gateway');
const { captureGatewayRoute } = require('../../src/main/mcp-gateway-route');
const { initializeGatewayCredentialKey } = require('../../src/main/mcp-gateway-grants');
const evidence = require('../../src/main/enforcement-evidence');
const rpc = (id, method, params) => ({
  jsonrpc: '2.0',
  ...(id === undefined ? {} : { id }),
  method,
  params,
});
const save = (p, value) => fs.writeFile(p, JSON.stringify(value), { flag: 'wx' });
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
/** Remove only bounded entries under one exact generated root.
 * @param {string} root Generated directory. @param {string} parent Canonical task temp.
 * @returns {Promise<void>} Closed fixture cleanup. @since v0.17.0 */
export async function cleanup(root, parent) {
  if (path.dirname(root) !== parent || !path.basename(root).startsWith('aegis-evidence-'))
    throw Error('cleanup-boundary');
  let count = 0;
  async function visit(dir, depth) {
    if (depth > 3 || (await fs.lstat(dir)).isSymbolicLink()) throw Error('cleanup-boundary');
    for (const row of await fs.readdir(dir, { withFileTypes: true })) {
      if (++count > 64 || row.isSymbolicLink()) throw Error('cleanup-boundary');
      const p = path.join(dir, row.name);
      if (row.isDirectory()) await visit(p, depth + 1);
      else if (row.isFile()) await fs.unlink(p);
      else throw Error('cleanup-boundary');
    }
    await fs.rmdir(dir);
  }
  await visit(root, 0);
}
/** Execute one fixed disposable audit child with bounded input/output/time.
 * @param {string} root Generated directory. @param {object[]} records Owner events.
 * @param {string} mode Fixed audit mode. @returns {Promise<object>} Child result. @since v0.17.0 */
export async function auditChild(root, records, mode) {
  const script = fileURLToPath(new URL('./enforcement-evidence-audit.mjs', import.meta.url));
  const child = spawn(process.execPath, [script], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let bytes = 0,
    output = '';
  const errors = [];
  const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
  try {
    return await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.stdout.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > 131072) child.kill('SIGKILL');
        else output += chunk.toString('utf8');
      });
      child.stderr.on('data', (chunk) => {
        if (errors.length < 4) errors.push(chunk.length);
      });
      child.once('close', (code) => {
        try {
          const value = JSON.parse(output);
          if (code !== 0 || value.error || bytes > 131072) throw Error('audit-child-unavailable');
          resolve(value);
        } catch {
          reject(Error('audit-child-unavailable'));
        }
      });
      child.stdin.on('error', () => {});
      child.stdin.end(JSON.stringify({ root, records, mode }));
    });
  } finally {
    clearTimeout(timer);
  }
}
/** Exercise existing policy evaluation, v4 gateway, durable receipt and independent receiver.
 * @param {string} mode Fixed generated scenario. @returns {Promise<object>} Owned local records. @since v0.17.0 */
export async function gatewayScenario(mode) {
  if (
    ![
      'normal',
      'deny',
      'ask',
      'consume-failed',
      'lost-response',
      'observer-throw',
      'observer-reject',
      'observer-pending',
    ].includes(mode)
  )
    throw Error('fixture-mode');
  const parent = await fs.realpath(os.tmpdir()),
    root = await fs.mkdtemp(path.join(parent, 'aegis-evidence-'));
  let receiver, gateway, route;
  const records = [];
  let operationId;
  const grantId = randomUUID(),
    sessionId = randomUUID();
  try {
    const input = {
      hook_event_name: 'PreToolUse',
      session_id: sessionId,
      tool_use_id: grantId,
      tool_name: 'Bash',
      cwd: root,
      tool_input: { command: 'AEGIS_DUMMY_LABEL_NEVER_EXECUTED' },
    };
    const decision = ['deny', 'ask'].includes(mode) ? mode : 'allow';
    const policy = {
      schemaVersion: 1,
      cwd: root,
      defaultDecision: 'deny',
      rules: [{ tool: 'Bash', input: input.tool_input, decision }],
    };
    const policyPath = path.join(root, 'policy.json');
    await save(policyPath, policy);
    const evaluated = await evaluateActionPolicy(policyPath, Buffer.from(JSON.stringify(input)));
    const context = {
      sessionId,
      epoch: 1,
      policyRevision: 1,
      sourceDigest: sha(
        await fs.readFile(fileURLToPath(new URL('../../src/main/mcp-gateway.js', import.meta.url))),
      ),
      corpusDigest: sha(Buffer.from(JSON.stringify({ sessionId, grantId, mode }))),
    };
    if (evaluated.decision !== 'allow')
      return {
        mode,
        passed: evaluated.decision === mode,
        policyDecision: evaluated.decision,
        grants: 0,
        receiverCalls: 0,
        launchAllowed: false,
      };
    const grants = path.join(root, 'grants');
    await fs.mkdir(grants);
    receiver = await createEvidenceReceiver(root, grantId, () => operationId, mode);
    const endpointPath = path.join(root, 'endpoint.json'),
      manifestPath = path.join(root, 'manifest.json');
    await save(endpointPath, receiver.endpoint);
    const key = await initializeGatewayCredentialKey(grants),
      signal = new AbortController();
    try {
      route = await captureGatewayRoute({ endpointPath }, signal.signal);
      await save(manifestPath, {
        schemaVersion: 4,
        route: route.identity,
        credentialTag: route.credentialTag(key),
        tools: [tool],
        grants: [
          {
            id: grantId,
            taskId: sessionId,
            notBefore: Date.now() - 1000,
            expiresAt: Date.now() + 60000,
            tool: 'record',
            arguments: { recipient: 'dummy' },
          },
        ],
      });
    } finally {
      key.fill(0);
      route?.close();
    }
    gateway = createMcpGateway({
      endpointPath,
      manifestPath,
      grantStorePath: grants,
      onFailure() {},
      onEvidence(event) {
        records.push(Object.freeze({ ...event }));
        operationId = event.operationId;
        if (mode === 'observer-throw') throw Error('fixture-observer');
        if (mode === 'observer-reject') return Promise.reject(Error('fixture-observer'));
        if (mode === 'observer-pending') return new Promise(() => {});
      },
    });
    const initialized = await gateway.receive(
      rpc(1, 'initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'fixture', version: '1' },
      }),
    );
    if (!initialized?.result) throw Error('fixture-initialize');
    await gateway.receive(rpc(undefined, 'notifications/initialized', {}));
    if (mode === 'consume-failed')
      await fs.writeFile(path.join(grants, sha(Buffer.from(grantId)) + '.used'), 'collision', {
        flag: 'wx',
      });
    const result = await gateway.receive(
      rpc(2, 'tools/call', { name: 'record', arguments: { recipient: 'dummy' } }),
    );
    const replay = await gateway.receive(
      rpc(3, 'tools/call', { name: 'record', arguments: { recipient: 'dummy' } }),
    );
    const observer = await gateway.finishEvidence();
    const value = {
      schemaVersion: 1,
      context,
      records,
      receivers: [...receiver.observations],
      claims: { complete: true, lossCount: 0 },
    };
    const bytes = evidence.encodeEnforcementEvidence(value),
      delivery = {
        observerLoss: observer.lost,
        auditLoss: 0,
        pending: observer.pending,
        terminalKnown: true,
      };
    const anchor = evidence.createEnforcementEvidenceAnchor(bytes, delivery),
      assessed = evidence.assessEnforcementEvidence(bytes, anchor);
    const expectedFailure = mode === 'lost-response';
    const passed =
      mode === 'consume-failed'
        ? receiver.count() === 0 &&
          !!result.error &&
          records.length === 1 &&
          records[0].code === 'failed'
        : receiver.count() === 1 &&
          receiver.observations[0]?.consumedRecord === 'exact' &&
          (!replay || !!replay.error) &&
          (expectedFailure
            ? !!result.error && !records.some((e) => e.code === 'completed')
            : !!result.result) &&
          (mode.startsWith('observer-')
            ? observer.lost > 0 && assessed.completeness === 'incomplete'
            : assessed.completeness === 'complete');
    return {
      mode,
      passed,
      policyDecision: evaluated.decision,
      receiverCalls: receiver.count(),
      observer,
      records,
      value,
      assessed,
      launchAllowed: false,
    };
  } finally {
    gateway?.close();
    if (gateway) await gateway.finish();
    await receiver?.close();
    await cleanup(root, parent);
  }
}
