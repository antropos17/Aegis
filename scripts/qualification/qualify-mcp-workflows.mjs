import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createWorkflowFixture, SCOPE, TOOLS, SECRET } from './mcp-workflow-fixture.mjs';
import { summarizeMcpWorkflow } from './mcp-workflow-report.mjs';

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
const save = (filename, value) => fs.writeFile(filename, JSON.stringify(value), { mode: 0o600 });
export const MODES = Object.freeze([
  'allow-filesystem',
  'allow-api',
  'account-substitution',
  'repository-substitution',
  'recipient-substitution',
  'operation-substitution',
  'payload-substitution',
  'tool-substitution',
  'credential-change',
  'credential-reconnect',
  'credential-key-change',
  'route-change',
  'route-reconnect',
  'catalog-change',
  'manifest-change',
  'redirect',
  'replay',
  'reconnect',
  'cancel-before-dispatch',
  'cancel-after-dispatch',
  'lost-response',
  'known-secret-request',
  'known-secret-response',
]);
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const wait = async (promise) => {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('workflow-deadline')), 2000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

async function removeCorpus(root, parent) {
  if (path.dirname(root) !== parent || !path.basename(root).startsWith('aegis-mcp-workflow-'))
    throw Error('workflow-cleanup-unsafe');
  const queue = [root];
  let entries = 0;
  while (queue.length) {
    const directory = queue.pop();
    if ((await fs.lstat(directory)).isSymbolicLink()) throw Error('workflow-cleanup-unsafe');
    for (const name of await fs.readdir(directory)) {
      if (++entries > 32) throw Error('workflow-cleanup-unsafe');
      const file = path.join(directory, name),
        stat = await fs.lstat(file);
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile()))
        throw Error('workflow-cleanup-unsafe');
      if (stat.isDirectory()) queue.push(file);
    }
  }
  await fs.rm(root, { recursive: true, force: true });
}

/** Exercise the actual durable gateway with only generated local dummy effects.
 * @param {string} mode One fixed qualification scenario.
 * @returns {Promise<object>} Secret-free independent developer evidence. @since v0.17.0 */
export async function collectMcpWorkflowQualification(mode) {
  if (!MODES.includes(mode)) throw Error('workflow-mode-invalid');
  const parent = await fs.realpath(os.tmpdir());
  const root = await fs.mkdtemp(path.join(parent, 'aegis-mcp-workflow-'));
  const gateways = [];
  let fixture, alternate;
  const release = deferred();
  try {
    fixture = await createWorkflowFixture(root);
    const endpointPath = path.join(root, 'endpoint.json'),
      manifestPath = path.join(root, 'manifest.json');
    const grantStorePath = path.join(root, 'grants');
    await fs.mkdir(grantStorePath);
    await save(endpointPath, { schemaVersion: 1, url: fixture.url, bearerToken: fixture.token });
    const key = await initializeGatewayCredentialKey(grantStorePath);
    const controller = new AbortController();
    const route = await captureGatewayRoute({ endpointPath }, controller.signal);
    const credentialTag = route.credentialTag(key);
    key.fill(0);
    route.close();
    controller.abort();
    const args = { ...SCOPE };
    for (const key of Object.keys(SCOPE))
      if (mode === `${key}-substitution`) args[key] = `other-${key}`;
    if (mode === 'known-secret-request') args.payload = SECRET;
    const tool = mode === 'allow-api' ? TOOLS[1].name : TOOLS[0].name;
    const manifest = {
      schemaVersion: 4,
      route: { transport: 'http', url: fixture.url },
      credentialTag,
      tools: TOOLS,
      grants: [
        {
          id: 'g'.repeat(32),
          taskId: 't'.repeat(32),
          notBefore: Date.now() - 1000,
          expiresAt: Date.now() + 60000,
          tool,
          arguments: mode === 'known-secret-request' ? args : { ...SCOPE },
        },
      ],
    };
    await save(manifestPath, manifest);
    const secretPolicyPath = path.join(root, 'secret-policy.json');
    await save(secretPolicyPath, { schemaVersion: 1, values: [SECRET] });
    const open = async () => {
      const gateway = createMcpGateway({
        endpointPath,
        manifestPath,
        grantStorePath,
        secretPolicyPath,
        onFailure() {},
      });
      gateways.push(gateway);
      const initialized = await gateway.receive(
        rpc(1, 'initialize', {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'dummy', version: '1' },
        }),
      );
      if (initialized?.result)
        await gateway.receive(rpc(undefined, 'notifications/initialized', {}));
      return { gateway, ready: !!initialized?.result };
    };
    if (['route-change', 'route-reconnect', 'redirect'].includes(mode)) {
      const extra = path.join(root, 'alternate');
      await fs.mkdir(extra);
      alternate = await createWorkflowFixture(extra);
    }
    let { gateway, ready } = await open();
    if (!ready) throw Error('workflow-initialize-mismatch');
    if (['credential-reconnect', 'route-reconnect'].includes(mode)) {
      gateway.close();
      await gateway.finish();
      await save(endpointPath, {
        schemaVersion: 1,
        url: mode === 'route-reconnect' ? alternate.url : fixture.url,
        bearerToken: mode === 'route-reconnect' ? alternate.token : fixture.replacementToken,
      });
      ({ gateway, ready } = await open());
      if (ready) throw Error('workflow-initialize-mismatch');
    }
    if (mode === 'credential-change')
      await save(endpointPath, {
        schemaVersion: 1,
        url: fixture.url,
        bearerToken: fixture.replacementToken,
      });
    if (mode === 'credential-key-change')
      await fs.writeFile(path.join(grantStorePath, '.credential-key'), Buffer.alloc(32, 7));
    if (mode === 'route-change')
      await save(endpointPath, {
        schemaVersion: 1,
        url: alternate.url,
        bearerToken: alternate.token,
      });
    if (mode === 'catalog-change') fixture.control.mode = 'catalog-change';
    if (mode === 'manifest-change') await fs.appendFile(manifestPath, ' ');
    if (mode === 'redirect') {
      fixture.control.mode = 'redirect';
      fixture.control.redirect = alternate.url;
    }
    if (mode === 'lost-response') fixture.control.mode = 'lost-response';
    if (mode === 'known-secret-response') fixture.control.mode = 'secret-response';
    const arrived = deferred();
    if (mode === 'cancel-before-dispatch')
      fixture.control.onList = async (count) => {
        if (count === 2) {
          arrived.resolve();
          await release.promise;
        }
      };
    if (mode === 'cancel-after-dispatch') {
      fixture.control.mode = 'hang-call';
      fixture.control.onEffect = () => arrived.resolve();
    }
    const call = (id = 2) =>
      rpc(id, 'tools/call', {
        name: mode === 'tool-substitution' ? TOOLS[1].name : tool,
        arguments: args,
      });
    const pending = gateway.receive(call());
    if (mode.startsWith('cancel-')) {
      await wait(arrived.promise);
      await gateway.receive(rpc(undefined, 'notifications/cancelled', { requestId: 2 }));
      release.resolve();
    }
    const response = await pending;
    let replayRefused = null;
    if (mode === 'replay') replayRefused = !(await gateway.receive(call(3)))?.result;
    if (
      ['reconnect', 'lost-response', 'cancel-after-dispatch', 'known-secret-response'].includes(
        mode,
      )
    ) {
      gateway.close();
      await gateway.finish();
      const next = await open();
      if (!next.ready) throw Error('workflow-reconnect-failed');
      replayRefused = !(await next.gateway.receive(call()))?.result;
    }
    const observed = await fixture.observe();
    const alternateRequests = alternate ? (await alternate.observe()).requests : 0;
    const grantReceipts = (await fs.readdir(grantStorePath)).filter((name) =>
      name.endsWith('.used'),
    );
    const durableConsumed =
      grantReceipts.length === 1 &&
      (await fs.readFile(path.join(grantStorePath, grantReceipts[0]), 'utf8')) ===
        '{"consumed":true}\n';
    return summarizeMcpWorkflow(mode, {
      observed,
      returnedResult: !!response?.result,
      alternateRequests,
      replayRefused,
      durableConsumed,
    });
  } finally {
    release.resolve();
    for (const gateway of gateways) {
      gateway.close();
      await gateway.finish();
    }
    await fixture?.close();
    await alternate?.close();
    await removeCorpus(root, parent);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3) throw Error('workflow-mode-required');
    let report;
    if (process.argv[2] === 'all') {
      const scenarios = [];
      for (const mode of MODES) scenarios.push(await collectMcpWorkflowQualification(mode));
      report = { schemaVersion: 1, developerOnly: true, launchAllowed: false, scenarios };
    } else report = await collectMcpWorkflowQualification(process.argv[2]);
    process.stdout.write(JSON.stringify(report) + '\n');
    if (report.scenarios ? report.scenarios.some((scenario) => !scenario.passed) : !report.passed)
      process.exitCode = 1;
  } catch {
    process.stderr.write('mcp-workflow-qualification-unavailable\n');
    process.exitCode = 1;
  }
}
