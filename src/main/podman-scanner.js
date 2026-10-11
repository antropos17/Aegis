/** Linux-native passive Podman image metadata discovery; candidates confer no authority. */
'use strict';
const { execFile: defaultExecFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { MAX_OUTPUT_BYTES, parseContainerOutput } = require('./container-metadata');

const {
  MAX_CONFIGURATION_CANDIDATES,
  CONFIGURATION_TIMEOUT_MS,
  CONFIGURATION_OUTPUT_BYTES,
  PODMAN_CONFIGURATION_FORMAT,
  parseConfiguration,
} = require('./container-configuration');

const CADENCE_MS = 30000;
const FRESH_MS = 90000;
const CONFIG_NAME = 'podman-local.conf';
const CONFIG_CONTENT = '[engine]\nremote = false\nenv = [{append = false}]\n';
// --remote=false alone cannot override engine.remote=true in containers.conf.
// The final overlay also removes configured engine.env that could reintroduce
// remote selectors or telemetry after child-environment scrubbing.
// https://github.com/podman-container-tools/podman/blob/main/cmd/podman/registry/config.go
// https://github.com/containers/common/blob/main/docs/containers.conf.5.md
const REMOTE_ENV = /^(?:CONTAINER_(?:HOST|CONNECTION|SSHKEY|PROXY)|PODMAN_CONNECTIONS_CONF)$/i;
const SCRUB_ENV =
  /^(?:CONTAINER_(?:HOST|CONNECTION|SSHKEY|PROXY)$|PODMAN_CONNECTIONS_CONF$|CONTAINERS_CONF_OVERRIDE$|PODMAN_(?:OTEL_|TRACE)|DOCKER_CLI_OTEL_|OTEL_|TRACEPARENT$|TRACESTATE$|JAEGER_)/i;
// Podman's reporter exposes Names as one string and provides the json helper.
// https://github.com/podman-container-tools/podman/blob/main/cmd/podman/containers/ps.go
// https://github.com/containers/common/blob/main/pkg/report/template.go
const FORMAT =
  '{"ID":{{json .ID}},"Image":{{json .Image}},"Names":{{json .Names}},"State":{{json .State}}}';
// events-backend and trace are ABI-only root flags: remote-only CLI builds fail
// during flag parsing, before a remote engine can process ps.
// https://github.com/containers/podman/blob/v5.0.0/cmd/podman/root.go
const ARGS = [
  '--remote=false',
  '--events-backend=none',
  '--trace=false',
  'ps',
  '--no-trunc',
  '--filter',
  'status=running',
  '--format',
  FORMAT,
];

/** Resolve and verify the overlay readable by an external CLI, outside app.asar.
 * @param {{resourcesPath?: string, defaultApp?: boolean}} [runtime] Electron runtime.
 * @param {string} [sourceDirectory] Development module directory.
 * @returns {string|null} Verified fixed resource path or null to fail closed.
 * @since 0.19.2-beta
 */
function resolvePodmanConfigPath(runtime = process, sourceDirectory = __dirname) {
  // Electron exposes resourcesPath during development too. ASAR module location
  // selects the packaged resource; ordinary source modules use their own overlay.
  const packaged = sourceDirectory.split(/[/\\]/).some((part) => /\.asar$/i.test(part));
  const directory = packaged ? runtime.resourcesPath : sourceDirectory;
  if (
    typeof directory !== 'string' ||
    !path.isAbsolute(directory) ||
    directory.split(/[/\\]/).some((part) => /\.asar$/i.test(part))
  )
    return null;
  const file = path.join(directory, CONFIG_NAME);
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024) return null;
    if (fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n') !== CONFIG_CONTENT) return null;
    return file;
  } catch {
    return null;
  }
}

/** Revalidate native-local selectors and the final overlay before every spawn.
 * @returns {object|null} Scrubbed child environment or null to refuse the query.
 * @since 0.19.2-beta
 */
function localEnvironment() {
  if (Object.entries(process.env).some(([key, value]) => REMOTE_ENV.test(key) && value))
    return null;
  const configPath = resolvePodmanConfigPath();
  if (!configPath) return null;
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !SCRUB_ENV.test(key)),
  );
  env.CONTAINERS_CONF_OVERRIDE = configPath;
  return env;
}

/** Discard transport error text.
 * @param {unknown} error CLI failure.
 * @returns {string} Fixed public reason.
 */
function failureReason(error) {
  if (error?.code === 'ENOENT') return 'cli-missing';
  if (error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return 'invalid-output';
  if (error?.killed === true || error?.code === 'ETIMEDOUT') return 'timeout';
  return 'runtime-unavailable';
}

/** Create a bounded Linux-native observer, without starting machines or services.
 * @param {{execFile?: Function, now?: Function, platform?: string, onUpdate?: Function}} [options]
 * @returns {{refresh: Function, snapshot: Function, stop: Function}} Discovery lifecycle.
 * @since 0.19.2-beta
 */
function createPodmanDiscovery(options = {}) {
  const execFile = options.execFile || defaultExecFile;
  const now = options.now || Date.now;
  const platform = options.platform || process.platform;
  let state = {
    status: 'pending',
    reason: null,
    observedAt: null,
    attemptedAt: null,
    candidates: [],
  };
  let inFlight = null;
  let activeChild = null;
  let cancel = null;
  let stopped = false;

  /** Return a copied observation; snapshot reads never start work.
   * @returns {object} Dated discovery snapshot.
   * @since 0.19.2-beta
   */
  function snapshot() {
    const age = state.observedAt === null ? null : now() - state.observedAt;
    return {
      ...state,
      stale: stopped || state.status !== 'ready' || age === null || age < 0 || age >= FRESH_MS,
      candidates: state.candidates.map((candidate) => ({
        ...candidate,
        ...(candidate.configuration ? { configuration: { ...candidate.configuration } } : {}),
      })),
    };
  }

  /** Fixed metadata-only query.
   * @param {object} env Sanitized child environment with the verified final overlay.
   * @param {string|null} id Validated fresh candidate ID or null for discovery.
   * @param {number} timeout Remaining bounded request budget.
   * @returns {Promise<object>} A result without CLI error or stderr content.
   */
  function query(env, id = null, timeout = 3000) {
    return new Promise((resolve) => {
      let settled = false;
      let deadline = null;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        activeChild = null;
        cancel = null;
        resolve(result);
      };
      cancel = () => finish({ cancelled: true });
      // execFile can wait indefinitely for exit after its timeout signal. Settle
      // independently and kill only this query's owned Linux CLI.
      deadline = setTimeout(() => {
        const child = activeChild;
        finish({ reason: 'timeout' });
        try {
          child?.kill('SIGKILL');
        } catch {
          /* The deadline settles even if child termination fails. */
        }
      }, timeout);
      try {
        const child = execFile(
          '/usr/bin/podman',
          id
            ? [
                ...ARGS.slice(0, 3),
                'container',
                'inspect',
                '--format',
                PODMAN_CONFIGURATION_FORMAT,
                id,
              ]
            : [...ARGS],
          {
            timeout,
            killSignal: 'SIGKILL',
            maxBuffer: id ? CONFIGURATION_OUTPUT_BYTES : MAX_OUTPUT_BYTES,
            windowsHide: true,
            shell: false,
            encoding: 'utf8',
            env,
          },
          (error, stdout) => {
            if (settled) return;
            if (error) return finish({ reason: failureReason(error) });
            if (id) return finish({ configuration: parseConfiguration(stdout, id, now()) });
            const candidates = parseContainerOutput(stdout, 'podman');
            finish(candidates === null ? { reason: 'invalid-output' } : { candidates });
          },
        );
        if (!settled) activeChild = child;
      } catch (error) {
        finish({ reason: failureReason(error) });
      }
    });
  }

  /** Coalesce/throttle queries; retain dated rows on failure, retire on empty success.
   * @returns {Promise<object>} Copied snapshot after settling; this promise never rejects.
   * @since 0.19.2-beta
   */
  function refresh() {
    if (stopped) return Promise.resolve(snapshot());
    if (inFlight) return inFlight;
    const attemptedAt = now();
    if (
      state.attemptedAt !== null &&
      attemptedAt >= state.attemptedAt &&
      attemptedAt - state.attemptedAt < CADENCE_MS
    )
      return Promise.resolve(snapshot());
    state = { ...state, attemptedAt };
    // Install the owner before execution, including synchronous test callbacks.
    inFlight = Promise.resolve()
      .then(async () => {
        if (stopped) return snapshot();
        let outcome;
        if (platform !== 'linux') outcome = { reason: 'unsupported-platform' };
        else {
          const environment = localEnvironment();
          outcome = environment ? await query(environment) : { reason: 'remote-config' };
        }
        const discoveryObservedAt = outcome.candidates ? now() : null;
        if (!stopped && outcome.candidates?.length) {
          // Bound the entire serial inspection batch, independently of the discovery request.
          const deadline = performance.now() + CONFIGURATION_TIMEOUT_MS;
          for (const [index, candidate] of outcome.candidates.entries()) {
            candidate.configuration = { status: 'unavailable', observedAt: null };
            const remaining = Math.floor(deadline - performance.now());
            if (stopped || index >= MAX_CONFIGURATION_CANDIDATES || remaining <= 0) continue;
            // Reverify the overlay and selectors for every invocation; fail closed if they changed.
            const environment = localEnvironment();
            if (!environment) break;
            const queryBudget = Math.floor(deadline - performance.now());
            if (queryBudget <= 0) break;
            const inspection = await query(environment, candidate.containerId, queryBudget);
            if (inspection.configuration) candidate.configuration = inspection.configuration;
            if (inspection.cancelled || inspection.reason === 'timeout') break;
          }
          for (const candidate of outcome.candidates)
            candidate.configuration ||= { status: 'unavailable', observedAt: null };
        }
        if (!stopped) {
          state = outcome.candidates
            ? {
                status: 'ready',
                reason: null,
                observedAt: discoveryObservedAt,
                attemptedAt,
                candidates: outcome.candidates,
              }
            : { ...state, status: 'unavailable', reason: outcome.reason || 'runtime-unavailable' };
          try {
            options.onUpdate?.(snapshot());
          } catch {
            /* Own no caller logging. */
          }
        }
        return snapshot();
      })
      .catch(() => {
        if (!stopped) state = { ...state, status: 'unavailable', reason: 'runtime-unavailable' };
        return snapshot();
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  /** Permanently stop this owner and suppress late CLI results.
   * @returns {void}
   * @since 0.19.2-beta
   */
  function stop() {
    if (stopped) return;
    stopped = true;
    const child = activeChild;
    cancel?.();
    try {
      child?.kill('SIGKILL');
    } catch {
      /* Completed processes need no cleanup. */
    }
  }
  return { refresh, snapshot, stop };
}

module.exports = { createPodmanDiscovery, resolvePodmanConfigPath };
