/**
 * @file wsl-detector.js
 * @module main/wsl-detector
 * @description Passive WSL process-coverage compatibility boundary. Guest process
 *   enumeration is unavailable: invoking a guest command can start a stopped
 *   default distro, even after a separate running-distro check. Scan callers get
 *   an empty agent array and an explicit unsupported coverage record. Empty output
 *   from this boundary does not establish that no WSL agents are running.
 * @license MIT
 * @since v0.11.0-alpha
 */
'use strict';

const sensorHealth = require('./sensor-health');

/** WSL guest-process discovery sensor id. */
const WSL_SENSOR_ID = 'wsl';

let _getPlatform = () => process.platform;

/**
 * Describe unavailable guest-process coverage without claiming an observation.
 * Unsupported capabilities stay visible in app health and do not participate in
 * the aggregate worst-of. This record never asserts WSL installation or absence.
 * @returns {import('./sensor-health').SensorHealth}
 */
function createInitialHealth() {
  return sensorHealth.createUnsupported(WSL_SENSOR_ID, {
    detail: _getPlatform() === 'win32' ? 'wsl-process-coverage-unavailable' : 'platform-no-wsl',
  });
}

let _health = createInitialHealth();

/**
 * Plain detached snapshot for the app-health composer.
 * @returns {object}
 * @since 0.13.0
 */
function getWslSensorHealth() {
  return sensorHealth.toPlain(_health);
}

/**
 * Retain the async discovery API without executing commands inside a distro.
 * The empty result represents unavailable coverage, not observed agent absence.
 * @returns {Promise<Array<Object>>}
 * @since v0.11.0-alpha
 */
async function detectWslAgents() {
  return [];
}

/**
 * Return no synthetic guest-process agents and schedule no background work.
 * @returns {Array<Object>}
 * @since v0.11.0-alpha
 */
function getCachedWslAgents() {
  return [];
}

/**
 * @internal Override the platform for tests. Legacy execFile overrides are accepted
 *   for compatibility with shared harnesses, but no subprocess dependency exists.
 * @param {{ execFile?: Function, platform?: string }} overrides
 * @returns {void}
 * @since v0.11.0-alpha
 */
function _setDepsForTest(overrides) {
  if (overrides.platform) {
    _getPlatform = () => overrides.platform;
    _health = createInitialHealth();
  }
}

/**
 * @internal Reset the platform and coverage record for tests.
 * @returns {void}
 * @since v0.11.0-alpha
 */
function _resetForTest() {
  _getPlatform = () => process.platform;
  _health = createInitialHealth();
}

module.exports = {
  detectWslAgents,
  getCachedWslAgents,
  getWslSensorHealth,
  WSL_SENSOR_ID,
  _setDepsForTest,
  _resetForTest,
};
