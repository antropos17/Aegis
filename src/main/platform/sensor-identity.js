/**
 * @file sensor-identity.js
 * @description Pure sensor/1 identity validation and host-owned birth conversion.
 * Observation freshness belongs to callers; no per-PID values or clocks live here.
 * @since 0.19.2-beta
 */
'use strict';
const { readRecord } = require('./sensor-protocol-data');

const U64_MAX = 18446744073709551615n;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const UNAVAILABLE = new Set(['read-failed', 'process-gone', 'not-supported']);

function invalid() {
  return Object.assign(new Error('sensor-identity-invalid'), { code: 'sensor-identity-invalid' });
}

function data(value, keys, options) {
  try {
    return readRecord(value, keys, options);
  } catch {
    throw invalid();
  }
}

function decimal(value, positive = false) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value) || (positive && value === '0'))
    throw invalid();
  return BigInt(value);
}

function u64(value, positive = false) {
  if (typeof value !== 'string' || value.length > 20) throw invalid();
  if (decimal(value, positive) > U64_MAX) throw invalid();
  return value;
}

function platformName(platform) {
  if (platform !== 'linux' && platform !== 'darwin') throw invalid();
  return platform;
}

function uuid(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw invalid();
  return value;
}

/**
 * Extract/copy identity from a carrying observation. Other row fields are ignored;
 * the codec separately checks the complete row's closed shape.
 * @param {object} value
 * @param {{platform?: 'linux'|'darwin'}} [options]
 * @returns {{birth: string|null, witness: object|null, identityError: string|null}}
 * @since 0.19.2-beta
 */
function validateSensorIdentity(value, options = {}) {
  const { platform } = data(options, ['platform'], { optional: ['platform'] });
  if (platform !== undefined) platformName(platform);
  const { birth, witness, identityError } = data(value, ['birth', 'witness', 'identityError'], {
    closed: false,
  });
  if (birth === null && witness === null && UNAVAILABLE.has(identityError))
    return { birth: null, witness: null, identityError };
  if (identityError !== null) throw invalid();
  const { kind } = data(witness, ['kind'], { closed: false });
  u64(birth);
  let copy;
  if (kind === 'linux-start-ticks') {
    if (platform !== undefined && platform !== 'linux') throw invalid();
    const checked = data(witness, ['kind', 'bootId', 'startTicks']);
    if (u64(checked.startTicks) !== birth) throw invalid();
    copy = { kind, bootId: uuid(checked.bootId), startTicks: birth };
  } else if (kind === 'macos-unique-id') {
    if (platform !== undefined && platform !== 'darwin') throw invalid();
    const checked = data(witness, ['kind', 'bootSessionId', 'pUniqueId']);
    copy = {
      kind,
      bootSessionId: uuid(checked.bootSessionId),
      pUniqueId: u64(checked.pUniqueId, true),
    };
  } else throw invalid();
  return { birth, witness: copy, identityError: null };
}

/**
 * Build a watch root only from one available carrying observation.
 * @param {object} observation
 * @param {{platform: 'linux'|'darwin'}} options
 * @returns {{pid: number, birth: string, witness: object}}
 * @since 0.19.2-beta
 */
function createWatchRoot(observation, options = {}) {
  const { platform } = data(options, ['platform']);
  platformName(platform);
  const { birth, witness } = validateSensorIdentity(observation, { platform });
  const { pid } = data(observation, ['pid'], { closed: false });
  if (birth === null || !Number.isInteger(pid) || pid <= 0 || pid > 2147483647) throw invalid();
  return { pid, birth, witness };
}

function copyLinuxContext(context) {
  const checked = data(context, ['bootId', 'bootTimeSeconds', 'clockTicks']);
  const bootId = uuid(checked.bootId);
  const bootTimeSeconds = decimal(checked.bootTimeSeconds, true);
  const clockTicks = decimal(checked.clockTicks, true);
  if (
    bootTimeSeconds > BigInt(Number.MAX_SAFE_INTEGER) ||
    clockTicks > BigInt(Number.MAX_SAFE_INTEGER)
  )
    throw invalid();
  return { bootId, bootTimeSeconds, clockTicks };
}

function safeMillis(value) {
  if (value <= 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) throw invalid();
  return Number(value);
}

function convertLinuxTicks(ticks, { bootTimeSeconds, clockTicks }) {
  const raw = typeof ticks === 'bigint' ? ticks : decimal(ticks);
  if (raw < 0n) throw invalid();
  return safeMillis(bootTimeSeconds * 1000n + (raw * 1000n) / clockTicks);
}

/**
 * Capture a validated host boot context, then convert fresh ticks. Runtime procfs
 * BigInts may exceed wire u64; only the positive safe final milliseconds bound
 * this generic conversion. Wire identities are validated separately.
 * @param {{bootId: string, bootTimeSeconds: string, clockTicks: string}} context
 * @returns {(ticks: bigint|string) => number}
 * @since 0.19.2-beta
 */
function createLinuxBirthConverter(context) {
  const pinned = copyLinuxContext(context);
  return (ticks) => convertLinuxTicks(ticks, pinned);
}

/**
 * Normalize one carrying observation without recovering missing identity.
 * @param {object} observation
 * @param {{platform: 'linux'|'darwin', linuxContext?: object}} options
 * @returns {{startTime: number|null, rawBirth: string|null, witness: string|null,
 *   witnessSource: string|null}}
 * @since 0.19.2-beta
 */
function convertSensorIdentity(observation, options = {}) {
  const { platform, linuxContext } = data(options, ['platform', 'linuxContext'], {
    optional: ['linuxContext'],
  });
  platformName(platform);
  const { birth, witness } = validateSensorIdentity(observation, { platform });
  if (birth === null)
    return { startTime: null, rawBirth: null, witness: null, witnessSource: null };
  if (platform === 'linux') {
    const context = copyLinuxContext(linuxContext);
    if (witness.bootId !== context.bootId) throw invalid();
    return {
      startTime: convertLinuxTicks(birth, context),
      rawBirth: birth,
      witness: `${witness.bootId}:${witness.startTicks}`,
      witnessSource: 'linuxStartTicks',
    };
  }
  return {
    startTime: safeMillis(BigInt(birth) / 1000n),
    rawBirth: birth,
    witness: `${witness.bootSessionId}:${witness.pUniqueId}`,
    witnessSource: 'macosUniqueId',
  };
}

module.exports = {
  validateSensorIdentity,
  createWatchRoot,
  convertSensorIdentity,
  createLinuxBirthConverter,
};
