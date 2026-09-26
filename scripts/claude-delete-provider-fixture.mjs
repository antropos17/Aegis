/** TEST ONLY: installed Claude CLI, selected-file MCP broker and local model stub. */
import fs from 'node:fs';
import path from 'node:path';
import broker from '../src/main/action-mcp-review.js';
import {
  emitSyntheticToolReply,
  hasPrivateCanary,
  setPrivateCanaries,
} from './claude-action-mcp-fixture.mjs';
import { readEndpoint, settleWithin } from './claude-mcp-review-fixture.mjs';
import { observeNegativeAnswer } from './claude-review-observer.mjs';
import {
  observeAffirmativeAnswer,
  observeDeletePreview,
} from './claude-delete-review-observer.mjs';

const TOOL_ID = 'toolu_aegisdelete0001';
const TOOL_NAME = 'mcp__aegis__aegis_delete_selected_file';
const NAMES = ['approved-delete', 'refused-delete', 'policy-deny'];
const known = (value, choices) => (choices.includes(value) ? value : 'unexpected');

function reportFrom(value, depth = 0) {
  if (depth > 8 || value == null) return null;
  if (typeof value === 'string') {
    try {
      return reportFrom(JSON.parse(value), depth + 1);
    } catch {
      // Claude can prepend a heading to the MCP text result. The parsed object
      // still has to be inside the matching tool_result block, never model prose.
      const first = value.indexOf('{');
      const last = value.lastIndexOf('}');
      if (first < 0 || last <= first) return null;
      try {
        return reportFrom(JSON.parse(value.slice(first, last + 1)), depth + 1);
      } catch {
        return null;
      }
    }
  }
  if (typeof value !== 'object') return null;
  if (
    value.schemaVersion === 1 &&
    value.mode === 'action-delete-file' &&
    value.operation &&
    typeof value.operation === 'object' &&
    !Array.isArray(value.operation)
  )
    return value;
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    const report = reportFrom(child, depth + 1);
    if (report) return report;
  }
  return null;
}

/** Capture only a redacted structured report from Claude's actual tool_result block.
 * @param {object} input Synthetic model request. @param {object} scenario Redacted sink.
 * @returns {void} @since v0.16.0 */
export function captureDeleteToolResult(input, scenario) {
  for (const message of Array.isArray(input.messages) ? input.messages : []) {
    for (const block of Array.isArray(message.content) ? message.content : []) {
      if (block.type !== 'tool_result' || block.tool_use_id !== TOOL_ID) continue;
      scenario.toolResultCount++;
      scenario.resultIsError = block.is_error === true;
      scenario.privacyLeakDetected =
        scenario.privacyLeakDetected === true || hasPrivateCanary(block, scenario);
      const report = reportFrom(block.content);
      if (!report) continue;
      scenario.report = {
        schemaVersion: report.schemaVersion,
        mode: report.mode,
        decision: known(report.decision, ['allow', 'deny', 'unknown']),
        reason: known(report.reason, ['file-deleted', 'confirmation-denied', 'policy-deny']),
        operation: { state: known(report.operation.state, ['deleted', 'not-started', 'unknown']) },
        control: known(report.control, ['selected-file-only']),
        outsideRouteCoverage: known(report.outsideRouteCoverage, ['unknown']),
      };
      scenario.privacyPass = !scenario.privacyLeakDetected;
    }
  }
}

/** Reply with the advertised exact tool name and empty arguments, never prose as an oracle.
 * @param {object} res Loopback response. @param {object} input Claude model request.
 * @param {object} scenario Redacted sink. @returns {void} @since v0.16.0 */
export function replyWithDeleteTool(res, input, scenario) {
  captureDeleteToolResult(input, scenario);
  const selected = (Array.isArray(input.tools) ? input.tools : []).find(
    (tool) => tool.name === TOOL_NAME,
  );
  if (selected) scenario.toolDiscovered = true;
  const first = scenario.requests === 1 && selected;
  emitSyntheticToolReply(
    res,
    input,
    first
      ? { type: 'tool_use', id: TOOL_ID, name: selected.name, input: {} }
      : { type: 'text', text: 'OK' },
  );
}

/** Require provider discovery, a matching tool_result report and real filesystem state.
 * @param {object} item Redacted case evidence. @returns {boolean} Case passed.
 * @since v0.16.0 */
export function deleteScenarioPassed(item) {
  if (
    !NAMES.includes(item.name) ||
    !item.toolDiscovered ||
    item.toolResultCount !== 1 ||
    item.exitCode !== 0 ||
    item.brokerCode !== 0 ||
    item.timedOut ||
    item.cancelled ||
    item.exceeded ||
    !item.stdoutPrivacyPass ||
    !item.privacyPass ||
    item.privacyLeakDetected ||
    !item.brokerClosed ||
    !item.endpointRemoved ||
    item.ownerAbortRequired ||
    !item.neighborPreserved ||
    item.report?.schemaVersion !== 1 ||
    item.report.mode !== 'action-delete-file' ||
    item.report.control !== 'selected-file-only' ||
    item.report.outsideRouteCoverage !== 'unknown'
  )
    return false;
  if (item.name === 'approved-delete')
    return (
      item.previewCount === 1 &&
      item.freshChallengeObserved === true &&
      item.affirmativeAnswerObserved === true &&
      item.targetRemoved === true &&
      item.targetRetained === false &&
      item.resultIsError === false &&
      item.report.decision === 'allow' &&
      item.report.reason === 'file-deleted' &&
      item.report.operation.state === 'deleted'
    );
  return (
    item.previewCount === (item.name === 'refused-delete' ? 1 : 0) &&
    (item.name !== 'refused-delete' ||
      (item.freshChallengeObserved === true && item.negativeAnswerObserved === true)) &&
    item.targetRemoved === false &&
    item.targetRetained === true &&
    item.resultIsError === true &&
    item.report.decision === 'deny' &&
    item.report.reason === (item.name === 'policy-deny' ? 'policy-deny' : 'confirmation-denied') &&
    item.report.operation.state === 'not-started'
  );
}

/** Exercise three installed-provider calls through fresh terminal-owned delete brokers.
 * @param {object} context Owned scratch, runner and loopback scenario sink.
 * @returns {Promise<void>} Updates the redacted receipt. @since v0.16.0 */
export async function verifyDeleteRoute(context) {
  const { owned, repo, env, run, receipt, policyPath, requestPath, configPath, setScenario } =
    context;
  const endpointPath = path.join(owned, 'delete-endpoint.json');
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      mcpServers: {
        aegis: {
          type: 'stdio',
          command: process.execPath,
          args: [path.join(repo, 'src/main/main.js'), '--action-mcp-connect', endpointPath],
          env,
        },
      },
    }),
  );
  let priorChallenge;
  for (const name of NAMES) {
    const target = path.join(owned, 'work', `PRIVATE_DELETE_TARGET-${name}.txt`);
    const neighbor = path.join(owned, 'work', `PRIVATE_NEIGHBOR-${name}.txt`);
    const marker = 'PRIVATE_DELETE_BODY';
    fs.writeFileSync(target, marker);
    fs.writeFileSync(neighbor, marker);
    const operation = { kind: 'delete-file', path: target };
    fs.writeFileSync(requestPath, JSON.stringify({ schemaVersion: 1, operation }));
    fs.writeFileSync(
      policyPath,
      JSON.stringify({
        schemaVersion: 1,
        defaultDecision: 'deny',
        rules: [{ operation, decision: name === 'policy-deny' ? 'deny' : 'allow' }],
      }),
    );
    const scenario = {
      name,
      requests: 0,
      toolDiscovered: false,
      toolResultCount: 0,
      privacyPass: false,
      previewCount: 0,
    };
    setScenario(scenario);
    const runnerAbort = new AbortController();
    const brokerAbort = new AbortController();
    let brokerClosed = false;
    let brokerCode;
    let ownerAbortRequired = false;
    let answerObserver;
    const restore = observeDeletePreview(process.stderr, target, (challenge) => {
      scenario.previewCount++;
      scenario.freshChallengeObserved = !priorChallenge || priorChallenge !== challenge;
      priorChallenge = challenge;
      if (name === 'approved-delete')
        answerObserver = observeAffirmativeAnswer(process.stdin, challenge);
      if (name === 'refused-delete') answerObserver = observeNegativeAnswer(process.stdin);
    });
    process.stderr.write(
      `\nAEGIS verifier case: ${name}. ` +
        (name === 'approved-delete'
          ? 'Enter the displayed DELETE challenge.\n'
          : name === 'refused-delete'
            ? 'Enter no to decline.\n'
            : 'No terminal answer is needed.\n'),
    );
    const serving = broker
      .handleActionMcpReview(
        ['--action-mcp-delete-review', policyPath, requestPath, endpointPath],
        { signal: brokerAbort.signal },
      )
      .then((code) => {
        brokerCode = code;
      })
      .finally(() => {
        brokerClosed = true;
      });
    let result;
    try {
      const endpoint = await readEndpoint(endpointPath, () => brokerClosed);
      setPrivateCanaries(scenario, [endpoint.token, owned, target, endpointPath]);
      result = await run(
        [
          '-p',
          'Use the configured selected-file deletion tool once with empty arguments.',
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
          TOOL_NAME,
          '--model',
          'claude-sonnet-4-6',
          '--output-format',
          'json',
        ],
        { signal: runnerAbort.signal, timeoutMs: 90000 },
      );
      if (!(await settleWithin(serving, 3000))) ownerAbortRequired = true;
    } finally {
      if (!brokerClosed) {
        ownerAbortRequired = true;
        brokerAbort.abort();
      }
      const cleaned = await settleWithin(serving, 4000);
      restore();
      if (name === 'approved-delete')
        scenario.affirmativeAnswerObserved = answerObserver?.stop() === true;
      if (name === 'refused-delete')
        scenario.negativeAnswerObserved = answerObserver?.stop() === true;
      setScenario(null);
      if (!cleaned) {
        receipt.unreapedProcess = true;
        receipt.cleanupUnconfirmed = true;
      }
    }
    if (!brokerClosed) throw Error('broker-cleanup-unconfirmed');
    const item = {
      ...scenario,
      targetRemoved: !fs.existsSync(target),
      targetRetained: fs.existsSync(target) && fs.readFileSync(target, 'utf8') === marker,
      neighborPreserved: fs.readFileSync(neighbor, 'utf8') === marker,
      exitCode: result.code,
      timedOut: result.timedOut,
      cancelled: result.cancelled,
      exceeded: result.exceeded,
      stdoutPrivacyPass: !hasPrivateCanary(result.stdout, scenario),
      brokerClosed,
      brokerCode,
      endpointRemoved: !fs.existsSync(endpointPath),
      ownerAbortRequired,
    };
    item.pass = deleteScenarioPassed(item);
    receipt.scenarios.push(item);
    if (!item.pass) break;
  }
  receipt.pass =
    receipt.scenarios.length === NAMES.length &&
    receipt.scenarios.every((item) => item.pass) &&
    receipt.rejectedProxyRequests === 0;
}
