/** TEST ONLY: actual terminal broker; answers must arrive through external terminal input. */
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import broker from '../src/main/action-mcp-review.js';
import confirmation from '../src/main/action-confirmation.js';
import execution from '../src/main/action-execution.js';
import observation from '../src/main/action-observation-server.js';

/** Start the production review owner and retain actual child events through its existing seam.
 * @param {object} context Private paths and selection. @returns {Promise<object>} Configuration and cleanup.
 * @since v0.15.1 */
export async function reviewCancellationOwner({
  catalog,
  entries,
  manifest,
  endpoint,
  relayEndpoint,
  witnessFile,
  identity,
}) {
  const source = await observation.startActionObservation(
    endpoint,
    'mcp-review',
    catalog ? 'catalog' : 'single-action',
  );
  const controller = new AbortController();
  let launches = 0,
    exited = false,
    closed = false;
  execution._setDepsForTest({
    spawn: (...args) => {
      launches++;
      const child = spawn(...args);
      fs.writeFileSync(identity, String(child.pid));
      child.once('exit', () => {
        exited = true;
      });
      child.once('close', () => {
        closed = true;
      });
      return child;
    },
  });
  broker._setDepsForTest({
    execute: async (...args) => {
      const result = await confirmation.confirmSelectedAction(...args);
      fs.writeFileSync(
        witnessFile,
        JSON.stringify({
          launches,
          exited,
          closed,
          cancelled: result.reason === 'action-cancelled',
          interrupted: result.execution.state === 'interrupted',
          terminationConfirmed: result.execution.termination === 'confirmed',
        }),
      );
      return result;
    },
  });
  const done = broker
    .handleActionMcpReview(
      catalog
        ? ['--action-mcp-catalog-review', manifest, relayEndpoint]
        : ['--action-mcp-review', entries[1].policyPath, entries[1].requestPath, relayEndpoint],
      { signal: controller.signal, observe: source.observe },
    )
    .finally(() => source.close());
  return {
    async finish() {
      let timer;
      const settled = await Promise.race([
        done.then(() => true),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(false), 4000);
        }),
      ]);
      clearTimeout(timer);
      if (!settled) controller.abort();
      await done;
      broker._resetForTest();
      execution._resetForTest();
      if (!settled || fs.existsSync(relayEndpoint)) throw Error('review-owner-cleanup');
    },
  };
}
