/**
 * @file llm-runtime-detector.js
 * @module main/llm-runtime-detector
 * @description Detects locally running LLM runtimes (Ollama, LM Studio, etc.)
 *   by probing their HTTP APIs. Complements process-scanner.js by discovering
 *   which models are loaded, not just that the process is running.
 * @author AEGIS Contributors
 * @license MIT
 * @version 0.1.0
 * @since v0.4.0
 */
'use strict';

const http = require('http');
const sensorHealth = require('./sensor-health');

let _http = http;

/** Local-runtime probe sensor ids (Block B3, finding B-S12). */
const OLLAMA_SENSOR_ID = 'llm-ollama';
const LM_STUDIO_SENSOR_ID = 'llm-lmstudio';

/**
 * One record per PROBE, not one shared by both runtimes.
 *
 * The two probes answer about two different servers and run concurrently (`Promise.all`
 * in scan-loop's `enrichWithLocalModels`), so a shared record would be written twice
 * per tick in an order nobody controls, and a definite LM Studio answer would erase an
 * uncertain Ollama one. That erasure is exactly the loss this block exists to stop.
 * @type {Record<string, import('./sensor-health').SensorHealth>}
 */
let _health = {
  [OLLAMA_SENSOR_ID]: sensorHealth.createSensorHealth(OLLAMA_SENSOR_ID),
  [LM_STUDIO_SENSOR_ID]: sensorHealth.createSensorHealth(LM_STUDIO_SENSOR_ID),
};

/**
 * Plain serializable snapshots for the app-health composer, keyed by sensor id —
 * callers must not mutate.
 * @returns {Record<string, object>}
 * @since 0.13.0
 */
function getLlmRuntimeSensorHealth() {
  return {
    [OLLAMA_SENSOR_ID]: sensorHealth.toPlain(_health[OLLAMA_SENSOR_ID]),
    [LM_STUDIO_SENSOR_ID]: sensorHealth.toPlain(_health[LM_STUDIO_SENSOR_ID]),
  };
}

/**
 * @internal Override http module (for tests).
 * @param {{ http?: Object }} overrides
 */
function _setDepsForTest(overrides) {
  if (overrides.http) _http = overrides.http;
}

/**
 * @internal Reset to real dependencies.
 */
function _resetForTest() {
  _http = http;
  _health = {
    [OLLAMA_SENSOR_ID]: sensorHealth.createSensorHealth(OLLAMA_SENSOR_ID),
    [LM_STUDIO_SENSOR_ID]: sensorHealth.createSensorHealth(LM_STUDIO_SENSOR_ID),
  };
}

// ═══ CONSTANTS ═══

/** @type {number} Request timeout in milliseconds */
const PROBE_TIMEOUT_MS = 2000;

/** @type {number} Ollama default API port */
const OLLAMA_PORT = 11434;

/** @type {number} LM Studio default API port (OpenAI-compatible) */
const LM_STUDIO_PORT = 1234;

// ═══ INTERNAL HELPERS ═══

/**
 * @typedef {Object} ProbeOutcome
 * @property {boolean} answered - true when the endpoint gave a verdict ABOUT ITSELF:
 *   a parsed body, a body that is not this runtime's, or a refused connection. False
 *   when the exchange produced no verdict at all.
 * @property {Object|null} body - parsed JSON when there was one
 * @property {string|null} reason - short transport token when `answered` is false
 */

/**
 * Make a GET request with timeout, returning what the exchange settled.
 *
 * B-S12: the old `null` collapsed "nothing is listening" into "the probe never got an
 * answer", and both surfaced as `running: false` — a runtime with models loaded read
 * exactly like one that is not installed. The two are separated here, at the only place
 * that can still tell them apart.
 * @param {string} host
 * @param {number} port
 * @param {string} urlPath
 * @returns {Promise<ProbeOutcome>}
 */
function httpGet(host, port, urlPath) {
  return new Promise((resolve) => {
    const req = _http.request(
      { hostname: host, port, path: urlPath, method: 'GET', timeout: PROBE_TIMEOUT_MS },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            resolve({ answered: true, body: JSON.parse(data), reason: null });
          } catch {
            // A COMPLETED exchange whose body is not this runtime's JSON. Something else
            // is bound to the port — 1234 is a stock dev-server port and collides often
            // — and "something else answered" is a definite verdict: this runtime is not
            // there. Calling it uncertain would leave a permanent DEGRADED on ordinary
            // machines, and a warning that is always on is not a warning.
            resolve({ answered: true, body: null, reason: null });
          }
        });
      },
    );
    req.on('error', (err) => {
      const code = err && typeof err.code === 'string' ? err.code : 'unknown';
      // ECONNREFUSED is the loudest negative there is: the kernel answered that nothing
      // is bound to that port. Every other transport failure leaves the question open.
      resolve(
        code === 'ECONNREFUSED'
          ? { answered: true, body: null, reason: null }
          : { answered: false, body: null, reason: code },
      );
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ answered: false, body: null, reason: 'timeout' });
    });
    req.end();
  });
}

/**
 * Write a probe's own outcome into its own record.
 *
 * `running: false` carries two different facts, and this is where they part: a refused
 * connection or a foreign body is a real negative OBSERVATION (HEALTHY — the answer is
 * "not running"), while a timeout or a broken transport is no observation at all
 * (DEGRADED — the runtime may be up with models loaded and nothing would say so).
 * `lastSuccessAt` therefore advances only on the first.
 * @param {string} id
 * @param {ProbeOutcome} outcome
 * @returns {void}
 */
function noteProbeOutcome(id, outcome) {
  const now = Date.now();
  _health[id] = outcome.answered
    ? sensorHealth.markHealthy(_health[id], now)
    : sensorHealth.markDegraded(_health[id], now, {
        error: `probe-unreachable:${outcome.reason || 'unknown'}`,
        detail: 'probe-unreachable',
      });
}

// ═══ PUBLIC API ═══

/**
 * Probe Ollama API at localhost:11434/api/tags for loaded models.
 * @returns {Promise<{running: boolean, models: string[]}>}
 * @since v0.4.0
 */
async function detectOllamaModels() {
  const outcome = await httpGet('127.0.0.1', OLLAMA_PORT, '/api/tags');
  noteProbeOutcome(OLLAMA_SENSOR_ID, outcome);
  const body = outcome.body;
  if (!body || !Array.isArray(body.models)) {
    return { running: false, models: [] };
  }
  const models = body.models.map((m) => m.name || m.model || '').filter(Boolean);
  return { running: true, models };
}

/**
 * Probe LM Studio API at localhost:1234/v1/models (OpenAI-compatible).
 * @returns {Promise<{running: boolean, models: string[]}>}
 * @since v0.4.0
 */
async function detectLMStudioModels() {
  const outcome = await httpGet('127.0.0.1', LM_STUDIO_PORT, '/v1/models');
  noteProbeOutcome(LM_STUDIO_SENSOR_ID, outcome);
  const body = outcome.body;
  if (!body || !Array.isArray(body.data)) {
    return { running: false, models: [] };
  }
  const models = body.data.map((m) => m.id || '').filter(Boolean);
  return { running: true, models };
}

module.exports = {
  detectOllamaModels,
  detectLMStudioModels,
  getLlmRuntimeSensorHealth,
  OLLAMA_SENSOR_ID,
  LM_STUDIO_SENSOR_ID,
  _setDepsForTest,
  _resetForTest,
};
