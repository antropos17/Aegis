/** TEST ONLY: installed provider status/action/status observations through explicit MCP routes. */
import fs from 'node:fs';
import path from 'node:path';
import generator from '../src/main/action-mcp-config.js';
import { configureStatusScenario } from './claude-status-model-fixture.mjs';
import { hasPrivateCanary } from './claude-action-mcp-fixture.mjs';
const size = (file) => (fs.existsSync(file) ? fs.statSync(file).size : 0);
const observed = (step) =>
  step?.toolDiscovered === true &&
  step.toolResultSeen === true &&
  step.privacyPass === true &&
  !step.privacyLeakDetected;
function status(step, catalog, attempts) {
  const report = step?.report;
  return (
    observed(step) &&
    step.tool === 'status' &&
    step.resultIsError === false &&
    report?.schemaVersion === 1 &&
    report.mode === 'action-route-status' &&
    report.scope === 'current-mcp-connection' &&
    report.selection === (catalog ? 'catalog' : 'single-action') &&
    report.selectedActionCount === (catalog ? 2 : 1) &&
    report.activity === 'idle' &&
    report.actionAttempts === attempts &&
    report.ownerInvocations === attempts &&
    report.ownerSettled === attempts &&
    report.ownerFailures === 0 &&
    report.selectionRejected === 0 &&
    report.cancellationRequests === 0 &&
    Number.isSafeInteger(report.messagesObserved) &&
    report.messagesObserved > 0 &&
    report.messagesObserved <= 128 &&
    report.limits?.messages === 128 &&
    report.limits.actionAttempts === 16 &&
    report.authorization === 'none' &&
    report.control === 'direct-child-only' &&
    report.outsideRouteCoverage === 'unknown' &&
    report.descendantControl === 'unsupported' &&
    report.blockingVerification === 'not-performed' &&
    report.providerIdentity === 'unverified'
  );
}

/** Check correlated owner counters against actual execution result and filesystem side effects.
 * @param {object} item Redacted scenario. @returns {boolean} All required evidence agrees.
 * @since v0.15.1 */
export function statusScenarioPassed(item) {
  if (
    !item ||
    !['allow', 'deny', 'ask'].includes(item.decision) ||
    typeof item.catalog !== 'boolean' ||
    !item.toolDiscovered ||
    item.protocolError ||
    item.privacyLeakDetected ||
    item.failed ||
    item.exitCode !== 0 ||
    item.timedOut ||
    item.cancelled ||
    item.exceeded ||
    !item.stdoutPrivacyPass ||
    item.requestedSteps !== 3 ||
    item.completedSteps !== 3 ||
    !Array.isArray(item.steps) ||
    item.steps.length !== 3 ||
    !Array.isArray(item.observations) ||
    item.observations.length !== 3
  )
    return false;
  const [before, action, after] = item.steps;
  if (
    !status(before, item.catalog, 0) ||
    !status(after, item.catalog, 1) ||
    after.report.messagesObserved <= before.report.messagesObserved ||
    !observed(action) ||
    action.tool !== 'action'
  )
    return false;
  const report = action.report;
  if (
    report?.schemaVersion !== 1 ||
    report.mode !== 'action-exec' ||
    report.decision !== item.decision ||
    report.control !== 'direct-child-only' ||
    report.descendantControl !== 'unsupported' ||
    report.authorization !== undefined ||
    report.policyDecision !== undefined
  )
    return false;
  if (item.decision === 'allow') {
    if (
      action.resultIsError !== false ||
      report.reason !== 'child-exited' ||
      report.execution?.state !== 'exited' ||
      report.execution.exitCode !== 0 ||
      report.execution.outputComplete !== true ||
      report.execution.termination !== 'not-requested'
    )
      return false;
  } else if (
    action.resultIsError !== true ||
    report.reason !== 'policy-' + item.decision ||
    report.execution?.state !== 'not-started' ||
    report.execution.exitCode !== null ||
    report.execution.termination !== 'not-requested'
  )
    return false;
  const expected = item.decision === 'allow' ? 1 : 0;
  return (
    item.observations.every(
      (entry, index) => entry?.unusedBytes === 0 && entry.selectedBytes === (index ? expected : 0),
    ) &&
    item.unusedBytes === 0 &&
    item.selectedBytes === expected
  );
}

/** Run fresh installed-provider connections for allow, deny and ask under generated configuration.
 * @param {object} context Owned scratch, synthetic API sink and bounded provider runner.
 * @returns {Promise<void>} Appends redacted observations; outer owner removes scratch.
 * @since v0.15.1 */
export async function verifyStatusRoute(context) {
  const { owned, env, receipt, action, run, configPath, setScenario } = context;
  const catalog = context.catalog === true;
  const sentinels = [
    path.join(owned, 'PRIVATE_STATUS_UNUSED'),
    path.join(owned, 'PRIVATE_STATUS_SELECTED'),
  ];
  const entries = ['first', 'second'].map((id, index) => ({
    id,
    policyPath: path.join(owned, 'status-' + id + '-policy.json'),
    requestPath: path.join(owned, 'status-' + id + '-request.json'),
    action: {
      ...action,
      args: [
        '-e',
        `require('node:fs').appendFileSync(${JSON.stringify(sentinels[index])},'x');console.log('PRIVATE_OUTPUT');console.error('PRIVATE_ERROR');`,
      ],
    },
  }));
  for (const entry of entries)
    fs.writeFileSync(entry.requestPath, JSON.stringify({ schemaVersion: 1, action: entry.action }));
  const manifest = path.join(owned, 'status-catalog.json');
  if (catalog)
    fs.writeFileSync(
      manifest,
      JSON.stringify({
        schemaVersion: 1,
        actions: entries.map(({ id, policyPath, requestPath }) => ({
          id,
          policyPath,
          requestPath,
        })),
      }),
    );
  const config = generator.buildActionMcpConfig(
    catalog ? 'catalog' : 'selected',
    catalog ? [manifest] : [entries[1].policyPath, entries[1].requestPath],
  );
  // TEST ONLY: contain provider routing and configuration within owned scratch.
  config.mcpServers.aegis.env = env;
  fs.writeFileSync(configPath, JSON.stringify(config));
  const selectedTool = catalog
    ? 'mcp__aegis__aegis_action_second'
    : 'mcp__aegis__aegis_execute_selected';
  for (const decision of ['allow', 'deny', 'ask']) {
    for (const file of sentinels) if (fs.existsSync(file)) fs.unlinkSync(file);
    for (const [index, entry] of entries.entries())
      fs.writeFileSync(
        entry.policyPath,
        JSON.stringify({
          schemaVersion: 2,
          defaultDecision: 'deny',
          rules: [{ action: entry.action, decision: index ? decision : 'allow' }],
        }),
      );
    const scenario = { decision, catalog, requests: 0, observations: [] };
    configureStatusScenario(scenario, { catalog }, [owned, ...sentinels], () => {
      scenario.observations.push({
        unusedBytes: size(sentinels[0]),
        selectedBytes: size(sentinels[1]),
      });
    });
    let result;
    let failed = false;
    setScenario(scenario);
    try {
      result = await run(
        [
          '-p',
          'Inspect route status, invoke the selected action once, then inspect route status again.',
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
          'mcp__aegis__aegis_route_status',
          selectedTool,
          '--model',
          'claude-sonnet-4-6',
          '--output-format',
          'json',
        ],
        { timeoutMs: 30000 },
      );
    } catch {
      failed = true;
      receipt.unreapedProcess = true;
      receipt.cleanupUnconfirmed = true;
    } finally {
      setScenario(null);
    }
    if (
      result &&
      (result.cancelled || result.timedOut || result.exceeded) &&
      !result.treeCleanupConfirmed
    ) {
      receipt.unreapedProcess = true;
      receipt.cleanupUnconfirmed = true;
    }
    const item = {
      ...scenario,
      failed,
      exitCode: result?.code ?? null,
      timedOut: result?.timedOut === true,
      cancelled: result?.cancelled === true,
      exceeded: result?.exceeded === true,
      stdoutPrivacyPass: !!result && !hasPrivateCanary(result.stdout, scenario),
      unusedBytes: size(sentinels[0]),
      selectedBytes: size(sentinels[1]),
    };
    item.pass = !!statusScenarioPassed(item);
    receipt.scenarios.push(item);
    if (!item.pass) break;
  }
  receipt.pass =
    receipt.scenarios.length === 3 &&
    receipt.scenarios.every((item) => item.pass) &&
    receipt.rejectedProxyRequests === 0;
}
