/** @file Optional private sensor/1 metadata custody; no producer, attribution or capture authority.
 * Objects are closed, at most four levels deep, with no arrays; strings have fixed bounds.
 * A capsule records declarations only. Missing clock anchors remain null and uncalibrated.
 * @since 0.19.2-beta */
'use strict';
const { readRecord } = require('./platform/sensor-protocol-data');
const {
  validateSensorIdentity,
  convertSensorIdentity,
  createLinuxBirthConverter,
} = require('./platform/sensor-identity');
const VERSION = 'native-observation/1';
const MAX_BYTES = 2048;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;
const REASONS = new Set([
  'native-observation-invalid',
  'identity-context-unavailable',
  'native-observation-over-budget',
]);
const MODES = {
  linux: ['ebpf', 'fanotify', 'procfs'],
  darwin: ['endpoint-security', 'libproc'],
};
function invalid() {
  throw new Error('native-observation-invalid');
}
function u64(value, positive = false) {
  if (
    typeof value !== 'string' ||
    value.length > 20 ||
    !/^(0|[1-9][0-9]*)$/.test(value) ||
    BigInt(value) > 18446744073709551615n ||
    (positive && value === '0')
  )
    invalid();
}
function integer(value, positive = false) {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) invalid();
}
function equalRecord(value, expected) {
  const checked = readRecord(value, Object.keys(expected));
  if (Object.keys(expected).some((key) => checked[key] !== expected[key])) invalid();
}
function anchor(value, platform) {
  if (value === null) return null;
  const checked = readRecord(value, ['clock', 'monotonicUsec', 'unixUsec']);
  if (checked.clock !== (platform === 'linux' ? 'boottime' : 'mach-continuous')) invalid();
  u64(checked.monotonicUsec);
  u64(checked.unixUsec);
  return { ...checked };
}

/** Preserve the old event when optional custody metadata is invalid or cannot fit.
 * @param {string} [reason] Closed unavailability code.
 * @returns {object} Fixed unavailable capsule, without rejected values.
 * @since 0.19.2-beta */
function unavailableNativeObservation(reason = 'native-observation-invalid') {
  return {
    version: VERSION,
    state: 'unavailable',
    reason: REASONS.has(reason) ? reason : 'native-observation-invalid',
  };
}

/** Detach a closed optional capsule; no identity or clock is recovered from a cache.
 * Required recorded keys: version/state/source/platform/mode/observation/identity/
 * birthContext. Optional clockAnchor defaults to null; capture and normalizationError
 * are derived and checked when supplied, including on replay.
 * source = {ownerEpoch: UUID, generation: positive safe integer}; observation is
 * sensor/1's BASE_EVENT only, excluding paths, executable names and arguments.
 * Available identity must match the existing conversion with the supplied historical
 * D1 context. Without that context, raw identity survives while normalized identity
 * is null. Arithmetic consistency never establishes the truth of supplied proof.
 * @param {*} value Optional metadata; undefined preserves historical absence.
 * @returns {object|undefined} Detached bounded metadata or fixed unavailability.
 * @since 0.19.2-beta */
function projectNativeObservation(value) {
  if (value === undefined) return undefined;
  try {
    const state = readRecord(value, ['version', 'state'], { closed: false });
    if (state.version !== VERSION) invalid();
    if (state.state === 'unavailable') {
      const row = readRecord(value, ['version', 'state', 'reason']);
      if (!REASONS.has(row.reason)) invalid();
      return unavailableNativeObservation(row.reason);
    }
    const row = readRecord(
      value,
      [
        'version',
        'state',
        'source',
        'platform',
        'mode',
        'observation',
        'identity',
        'birthContext',
        'clockAnchor',
        'capture',
        'normalizationError',
      ],
      { optional: ['capture', 'normalizationError', 'clockAnchor'] },
    );
    if (
      row.state !== 'recorded' ||
      typeof row.platform !== 'string' ||
      typeof row.mode !== 'string' ||
      !Object.hasOwn(MODES, row.platform) ||
      !MODES[row.platform].includes(row.mode)
    )
      invalid();
    const source = readRecord(row.source, ['ownerEpoch', 'generation']);
    if (
      typeof source.ownerEpoch !== 'string' ||
      source.ownerEpoch.length !== 36 ||
      !UUID.test(source.ownerEpoch)
    )
      invalid();
    integer(source.generation, true);
    const raw = readRecord(row.observation, [
      'seq',
      'kind',
      'pid',
      'ppid',
      'birth',
      'witness',
      'identityError',
      'ts',
    ]);
    u64(raw.seq, true);
    u64(raw.ts);
    integer(raw.pid, true);
    integer(raw.ppid);
    if (
      raw.pid > 2147483647 ||
      raw.ppid > 2147483647 ||
      !['exec', 'exit', 'fork', 'open', 'connect'].includes(raw.kind)
    )
      invalid();
    const observedIdentity = validateSensorIdentity(raw, { platform: row.platform });
    let birthContext = null;
    if (row.birthContext !== null) {
      if (row.platform !== 'linux') invalid();
      birthContext = {
        ...readRecord(row.birthContext, ['bootId', 'bootTimeSeconds', 'clockTicks']),
      };
      // Bound decimal spelling before the existing D1 helper constructs BigInts.
      for (const key of ['bootTimeSeconds', 'clockTicks']) u64(birthContext[key], true);
      createLinuxBirthConverter(birthContext);
    }
    const contextMissing = row.platform === 'linux' && raw.birth !== null && birthContext === null;
    let identity = null;
    const normalizationError = contextMissing ? 'identity-context-unavailable' : raw.identityError;
    if (contextMissing) {
      // Retain valid raw evidence, but do not publish an unproved normalized birth.
      if (row.identity !== null) {
        const reported = readRecord(row.identity, [
          'startTime',
          'rawBirth',
          'witness',
          'witnessSource',
        ]);
        integer(reported.startTime, true);
        equalRecord(row.identity, {
          startTime: reported.startTime,
          rawBirth: raw.birth,
          witness: `${observedIdentity.witness.bootId}:${raw.birth}`,
          witnessSource: 'linuxStartTicks',
        });
      }
    } else {
      identity = convertSensorIdentity(raw, {
        platform: row.platform,
        ...(birthContext === null ? {} : { linuxContext: birthContext }),
      });
      equalRecord(row.identity, identity);
    }
    if (row.normalizationError !== undefined && row.normalizationError !== normalizationError)
      invalid();
    const milliseconds = BigInt(raw.ts) / 1000n;
    const capture = {
      epochMs: milliseconds <= 8640000000000000n ? Number(milliseconds) : null,
      reason: milliseconds <= 8640000000000000n ? null : 'capture-out-of-range',
      calibrated: false,
    };
    if (row.capture !== undefined) equalRecord(row.capture, capture);
    const result = {
      version: VERSION,
      state: 'recorded',
      source: { ...source },
      platform: row.platform,
      mode: row.mode,
      observation: { ...raw, ...observedIdentity },
      identity,
      normalizationError,
      birthContext,
      clockAnchor: anchor(row.clockAnchor ?? null, row.platform),
      capture,
    };
    return Buffer.byteLength(JSON.stringify(result)) <= MAX_BYTES
      ? result
      : unavailableNativeObservation('native-observation-over-budget');
  } catch {
    return unavailableNativeObservation();
  }
}
module.exports = { MAX_BYTES, projectNativeObservation, unavailableNativeObservation };
