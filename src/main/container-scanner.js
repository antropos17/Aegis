/**
 * @file container-scanner.js
 * @description Bounded running-container metadata discovery; an image match does
 * not establish agent activity, isolation, host access, network activity or trust.
 */
'use strict';
const { execFile: defaultExecFile } = require('node:child_process');
const { MAX_OUTPUT_BYTES, hasControl, parseContainerOutput } = require('./container-metadata');

const CADENCE_MS = 30000;
const FRESH_MS = 90000;
const FORMAT = '{"ID":{{json .ID}},"Image":{{json .Image}},"Names":{{json .Names}}}';
const PS_ARGS = ['ps', '--no-trunc', '--filter', 'status=running', '--format'];
const WINDOWS_ENDPOINTS = [
  'npipe:////./pipe/dockerDesktopLinuxEngine',
  'npipe:////./pipe/docker_engine',
];
// Docker CLI telemetry is opt-in through env; this observer must not inherit it.
// https://docs.docker.com/engine/cli/otel/
const SCRUB_ENV =
  /^(?:DOCKER_(?:HOST|CONTEXT|TLS|TLS_VERIFY|CERT_PATH|API_VERSION)$|DOCKER_CLI_OTEL_|OTEL_|TRACEPARENT$|TRACESTATE$)/i;
/** Discard CLI error text. @param {unknown} error @returns {string} Fixed token. */
function failureReason(error) {
  if (error?.code === 'ENOENT') return 'cli-missing';
  if (error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return 'invalid-output';
  if (error?.killed === true || error?.code === 'ETIMEDOUT') return 'timeout';
  return 'daemon-unavailable';
}

/** Validate local endpoint syntax. @param {string} host @returns {boolean} */
function isLocalHost(host) {
  return (
    (/^unix:\/\/\/(?!\/)\S+$/.test(host) && !hasControl(host)) ||
    WINDOWS_ENDPOINTS.some((endpoint) => endpoint.toLowerCase() === host.toLowerCase())
  );
}

/**
 * Create a passive owner: Windows queries Desktop Linux then standard pipe on
 * daemon failure (at most two 3s calls); others query the default local Unix socket.
 * Scrub inherited overrides; custom/rootless/remote endpoints are outside this slice.
 * @param {{execFile?: Function, now?: Function, platform?: string, onUpdate?: Function}} [options]
 * @returns {{refresh: Function, snapshot: Function, stop: Function}} Discovery lifecycle.
 * @since 0.19.2-beta
 */
function createDockerDiscovery(options = {}) {
  const execFile = options.execFile || defaultExecFile;
  const now = options.now || Date.now;
  const platform = options.platform || process.platform;
  const endpoints = platform === 'win32' ? WINDOWS_ENDPOINTS : ['unix:///var/run/docker.sock'];
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

  /** Return a dated copy; reads neither spawn nor refresh.
   * @returns {object} The complete serializable discovery snapshot.
   * @since 0.19.2-beta
   */
  function snapshot() {
    const age = state.observedAt === null ? null : now() - state.observedAt;
    return {
      ...state,
      stale: stopped || state.status !== 'ready' || age === null || age < 0 || age >= FRESH_MS,
      candidates: state.candidates.map((candidate) => ({ ...candidate })),
    };
  }

  /** Metadata-only query. @param {string} endpoint @param {object} env @returns {Promise<object>} */
  function query(endpoint, env) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        activeChild = null;
        cancel = null;
        resolve(result);
      };
      cancel = () => finish({ cancelled: true });
      try {
        const child = execFile(
          platform === 'win32' ? 'docker.exe' : 'docker',
          ['--host', endpoint, ...PS_ARGS, FORMAT],
          {
            timeout: 3000,
            maxBuffer: MAX_OUTPUT_BYTES,
            windowsHide: true,
            shell: false,
            encoding: 'utf8',
            env,
          },
          (error, stdout) => {
            if (error) return finish({ reason: failureReason(error) });
            const candidates = parseContainerOutput(stdout, 'docker');
            finish(candidates === null ? { reason: 'invalid-output' } : { candidates });
          },
        );
        if (!settled) activeChild = child;
      } catch (error) {
        finish({ reason: failureReason(error) });
      }
    });
  }

  /** Throttle/coalesce queries; failures retain dated candidates, empty success retires.
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
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !SCRUB_ENV.test(key)),
    );
    const remote = Object.entries(process.env).some(
      ([key, host]) => key.toUpperCase() === 'DOCKER_HOST' && host && !isLocalHost(host),
    );
    // Defer execution until the in-flight owner is installed, including sync test callbacks.
    inFlight = Promise.resolve()
      .then(async () => {
        let outcome = remote ? { reason: 'remote-endpoint' } : null;
        for (const endpoint of endpoints) {
          if (stopped || (outcome?.reason && outcome.reason !== 'daemon-unavailable')) break;
          outcome = await query(endpoint, env);
          if (outcome.cancelled || !outcome.reason) break;
        }
        if (!stopped) {
          state = outcome?.candidates
            ? {
                status: 'ready',
                reason: null,
                observedAt: now(),
                attemptedAt,
                candidates: outcome.candidates,
              }
            : { ...state, status: 'unavailable', reason: outcome?.reason || 'daemon-unavailable' };
          try {
            options.onUpdate?.(snapshot());
          } catch {
            /* The discovery owns no caller logging. */
          }
        }
        return snapshot();
      })
      .catch(() => {
        if (!stopped) state = { ...state, status: 'unavailable', reason: 'daemon-unavailable' };
        return snapshot();
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  /** Permanently stop this owner and suppress late results from its CLI.
   * @returns {void}
   * @since 0.19.2-beta
   */
  function stop() {
    if (stopped) return;
    stopped = true;
    const child = activeChild;
    cancel?.();
    try {
      child?.kill();
    } catch {
      /* A completed process needs no further cleanup. */
    }
  }

  return { refresh, snapshot, stop };
}

module.exports = { createDockerDiscovery };
