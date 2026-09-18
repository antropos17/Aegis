/** TEST ONLY: installed Claude CLI against the real terminal broker and local model stub. */
import fs from 'node:fs';
import path from 'node:path';
import broker from '../src/main/action-mcp-review.js';
import { setPrivateCanaries, hasPrivateCanary } from './claude-action-mcp-fixture.mjs';
import { observeReviewPreview, observeNegativeAnswer } from './claude-review-observer.mjs';

const names = ['approved-ask', 'declined-ask', 'policy-deny', 'disconnect-during-review'];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** @param {Promise<unknown>} promise Owner completion. @param {number} ms Wait bound.
 * @returns {Promise<boolean>} Whether it settled within the bound. @since v0.15.1 */
export async function settleWithin(promise, ms) {
  let timer;
  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** @param {string} file Owned descriptor. @param {() => boolean} isClosed Owner state.
 * @returns {Promise<object>} Private descriptor; never serialize into a receipt. @since v0.15.1 */
export async function readEndpoint(file, isClosed) {
  const deadline = performance.now() + 3000;
  while (!isClosed() && performance.now() < deadline) {
    try {
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 1024) throw Error('endpoint');
      const value = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (
        value.schemaVersion === 1 &&
        /^[a-f0-9]{64}$/.test(value.token) &&
        Number.isInteger(value.port) &&
        value.port > 0 &&
        value.port <= 65535 &&
        Object.keys(value).length === 3
      )
        return value;
    } catch {
      /* Publication can still be in progress. */
    }
    await pause(20);
  }
  throw Error('endpoint-unavailable');
}

/** Check actual observations, including the original ask policy and drained preview.
 * @param {object} item Redacted scenario. @returns {boolean} Scenario passed. @since v0.15.1 */
export function reviewScenarioPassed(item) {
  if (
    !item.toolDiscovered ||
    item.timedOut ||
    item.exceeded ||
    !item.stdoutPrivacyPass ||
    !item.brokerClosed ||
    !item.endpointRemoved ||
    item.ownerAbortRequired ||
    item.privacyLeakDetected
  )
    return false;
  if (item.name === 'disconnect-during-review')
    return (
      item.previewCount === 1 &&
      item.cancelled &&
      item.treeCleanupConfirmed &&
      !item.sentinel &&
      !item.toolResultSeen &&
      !item.report
    );
  if (item.exitCode !== 0 || item.cancelled || !item.toolResultSeen || !item.privacyPass)
    return false;
  const report = item.report;
  if (!report?.execution) return false;
  if (item.name === 'approved-ask')
    return (
      item.previewCount === 1 &&
      item.sentinel &&
      !item.resultIsError &&
      report?.decision === 'allow' &&
      report.authorization === 'operator-confirmed' &&
      report.policyDecision === 'ask' &&
      report.execution.state === 'exited' &&
      report.execution.exitCode === 0 &&
      report.execution.outputComplete === true
    );
  return (
    ['declined-ask', 'policy-deny'].includes(item.name) &&
    !item.sentinel &&
    item.resultIsError &&
    (item.name !== 'declined-ask' || item.negativeAnswerObserved === true) &&
    report?.decision === 'deny' &&
    report.execution.state === 'not-started' &&
    report.reason === (item.name === 'policy-deny' ? 'policy-deny' : 'confirmation-denied') &&
    item.previewCount === (item.name === 'policy-deny' ? 0 : 1)
  );
}

/** Run four real-provider routing cases; terminal responses remain external to this fixture.
 * @param {object} context Owned scratch, runner and local API observation sink.
 * @returns {Promise<void>} Updates only the redacted receipt. @since v0.15.1 */
export async function verifyReviewRoute(context) {
  const {
    owned,
    repo,
    env,
    run,
    receipt,
    action,
    sentinel,
    policyPath,
    requestPath,
    configPath,
    setScenario,
  } = context;
  const endpointPath = path.join(owned, 'review-endpoint.json');
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
  for (const name of names) {
    if (fs.existsSync(sentinel)) fs.unlinkSync(sentinel);
    fs.writeFileSync(
      policyPath,
      JSON.stringify({
        schemaVersion: 2,
        defaultDecision: 'deny',
        rules: [{ action, decision: name === 'policy-deny' ? 'deny' : 'ask' }],
      }),
    );
    const scenario = {
      name,
      requests: 0,
      toolDiscovered: false,
      toolResultSeen: false,
      privacyPass: false,
      previewCount: 0,
    };
    setScenario(scenario);
    const runnerAbort = new AbortController();
    const brokerAbort = new AbortController();
    let brokerClosed = false;
    let ownerAbortRequired = false;
    let brokerCode;
    let negativeObserver;
    const restore = observeReviewPreview(process.stderr, () => {
      scenario.previewCount++;
      if (name === 'declined-ask') negativeObserver = observeNegativeAnswer(process.stdin);
      if (name === 'disconnect-during-review') runnerAbort.abort();
    });
    process.stderr.write(
      `\nAEGIS verifier case: ${name}. ` +
        (name === 'approved-ask'
          ? 'Enter the displayed RUN challenge.\n'
          : name === 'declined-ask'
            ? 'Enter no to decline.\n'
            : 'No terminal answer is needed.\n'),
    );
    const serving = broker
      .handleActionMcpReview(['--action-mcp-review', policyPath, requestPath, endpointPath], {
        signal: brokerAbort.signal,
      })
      .then((code) => {
        brokerCode = code;
      })
      .finally(() => {
        brokerClosed = true;
      });
    let result;
    try {
      const endpoint = await readEndpoint(endpointPath, () => brokerClosed);
      setPrivateCanaries(scenario, [endpoint.token, owned, sentinel, endpointPath]);
      result = await run(
        [
          '-p',
          'Use the configured selected-action tool once.',
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
          'mcp__aegis__aegis_execute_selected',
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
      scenario.negativeAnswerObserved = negativeObserver?.stop() === true;
      setScenario(null);
      if (!cleaned) {
        receipt.unreapedProcess = true;
        receipt.cleanupUnconfirmed = true;
      }
    }
    if (!brokerClosed) throw Error('broker-cleanup-unconfirmed');
    const item = {
      ...scenario,
      sentinel: fs.existsSync(sentinel),
      exitCode: result.code,
      timedOut: result.timedOut,
      cancelled: result.cancelled,
      exceeded: result.exceeded,
      treeCleanupConfirmed: result.treeCleanupConfirmed,
      stdoutPrivacyPass: !hasPrivateCanary(result.stdout, scenario),
      brokerClosed,
      brokerCode,
      endpointRemoved: !fs.existsSync(endpointPath),
      ownerAbortRequired,
    };
    item.pass = !!reviewScenarioPassed(item);
    receipt.scenarios.push(item);
    if (!item.pass) break;
  }
  receipt.pass =
    receipt.scenarios.length === names.length &&
    receipt.scenarios.every((item) => item.pass) &&
    receipt.rejectedProxyRequests === 0;
}
