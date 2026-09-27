'use strict';
const { actionReport } = require('./action-protected-execution');

/**
 * Execute only the explicitly selected request under its selected local policy.
 * @param {string[]} args Exact route flag, policy file and request file.
 * @param {(value:string) => void} write Redacted JSON output sink.
 * @returns {Promise<number>} 0 for child exit 0 with complete capture, 2 otherwise, 1 for invalid arguments.
 * @since v0.15.1
 */
async function handleActionExecutionCLI(args, write) {
  if (args[0] === '--action-appcontainer-workspaces') {
    if (args.length !== 1) {
      write(JSON.stringify({ error: 'expected-action-exec-arguments' }));
      return 1;
    }
    try {
      write(JSON.stringify(require('./mcp-gateway-windows-job').listAppContainerWorkspaces()));
      return 0;
    } catch {
      write(JSON.stringify({ error: 'workspace-inventory-unavailable' }));
      return 2;
    }
  }
  if (
    args.length !== (args[0] === '--action-exec-appcontainer-import-confirm' ? 4 : 3) ||
    ![
      '--action-exec-json',
      '--action-exec-confirm',
      '--action-exec-windows-job-json',
      '--action-exec-windows-job-confirm',
      '--action-exec-appcontainer-confirm',
      '--action-exec-appcontainer-import-confirm',
    ].includes(args[0]) ||
    args.slice(1).some((arg) => typeof arg !== 'string' || !arg || arg.startsWith('--'))
  ) {
    write(JSON.stringify({ error: 'expected-action-exec-arguments' }));
    return 1;
  }
  const importInput = args[0] === '--action-exec-appcontainer-import-confirm';
  const appContainer = importInput || args[0] === '--action-exec-appcontainer-confirm';
  const interactive =
    appContainer ||
    args[0] === '--action-exec-confirm' ||
    args[0] === '--action-exec-windows-job-confirm';
  const protectedJob =
    appContainer ||
    args[0] === '--action-exec-windows-job-json' ||
    args[0] === '--action-exec-windows-job-confirm';
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
          ...(appContainer
            ? { appContainer: true, ...(importInput ? { inputFile: args[3] } : {}) }
            : protectedJob
              ? { protectedDescendants: true }
              : {}),
        })
      : protectedJob
        ? await require('./action-execution').executeAction(args[1], args[2], {
            protectedDescendants: true,
          })
        : await require('./action-execution').executeAction(args[1], args[2]);
  } catch {
    report = actionReport(
      'unknown',
      'execution-unavailable',
      {
        state: 'unknown',
        termination: 'unconfirmed',
      },
      { appContainer, protectedDescendants: protectedJob, importInput },
    );
  }
  if (interactive) {
    process.removeListener('SIGINT', abort);
    process.removeListener('SIGTERM', abort);
  }
  write(JSON.stringify(report));
  return report.decision === 'allow' &&
    report.execution.state === 'exited' &&
    report.execution.exitCode === 0 &&
    report.execution.outputComplete === true &&
    (!protectedJob ||
      (report.control === (appContainer ? 'windows-appcontainer-job' : 'windows-job') &&
        report.descendantControl === 'confirmed')) &&
    (!appContainer ||
      (report.isolation?.state === 'verified' &&
        report.isolation?.workspace === 'retained' &&
        report.isolation?.profileCleanup === 'confirmed')) &&
    (!importInput || report.input === 'imported')
    ? 0
    : 2;
}

module.exports = { handleActionExecutionCLI };
