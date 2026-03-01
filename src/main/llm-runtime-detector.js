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

let _http = http;

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
 * Make a GET request with timeout, returning parsed JSON or null.
 * @param {string} host
 * @param {number} port
 * @param {string} path
 * @returns {Promise<Object|null>}
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
            resolve(JSON.parse(data));
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.end();
  });
}

// ═══ PUBLIC API ═══

/**
 * Probe Ollama API at localhost:11434/api/tags for loaded models.
 * @returns {Promise<{running: boolean, models: string[]}>}
 * @since v0.4.0
 */
async function detectOllamaModels() {
  const body = await httpGet('127.0.0.1', OLLAMA_PORT, '/api/tags');
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
  const body = await httpGet('127.0.0.1', LM_STUDIO_PORT, '/v1/models');
  if (!body || !Array.isArray(body.data)) {
    return { running: false, models: [] };
  }
  const models = body.data.map((m) => m.id || '').filter(Boolean);
  return { running: true, models };
}

module.exports = {
  detectOllamaModels,
  detectLMStudioModels,
  _setDepsForTest,
  _resetForTest,
};
