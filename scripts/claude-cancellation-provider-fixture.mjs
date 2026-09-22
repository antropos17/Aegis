/** TEST ONLY: installed Claude interrupt -> production MCP -> held child exit evidence. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import generator from '../src/main/action-mcp-config.js';
import client from '../src/main/action-observation-client.js';
import { frame, cancellationPassed } from './claude-cancellation-evidence.mjs';
import { emitSyntheticToolReply } from './claude-action-mcp-fixture.mjs';
const privateState = new WeakMap();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const bytes = (file) => (fs.existsSync(file) ? fs.statSync(file).size : 0);
async function until(check, ms = 2500) {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    if (check()) return;
    await pause(25);
  }
  if (!check()) throw Error('checkpoint');
}
/** Serve a fixed model tool call only after observing an idle production route.
 * @param {object} res HTTP response. @param {object} input Synthetic model request.
 * @param {object} scenario Redacted evidence. @returns {Promise<void>} Bounded reply.
 * @since v0.15.1 */
export async function replyWithCancellationTool(res, input, scenario) {
  const state = privateState.get(scenario);
  try {
    if (!state || scenario.requests > 3) throw Error('scenario');
    if (scenario.requests === 1) {
      await until(() => {
        state.observer ||= fs.existsSync(state.endpoint)
          ? client.observeActionRoute(state.endpoint)
          : null;
        const value = state.observer?.snapshot();
        return value?.state === 'observed' && frame(value, scenario.catalog, 0, 0, 0);
      });
      scenario.before = state.observer.snapshot();
      scenario.toolDiscovered =
        Array.isArray(input.tools) && input.tools.some((t) => t.name === state.tool);
      if (!scenario.toolDiscovered) throw Error('tool');
      emitSyntheticToolReply(res, input, {
        type: 'tool_use',
        id: 'toolu_cancel_fixture',
        name: state.tool,
        input: {},
      });
    } else emitSyntheticToolReply(res, input, { type: 'text', text: 'OK' });
  } catch {
    scenario.failure = 'model-checkpoint-failed';
    res.writeHead(503);
    res.end();
  }
}

/** Exercise an installed provider without production profiles, credentials or cloud model calls.
 * @param {object} context Existing isolated verifier context.
 * @returns {Promise<void>} Appends fixed evidence, preserving all failure cases.
 * @since v0.15.1 */
export async function verifyCancellationRoute(context) {
  const { owned, env, receipt, action, run, configPath, setScenario } = context;
  const catalog = context.catalog === true;
  const endpoint = path.join(owned, 'PRIVATE_CANCEL_ENDPOINT.json');
  const witnessFile = path.join(owned, 'PRIVATE_CANCEL_WITNESS.json');
  const markers = ['PRIVATE_CANCEL_UNUSED', 'PRIVATE_CANCEL_PROGRESS'].map((p) =>
    path.join(owned, p),
  );
  const entries = markers.map((marker, i) => {
    const selectedAction = {
      ...action,
      args: [
        '-e',
        `const fs=require('node:fs');const p=${JSON.stringify(marker)};fs.writeFileSync(p,'x');setInterval(()=>fs.appendFileSync(p,'x'),50);setTimeout(()=>process.exit(0),8000);`,
      ],
    };
    const policyPath = path.join(owned, `cancel-${i}-policy.json`);
    const requestPath = path.join(owned, `cancel-${i}-request.json`);
    fs.writeFileSync(
      policyPath,
      JSON.stringify({
        schemaVersion: 2,
        defaultDecision: 'deny',
        rules: [{ action: selectedAction, decision: 'allow' }],
      }),
    );
    fs.writeFileSync(requestPath, JSON.stringify({ schemaVersion: 1, action: selectedAction }));
    return { id: i ? 'second' : 'first', policyPath, requestPath };
  });
  const manifest = path.join(owned, 'cancel-catalog.json');
  fs.writeFileSync(manifest, JSON.stringify({ schemaVersion: 1, actions: entries }));
  const config = generator.buildActionMcpConfig(
    catalog ? 'catalog' : 'selected',
    catalog ? [manifest] : [entries[1].policyPath, entries[1].requestPath],
    endpoint,
  );
  // Witness forwards the existing spawn seam unchanged and records only fixed result booleans.
  config.mcpServers.aegis.args.unshift(
    '--require',
    fileURLToPath(new URL('./claude-cancellation-witness.cjs', import.meta.url)),
  );
  config.mcpServers.aegis.env = { ...env, AEGIS_CANCELLATION_WITNESS: witnessFile };
  fs.writeFileSync(configPath, JSON.stringify(config));
  const tool = catalog ? 'mcp__aegis__aegis_action_second' : 'mcp__aegis__aegis_execute_selected';
  const e = {
    catalog,
    requests: 0,
    failure: null,
    providerIdentity: 'unverified',
    interruptSent: false,
    interruptAcknowledged: false,
    progressObserved: false,
    progressStopped: false,
    before: null,
    pending: null,
    after: null,
    lost: null,
    witness: null,
    endpointRemoved: false,
    stickyLoss: false,
  };
  const state = { endpoint, tool, observer: null };
  privateState.set(e, state);
  setScenario(e);
  let result;
  try {
    result = await run(
      [
        '-p',
        '--input-format',
        'stream-json',
        '--output-format',
        'stream-json',
        '--verbose',
        '--setting-sources',
        '',
        '--strict-mcp-config',
        '--mcp-config',
        configPath,
        '--no-chrome',
        '--no-session-persistence',
        '--permission-mode',
        'dontAsk',
        '--tools',
        '',
        '--allowedTools',
        tool,
        '--model',
        'claude-sonnet-4-6',
      ],
      {
        timeoutMs: 30000,
        async interact(child) {
          let buffer = '',
            initialized = false,
            closed = false;
          child.once('close', () => {
            closed = true;
          });
          const receive = (chunk) => {
            buffer += chunk.toString();
            if (Buffer.byteLength(buffer) > 32768) {
              e.failure = 'stream-limit';
              child.stdin.end();
              return;
            }
            while (buffer.includes('\n')) {
              const at = buffer.indexOf('\n');
              const line = buffer.slice(0, at);
              buffer = buffer.slice(at + 1);
              try {
                const m = JSON.parse(line);
                if (m.type === 'control_response' && m.response?.subtype === 'success') {
                  if (m.response.request_id === 'fixture-init') initialized = true;
                  if (m.response.request_id === 'fixture-interrupt') e.interruptAcknowledged = true;
                }
                if (m.type === 'result')
                  e.providerResult = {
                    subtype: ['success', 'error_during_execution', 'error_max_turns'].includes(
                      m.subtype,
                    )
                      ? m.subtype
                      : 'unexpected',
                    isError: m.is_error === true,
                  };
              } catch {
                e.failure = 'stream-invalid';
              }
            }
          };
          child.stdout.on('data', receive);
          const send = (value) => {
            if (closed || child.stdin.destroyed) throw Error('provider-closed');
            child.stdin.write(JSON.stringify(value) + '\n');
          };
          try {
            send({
              type: 'control_request',
              request_id: 'fixture-init',
              request: { subtype: 'initialize', hooks: {} },
            });
            await until(() => initialized || closed, 10000);
            if (!initialized || closed) throw Error('initialize');
            send({
              type: 'user',
              message: { role: 'user', content: 'Invoke the selected local fixture action once.' },
            });
            await until(() => bytes(markers[1]) > 0 || closed, 15000);
            if (closed) throw Error('provider-closed');
            await until(() => frame(state.observer?.snapshot(), catalog, 1, 0, 0));
            e.pending = state.observer.snapshot();
            const first = bytes(markers[1]);
            await pause(125);
            e.progressObserved = first > 0 && bytes(markers[1]) > first;
            if (!e.progressObserved) throw Error('not-running');
            send({
              type: 'control_request',
              request_id: 'fixture-interrupt',
              request: { subtype: 'interrupt' },
            });
            e.interruptSent = true;
            await until(
              () =>
                e.interruptAcknowledged &&
                frame(state.observer?.snapshot(), catalog, 1, 1, 1) &&
                fs.existsSync(witnessFile),
            );
            e.after = state.observer.snapshot();
            if (bytes(witnessFile) > 1024) throw Error('witness-limit');
            const w = JSON.parse(fs.readFileSync(witnessFile, 'utf8'));
            e.witness = {
              launches: Number.isSafeInteger(w.launches) ? w.launches : null,
              ...Object.fromEntries(
                ['exited', 'closed', 'cancelled', 'interrupted', 'terminationConfirmed'].map(
                  (k) => [k, w[k] === true],
                ),
              ),
            };
            const last = bytes(markers[1]);
            await pause(200);
            e.progressStopped = last > 0 && bytes(markers[1]) === last;
            await until(() => !!e.providerResult);
          } catch {
            e.failure ||= 'interrupt-checkpoint-failed';
          } finally {
            child.stdout.removeListener('data', receive);
            child.stdin.end();
          }
        },
      },
    );
  } finally {
    setScenario(null);
    try {
      if (state.observer) {
        await until(
          () => state.observer.snapshot().state === 'coverage-lost' && !fs.existsSync(endpoint),
          4000,
        );
        e.lost = state.observer.snapshot();
        await pause(100);
        e.stickyLoss = JSON.stringify(e.lost) === JSON.stringify(state.observer.snapshot());
      }
    } catch {
      e.failure ||= 'cleanup-checkpoint-failed';
    }
    state.observer?.close();
    privateState.delete(e);
    e.endpointRemoved = !fs.existsSync(endpoint);
  }
  Object.assign(e, {
    unusedBytes: bytes(markers[0]),
    exitCode: result?.code ?? null,
    timedOut: result?.timedOut === true,
    cancelled: result?.cancelled === true,
    exceeded: result?.exceeded === true,
  });
  e.pass = cancellationPassed(e);
  receipt.scenarios.push(e);
  receipt.pass = e.pass && receipt.rejectedProxyRequests === 0;
}
