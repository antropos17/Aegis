/** @file Production sensor owner; native event admission remains unqualified. @since 0.19.2-beta */
'use strict';
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createSensorHost } = require('./sensor-host');
const { createWatchRoot, createLinuxBirthConverter } = require('./sensor-identity');
const { SENSITIVE_AGENT_DIRS, AGENT_CONFIG_PATHS } = require('../../shared/constants');
const healthModel = require('../sensor-health');
const ADMISSION = 'unsupported-admission';

/** Use the same explicit directory intentions as the existing file watcher.
 * This is not the watcher's glob-based home .env scope or a claim of live coverage.
 * @param {string} home Current host home directory.
 * @returns {string[]} Exact absolute directory prefixes.
 * @since 0.19.2-beta
 */
function directoryPrefixes(home) {
  return [...new Set([...SENSITIVE_AGENT_DIRS, ...AGENT_CONFIG_PATHS])].map((name) =>
    path.join(home, name),
  );
}

/** Build roots only from this committed pass's carrying Linux observations.
 * No PID lookup, wall-clock reconstruction, retained birth or previous population.
 * @param {object} pass Fresh process pass and its freshness gates.
 * @param {object} context Current successful procfs boot context.
 * @returns {object[]} Validated wire roots, or throws when scope is unavailable.
 * @since 0.19.2-beta
 */
function linuxRoots(pass, context) {
  if (
    pass.reliable !== true ||
    pass.identityDegraded !== false ||
    pass.gapStraddled !== false ||
    pass.snapshotCurrent !== true ||
    !(pass.processMap instanceof Map)
  )
    throw new Error('process-observation-unavailable');
  const convert = createLinuxBirthConverter(context);
  const roots = [];
  for (const agent of pass.agents) {
    if (agent.category !== 'ai' || agent.pid <= 0) continue;
    const row = pass.processMap.get(agent.pid);
    if (
      !row ||
      row.witnessSource !== 'linuxStartTicks' ||
      row.witness !== agent.generationWitness ||
      agent.generationWitnessSource !== row.witnessSource ||
      row.startTime !== agent.startTime ||
      typeof row.witness !== 'string'
    )
      throw new Error('identity-unavailable');
    const [bootId, birth, extra] = row.witness.split(':');
    const root = createWatchRoot(
      {
        pid: agent.pid,
        birth,
        witness: { kind: 'linux-start-ticks', bootId, startTicks: birth },
        identityError: null,
      },
      { platform: 'linux' },
    );
    if (extra !== undefined || bootId !== context.bootId || convert(birth) !== agent.startTime)
      throw new Error('identity-unavailable');
    roots.push({ ...root, identityError: null });
  }
  return roots;
}

/** Own startup, fresh watch replacement, status and finite shutdown in main.
 * The existing file/network ingress has no qualified native lifecycle/correlation
 * contract. Its synchronous sink therefore refuses custody for every native event.
 * _test is a local fixture seam, never an IPC option or executable selector.
 * @param {object} deps Platform adapter, packaged flag and status observer.
 * @returns {object|null} Runtime owner, or null on unsupported platforms.
 * @since 0.19.2-beta
 */
function createSensorRuntime(deps) {
  const platform = deps._test?.platform ?? process.platform;
  if (!['linux', 'darwin'].includes(platform)) return null;
  let paused = false,
    disposed = false,
    rejected = 0,
    signature = null,
    scope = 'awaiting-process-observation',
    pathScope = 'awaiting-start';
  let disposal = null;
  const getContext = () => deps.adapter.getProcessBirthContext?.();
  const host = createSensorHost({
    platform,
    packaged: deps.packaged,
    getLinuxContext: getContext,
    onStatus: deps.onStatus,
    sink() {
      rejected = Math.min(Number.MAX_SAFE_INTEGER, rejected + 1);
      return false;
    },
    _test: deps._test?.host,
  });
  function replace(roots) {
    const next = createHash('sha256').update(JSON.stringify(roots)).digest('hex');
    if (next === signature) return true;
    if (!host.updateWatch(roots)) return false;
    signature = next;
    return true;
  }
  return {
    start() {
      if (disposed) return false;
      pathScope = host.updatePaths(directoryPrefixes(os.homedir()))
        ? 'explicit-directories'
        : 'paths-update-rejected';
      if (paused) return false;
      return host.start();
    },
    onProcessObservationUnavailable() {
      if (disposed || paused) return;
      scope = 'process-observation-unavailable';
      if (!replace([])) scope = 'watch-update-rejected';
    },
    onProcessScanCommitted(pass) {
      if (disposed || paused) return;
      let roots = [];
      const freshObservation =
        pass.reliable === true &&
        pass.identityDegraded === false &&
        pass.gapStraddled === false &&
        pass.snapshotCurrent === true;
      let providerReady = platform === 'darwin' && freshObservation;
      scope = freshObservation ? 'identity-unavailable' : 'process-observation-unavailable';
      try {
        if (platform === 'linux') {
          roots = linuxRoots(pass, getContext());
          scope = 'current';
          providerReady = true;
        }
      } catch {
        scope = 'process-observation-unavailable';
      }
      if (!replace(roots)) {
        scope = 'watch-update-rejected';
        providerReady = false;
      }
      // A resumed macOS provider may start without manufacturing watch identity.
      // Only a new successful Linux pass can make an initially absent D1 context usable.
      // Binary/launch failures and exhausted restart budgets do not become scan retries.
      const status = host.getStatus();
      if (
        providerReady &&
        (status.phase === 'stopped' ||
          (status.phase === 'unavailable' && status.reason === 'identity-context-unavailable'))
      )
        host.start();
      try {
        deps.onStatus?.();
      } catch {
        // A diagnostic observer cannot invalidate a committed polling pass.
      }
    },
    setPaused(value) {
      paused = value === true;
      if (paused) {
        scope = 'paused';
        signature = null;
        host.updateWatch([]);
        void host.stop();
      }
    },
    isActive() {
      return ['starting', 'running', 'closing', 'waiting', 'stopping'].includes(
        host.getStatus().phase,
      );
    },
    dispose() {
      disposed = true;
      disposal ??= host.dispose();
      return disposal;
    },
    getHealth() {
      const health = host.getHealth();
      return health.state === 'HEALTHY'
        ? healthModel.markDegraded(health, Date.now(), { error: ADMISSION, detail: ADMISSION })
        : health;
    },
    getStatus() {
      const status = host.getStatus();
      return {
        ...status,
        coverage: Object.fromEntries(
          Object.keys(status.coverage).map((key) => [key, 'coverage-lost']),
        ),
        admission: { state: ADMISSION, accepted: 0, rejected },
        providerState: host.getHealth().state,
        watchScope: scope,
        pathScope,
        paused,
      };
    },
  };
}
module.exports = { createSensorRuntime, directoryPrefixes };
