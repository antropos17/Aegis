/** TEST ONLY: installed provider routing of two operator-selected catalog actions. */
import fs from 'node:fs';
import path from 'node:path';
import configGenerator from '../src/main/action-mcp-config.js';
import broker from '../src/main/action-mcp-review.js';
import { configureCatalogScenario } from './claude-catalog-model-fixture.mjs';
import { setPrivateCanaries, hasPrivateCanary } from './claude-action-mcp-fixture.mjs';
import { readEndpoint, settleWithin } from './claude-mcp-review-fixture.mjs';
import { observeReviewPreview, observeNegativeAnswer } from './claude-review-observer.mjs';
import observation from '../src/main/action-observation-server.js';
import {
  createCatalogReviewObservation,
  catalogReviewObservationPassed,
} from './claude-catalog-review-observation.mjs';

const tools = ['mcp__aegis__aegis_action_first', 'mcp__aegis__aegis_action_second'];
const size = (file) => (fs.existsSync(file) ? fs.statSync(file).size : 0);
const successful = (step) =>
  step?.toolResultSeen === true &&
  step.privacyPass === true &&
  !step.resultIsError &&
  step.report?.decision === 'allow' &&
  step.report.execution?.state === 'exited' &&
  step.report.execution.exitCode === 0 &&
  step.report.execution.outputComplete === true;
const stopped = (step, decision, reason) =>
  step?.toolResultSeen === true &&
  step.privacyPass === true &&
  step.resultIsError === true &&
  step.report?.decision === decision &&
  step.report.reason === reason &&
  step.report.execution?.state === 'not-started';

/** Check actual tool results, side effects and privacy, never provider text claims.
 * @param {object} item Redacted observations. @returns {boolean} Whether all checks passed.
 * @since v0.15.1 */
export function catalogScenarioPassed(item) {
  if (
    !item.toolDiscovered ||
    item.protocolError ||
    item.privacyLeakDetected ||
    item.timedOut ||
    item.exceeded ||
    !item.stdoutPrivacyPass ||
    !Array.isArray(item.steps) ||
    !Array.isArray(item.observations) ||
    !item.steps.every((step) => step && typeof step === 'object') ||
    !item.observations.every((value) => value && typeof value === 'object') ||
    item.requestedSteps !== item.steps.length ||
    item.observations.length !== item.completedSteps
  )
    return false;
  const [first, second, pending] = item.steps;
  const [beforeSecond, afterSecond] = item.observations;
  if (item.name === 'catalog-review')
    return (
      item.steps.length === 3 &&
      item.completedSteps === 2 &&
      item.requestedSteps === 3 &&
      pending.tool === 'second' &&
      pending.toolDiscovered === true &&
      pending.toolResultSeen === false &&
      pending.report === undefined &&
      pending.privacyPass === false &&
      pending.resultIsError === undefined &&
      first.tool === 'first' &&
      second.tool === 'second' &&
      successful(first) &&
      first.report.authorization === 'operator-confirmed' &&
      first.report.policyDecision === 'ask' &&
      stopped(second, 'deny', 'confirmation-denied') &&
      item.negativeAnswerObserved === true &&
      item.previewCount === 3 &&
      item.cancelled === true &&
      item.treeCleanupConfirmed === true &&
      item.brokerClosed === true &&
      // Forced relay termination may reset TCP (transport status 2), after cleanup.
      [0, 2].includes(item.brokerCode) &&
      item.endpointRemoved === true &&
      !item.ownerAbortRequired &&
      beforeSecond.firstBytes === 1 &&
      beforeSecond.secondBytes === 0 &&
      afterSecond.firstBytes === 1 &&
      afterSecond.secondBytes === 0 &&
      item.firstBytes === 1 &&
      item.secondBytes === 0
    );
  if (item.exitCode !== 0 || item.cancelled || item.completedSteps !== item.steps.length)
    return false;
  if (item.name === 'two-allowed')
    return (
      item.requestedSteps === 2 &&
      item.steps.length === 2 &&
      first.tool === 'first' &&
      second.tool === 'second' &&
      successful(first) &&
      successful(second) &&
      beforeSecond.firstBytes === 1 &&
      beforeSecond.secondBytes === 0 &&
      afterSecond.firstBytes === 1 &&
      afterSecond.secondBytes === 1 &&
      item.firstBytes === 1 &&
      item.secondBytes === 1
    );
  const decision =
    item.name === 'denied-second' ? 'deny' : item.name === 'ask-second' ? 'ask' : null;
  return (
    !!decision &&
    item.requestedSteps === 1 &&
    item.steps.length === 1 &&
    first.tool === 'second' &&
    stopped(first, decision, 'policy-' + decision) &&
    beforeSecond.firstBytes === 0 &&
    beforeSecond.secondBytes === 0 &&
    item.firstBytes === 0 &&
    item.secondBytes === 0
  );
}

/** Run direct catalog scenarios or one connected terminal review sequence.
 * @param {object} context Isolated scratch, provider runner and model observation sink.
 * @returns {Promise<void>} Updates only redacted receipt metadata. @since v0.15.1 */
export async function verifyCatalogRoute(context) {
  const { owned, env, run, receipt, action, configPath, setScenario, review } = context;
  const sentinelPaths = ['PRIVATE_FIRST', 'PRIVATE_SECOND'].map((name) => path.join(owned, name));
  const catalogPath = path.join(owned, 'catalog.json');
  const endpointPath = path.join(owned, 'catalog-endpoint.json');
  const selections = ['first', 'second'].map((id, index) => ({
    id,
    policyPath: path.join(owned, id + '-policy.json'),
    requestPath: path.join(owned, id + '-request.json'),
    action: {
      ...action,
      args: [
        '-e',
        `require('node:fs').appendFileSync(${JSON.stringify(sentinelPaths[index])},'x');console.log('PRIVATE_OUTPUT');console.error('PRIVATE_ERROR');`,
      ],
    },
  }));
  fs.writeFileSync(
    catalogPath,
    JSON.stringify({
      schemaVersion: 1,
      actions: selections.map(({ id, policyPath, requestPath }) => ({
        id,
        policyPath,
        requestPath,
      })),
    }),
  );
  for (const selected of selections)
    fs.writeFileSync(
      selected.requestPath,
      JSON.stringify({ schemaVersion: 1, action: selected.action }),
    );
  const config = configGenerator.buildActionMcpConfig(review ? 'relay' : 'catalog', [
    review ? endpointPath : catalogPath,
  ]);
  // TEST ONLY: keep provider routing and configuration inside the disposable fixture.
  config.mcpServers.aegis.env = env;
  fs.writeFileSync(configPath, JSON.stringify(config));
  const names = review ? ['catalog-review'] : ['two-allowed', 'denied-second', 'ask-second'];
  for (const name of names) {
    for (const file of sentinelPaths) if (fs.existsSync(file)) fs.unlinkSync(file);
    for (const [index, selected] of selections.entries()) {
      const decision = review
        ? 'ask'
        : index === 0 || name === 'two-allowed'
          ? 'allow'
          : name === 'denied-second'
            ? 'deny'
            : 'ask';
      fs.writeFileSync(
        selected.policyPath,
        JSON.stringify({
          schemaVersion: 2,
          defaultDecision: 'deny',
          rules: [{ action: selected.action, decision }],
        }),
      );
    }
    const scenario = { name, requests: 0, previewCount: 0, observations: [] };
    const observationPath = path.join(owned, 'PRIVATE_CATALOG_OBSERVATION.json');
    const probe = context.reviewObservation
      ? createCatalogReviewObservation(scenario, observationPath, sentinelPaths)
      : null;
    const plan = review
      ? ['first', 'second', 'second']
      : name === 'two-allowed'
        ? ['first', 'second']
        : ['second'];
    const canaries = [owned, ...sentinelPaths, endpointPath];
    const runnerAbort = new AbortController();
    const ownerAbort = new AbortController();
    let serving = Promise.resolve(),
      brokerClosed = !review,
      ownerAbortRequired = false;
    let brokerCode,
      negativeObserver,
      result,
      failed = false,
      runStarted = false;
    let restore = () => {};
    let pendingCheckpoint = Promise.resolve();
    try {
      if (review) {
        restore = observeReviewPreview(process.stderr, () => {
          scenario.previewCount++;
          if (scenario.previewCount === 2) negativeObserver = observeNegativeAnswer(process.stdin);
          const index = scenario.previewCount - 1;
          if (probe) {
            pendingCheckpoint = probe
              .pending(index)
              .then((ready) => {
                if (ready)
                  process.stdout.write(
                    JSON.stringify({
                      mode: 'catalog-review-observation',
                      pendingObserved: true,
                      review: index + 1,
                    }) + '\n',
                  );
                if (!ready || index === 2) runnerAbort.abort();
              })
              .catch(() => runnerAbort.abort());
          } else if (scenario.previewCount === 3) runnerAbort.abort();
        });
        process.stderr.write(
          '\nAEGIS catalog verifier: confirm FIRST with its RUN challenge; decline SECOND with no; THIRD disconnects automatically.\n' +
            (probe ? 'Wait for the matching pendingObserved marker before each answer.\n' : ''),
        );
        const args = ['--action-mcp-catalog-review', catalogPath, endpointPath];
        const runBroker = (selected, options = {}) =>
          broker.handleActionMcpReview(selected, {
            ...options,
            signal: ownerAbort.signal,
          });
        serving = (
          probe
            ? observation.runObservedMcp(
                [...args, '--observe', observationPath],
                runBroker,
                'mcp-review',
              )
            : runBroker(args)
        )
          .then((code) => {
            brokerCode = code;
          })
          .catch(() => {
            failed = true;
          })
          .finally(() => {
            brokerClosed = true;
          });
        const endpoint = await readEndpoint(endpointPath, () => brokerClosed);
        canaries.push(endpoint.token);
      }
      configureCatalogScenario(scenario, plan, canaries, () => {
        scenario.observations.push({
          firstBytes: size(sentinelPaths[0]),
          secondBytes: size(sentinelPaths[1]),
        });
        if (review && scenario.observations.length === 2)
          scenario.negativeAnswerObserved = negativeObserver?.stop() === true;
      });
      setPrivateCanaries(scenario, canaries);
      setScenario(scenario);
      runStarted = true;
      result = await run(
        [
          '-p',
          'Use the configured catalog action tools in the requested sequence.',
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
          ...tools,
          '--model',
          'claude-sonnet-4-6',
          '--output-format',
          'json',
        ],
        { signal: runnerAbort.signal, timeoutMs: review ? 90000 : 20000 },
      );
      if (review && !(await settleWithin(serving, 3000))) ownerAbortRequired = true;
    } catch {
      failed = true;
      if (runStarted && !result) receipt.unreapedProcess = receipt.cleanupUnconfirmed = true;
    } finally {
      if (!brokerClosed) {
        ownerAbortRequired = true;
        ownerAbort.abort();
      }
      const cleaned = await settleWithin(serving, 4000);
      await pendingCheckpoint;
      await probe?.finish();
      restore();
      negativeObserver?.stop();
      setScenario(null);
      if (!cleaned || ((result?.cancelled || result?.timedOut) && !result.treeCleanupConfirmed)) {
        receipt.unreapedProcess = true;
        receipt.cleanupUnconfirmed = true;
      }
    }
    // Observe after cancellation cleanup rather than while a review can still launch.
    const item = {
      ...scenario,
      firstBytes: size(sentinelPaths[0]),
      secondBytes: size(sentinelPaths[1]),
      exitCode: result?.code ?? null,
      timedOut: result?.timedOut === true,
      cancelled: result?.cancelled === true,
      exceeded: result?.exceeded === true,
      treeCleanupConfirmed: result?.treeCleanupConfirmed === true,
      stdoutPrivacyPass: !!result && !hasPrivateCanary(result.stdout, scenario),
      brokerClosed,
      brokerCode,
      endpointRemoved: !fs.existsSync(endpointPath),
      ownerAbortRequired,
    };
    item.pass =
      !failed &&
      catalogScenarioPassed(item) &&
      (!probe || catalogReviewObservationPassed(item.catalogReviewObservation));
    receipt.scenarios.push(item);
    if (!item.pass) break;
  }
  receipt.pass =
    receipt.scenarios.length === names.length &&
    receipt.scenarios.every((item) => item.pass) &&
    receipt.rejectedProxyRequests === 0;
}
