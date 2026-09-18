'use strict';

/**
 * Execute only the explicitly selected request under its selected local policy.
 * @param {string[]} args CLI flag, policy file and request file.
 * @param {(value:string) => void} write Redacted JSON output sink.
 * @returns {Promise<number>} 0 for child exit 0 with complete capture, 2 otherwise, 1 for invalid arguments.
 * @since v0.15.1
 */
async function handleActionExecutionCLI(args, write) {
  if (
    args.length !== 3 ||
    !['--action-exec-json', '--action-exec-confirm'].includes(args[0]) ||
    args.slice(1).some((arg) => typeof arg !== 'string' || !arg || arg.startsWith('--'))
  ) {
    write(JSON.stringify({ error: 'expected-action-exec-arguments' }));
    return 1;
  }
  const interactive = args[0] === '--action-exec-confirm';
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (interactive) {
    process.on('SIGINT', abort);
    process.on('SIGTERM', abort);
  }
  let report;
  try {
    report = interactive
      ? await require('./action-confirmation').confirmSelectedAction(args[1], args[2], {
          signal: controller.signal,
        })
      : await require('./action-execution').executeAction(args[1], args[2]);
  } catch {
    report = {
      schemaVersion: 1,
      mode: 'action-exec',
      decision: 'unknown',
      reason: 'execution-unavailable',
      execution: { state: 'unknown', exitCode: null, termination: 'unconfirmed' },
      control: 'direct-child-only',
      descendantControl: 'unsupported',
    };
  }
  if (interactive) {
    process.removeListener('SIGINT', abort);
    process.removeListener('SIGTERM', abort);
  }
  write(JSON.stringify(report));
  return report.decision === 'allow' &&
    report.execution.state === 'exited' &&
    report.execution.exitCode === 0 &&
    report.execution.outputComplete === true
    ? 0
    : 2;
}

module.exports = { handleActionExecutionCLI };
