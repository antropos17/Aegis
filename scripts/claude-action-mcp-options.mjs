/** Shared opt-in provider fixture options; never installs user settings. */
export const usage =
  'Windows only: node scripts/verify-claude-action-mcp.mjs [--crash | --catalog-crash | --review-crash | --catalog-review-crash | --review-cancellation | --catalog-review-cancellation | --cancellation | --catalog-cancellation | --review | --review-observation | --catalog-review-observation | --catalog | --catalog-review | --status | --catalog-status | --observation | --catalog-observation] --claude <absolute claude.exe> --bash <absolute bash.exe> --scratch <existing spacious directory>\nExplicitly configures disposable local MCP servers; uses a dummy credential and synthetic loopback API. Status modes query current-connection counters before and after allow/deny/ask actions. Observation modes additionally require live snapshots, owner-exit loss and descriptor cleanup. Cancellation modes use stream-json interrupt after real marker growth and require held-child termination, live cancellation counters and cleanup. Review modes require a live terminal for confirmation and refusal. Review observation also waits for pendingObserved before an answer and records pending disconnect. No OS firewall isolation; managed policy still applies. Stdout contains fixed readiness JSON lines and a final redacted receipt. No saved user settings are changed.';

/** @param {string[]} args Explicit verifier arguments. @returns {object} Selected fixture modes. @since v0.15.1 */
export function fixtureModes(args) {
  const crash = ['--crash', '--catalog-crash', '--review-crash', '--catalog-review-crash'].includes(
    args[0],
  );
  const reviewCancellation = [
    '--review-cancellation',
    '--catalog-review-cancellation',
    '--review-crash',
    '--catalog-review-crash',
  ].includes(args[0]);
  const cancellation =
    crash || reviewCancellation || ['--cancellation', '--catalog-cancellation'].includes(args[0]);
  const reviewObservation = ['--review-observation', '--catalog-review-observation'].includes(
    args[0],
  );
  const observation = ['--observation', '--catalog-observation'].includes(args[0]);
  const status = observation || ['--status', '--catalog-status'].includes(args[0]);
  const catalog = [
    '--catalog',
    '--catalog-review',
    '--catalog-status',
    '--catalog-observation',
    '--catalog-review-observation',
    '--catalog-cancellation',
    '--catalog-review-cancellation',
    '--catalog-crash',
    '--catalog-review-crash',
  ].includes(args[0]);
  const review = reviewObservation || ['--review', '--catalog-review'].includes(args[0]);
  return {
    crash,
    reviewCancellation,
    cancellation,
    reviewObservation,
    observation,
    status,
    catalog,
    review,
  };
}
