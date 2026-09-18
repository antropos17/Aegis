/** TEST ONLY: single selected action against installed Claude and a local synthetic API. */
import fs from 'node:fs';
import path from 'node:path';
const tool = 'mcp__aegis__aegis_execute_selected';

/** @param {object} context Owned fixture and observation sink.
 * @returns {Promise<void>} Updates redacted receipt. @since v0.15.1 */
export async function verifySelectedRoute(context) {
  const {
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
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      mcpServers: {
        aegis: {
          type: 'stdio',
          command: process.execPath,
          args: [
            path.join(repo, 'src/main/main.js'),
            '--action-mcp-stdio',
            policyPath,
            requestPath,
          ],
          env,
        },
      },
    }),
  );
  for (const decision of ['allow', 'deny', 'ask']) {
    if (fs.existsSync(sentinel)) fs.unlinkSync(sentinel);
    fs.writeFileSync(
      policyPath,
      JSON.stringify({
        schemaVersion: 2,
        defaultDecision: 'deny',
        rules: [{ action, decision }],
      }),
    );
    const scenario = {
      decision,
      requests: 0,
      toolDiscovered: false,
      toolResultSeen: false,
      privacyPass: false,
    };
    setScenario(scenario);
    const result = await run([
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
      tool,
      '--model',
      'claude-sonnet-4-6',
      '--output-format',
      'json',
    ]);
    const report = scenario.report;
    const hasSentinel = fs.existsSync(sentinel);
    const pass =
      result.code === 0 &&
      !result.timedOut &&
      !result.exceeded &&
      scenario.toolDiscovered &&
      scenario.toolResultSeen &&
      scenario.privacyPass &&
      report?.decision === decision &&
      (decision === 'allow'
        ? hasSentinel &&
          report.execution.state === 'exited' &&
          report.execution.exitCode === 0 &&
          report.execution.outputComplete === true &&
          !scenario.resultIsError
        : !hasSentinel && report.execution.state === 'not-started' && scenario.resultIsError);
    receipt.scenarios.push({
      ...scenario,
      sentinel: hasSentinel,
      exitCode: result.code,
      timedOut: !!result.timedOut,
      exceeded: !!result.exceeded,
      pass: !!pass,
    });
    setScenario(null);
    if (result.code !== 0 || result.timedOut || result.exceeded) break;
  }
  receipt.pass =
    receipt.scenarios.length === 3 &&
    receipt.scenarios.every((item) => item.pass) &&
    receipt.rejectedProxyRequests === 0;
}
