import { cancellationInteraction } from './claude-cancellation-interaction.mjs';
/** TEST ONLY: installed Claude interrupt -> production MCP -> held child exit evidence. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import generator from '../src/main/action-mcp-config.js';
import client from '../src/main/action-observation-client.js';
import { frame as baseFrame, cancellationPassed } from './claude-cancellation-evidence.mjs';
import { reviewCancellationOwner } from './claude-review-cancellation-owner.mjs';
import { crashPassed } from './claude-crash-evidence.mjs';
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
        return (
          value?.state === 'observed' &&
          baseFrame(value, scenario.catalog, 0, 0, 0, scenario.review ? 'mcp-review' : 'mcp-stdio')
        );
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
  const review = context.reviewCancellation === true;
  const crash = context.crash === true;
  const frame = (...args) => baseFrame(...args, review ? 'mcp-review' : 'mcp-stdio');
  const endpoint = path.join(owned, 'PRIVATE_CANCEL_ENDPOINT.json');
  const witnessFile = path.join(owned, 'PRIVATE_CANCEL_WITNESS.json');
  const identity = path.join(owned, 'PRIVATE_CHILD_IDENTITY');
  const deadline = path.join(owned, 'PRIVATE_CHILD_DEADLINE');
  const markers = ['PRIVATE_CANCEL_UNUSED', 'PRIVATE_CANCEL_PROGRESS'].map((p) =>
    path.join(owned, p),
  );
  const entries = markers.map((marker, i) => {
    const selectedAction = {
      ...action,
      args: [
        '-e',
        `const fs=require('node:fs');const p=${JSON.stringify(marker)};fs.writeFileSync(p,'x');setInterval(()=>fs.appendFileSync(p,'x'),50);setTimeout(()=>{fs.writeFileSync(${JSON.stringify(deadline)},'done');process.exit(0)},8000);`,
      ],
    };
    const policyPath = path.join(owned, `cancel-${i}-policy.json`);
    const requestPath = path.join(owned, `cancel-${i}-request.json`);
    fs.writeFileSync(
      policyPath,
      JSON.stringify({
        schemaVersion: 2,
        defaultDecision: review ? 'ask' : 'deny',
        rules: review ? [] : [{ action: selectedAction, decision: 'allow' }],
      }),
    );
    fs.writeFileSync(requestPath, JSON.stringify({ schemaVersion: 1, action: selectedAction }));
    return { id: i ? 'second' : 'first', policyPath, requestPath };
  });
  const manifest = path.join(owned, 'cancel-catalog.json');
  fs.writeFileSync(manifest, JSON.stringify({ schemaVersion: 1, actions: entries }));
  let reviewOwner;
  const relayEndpoint = path.join(owned, 'PRIVATE_REVIEW_RELAY.json');
  const config = review
    ? generator.buildActionMcpConfig('relay', [relayEndpoint])
    : generator.buildActionMcpConfig(
        catalog ? 'catalog' : 'selected',
        catalog ? [manifest] : [entries[1].policyPath, entries[1].requestPath],
        endpoint,
      );
  // Witness forwards the existing spawn seam unchanged and records only fixed result booleans.
  if (!review)
    config.mcpServers.aegis.args.unshift(
      '--require',
      fileURLToPath(new URL('./claude-cancellation-witness.cjs', import.meta.url)),
    );
  config.mcpServers.aegis.env = {
    ...env,
    AEGIS_CANCELLATION_WITNESS: witnessFile,
    AEGIS_CHILD_IDENTITY: identity,
  };
  fs.writeFileSync(configPath, JSON.stringify(config));
  const tool = catalog ? 'mcp__aegis__aegis_action_second' : 'mcp__aegis__aegis_execute_selected';
  const e = {
    catalog,
    review,
    crash,
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
  const state = { endpoint, tool, observer: null, descriptor: null };
  privateState.set(e, state);
  setScenario(e);
  let result;
  let interactionDone;
  try {
    if (review)
      reviewOwner = await reviewCancellationOwner({
        catalog,
        entries,
        manifest,
        endpoint,
        relayEndpoint,
        witnessFile,
        identity,
      });
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
        timeoutMs: review ? 90000 : 30000,
        interact: (child) =>
          (interactionDone = cancellationInteraction({
            identity,
            e,
            catalog,
            state,
            markers,
            witnessFile,
            frame,
            bytes,
            until,
            pause,
          })(child)),
      },
    );
    await interactionDone;
  } finally {
    try {
      await reviewOwner?.finish();
    } catch {
      e.failure ||= 'review-owner-cleanup';
    }
    setScenario(null);
    try {
      if (state.observer) {
        await until(
          () =>
            state.observer.snapshot().state === 'coverage-lost' &&
            (crash || !fs.existsSync(endpoint)),
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
    if (crash) {
      e.endpointDisposition = e.endpointRemoved
        ? 'removed'
        : state.descriptor?.equals(fs.readFileSync(endpoint))
          ? 'unchanged-stale'
          : 'changed';
      e.deadlineAbsent = !fs.existsSync(deadline);
    }
  }
  Object.assign(e, {
    unusedBytes: bytes(markers[0]),
    exitCode: result?.code ?? null,
    timedOut: result?.timedOut === true,
    cancelled: result?.cancelled === true,
    exceeded: result?.exceeded === true,
    providerStdoutBytes: Buffer.byteLength(result?.stdout || ''),
    providerStderrBytes: result?.stderrBytes ?? null,
    limitReason: result?.limitReason ?? null,
  });
  e.pass = crash ? crashPassed(e) : cancellationPassed(e);
  receipt.scenarios.push(e);
  receipt.pass = e.pass && receipt.rejectedProxyRequests === 0;
}
