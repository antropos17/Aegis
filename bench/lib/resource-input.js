'use strict';

const LIMITS = Object.freeze({ samples: 2048, lifetimes: 256, rows: 16384, bytes: 2097152 });
const fail = () => {
  throw new Error('resource-input-invalid');
};
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const id = (value) => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(value);
function object(value, keys) {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail();
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (
    keys.some((k) => !Object.hasOwn(descriptors, k)) ||
    own.some(
      (k) =>
        typeof k !== 'string' ||
        !Object.hasOwn(descriptors[k], 'value') ||
        !descriptors[k].enumerable,
    )
  )
    fail();
}
function array(value, maximum) {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    value.length > maximum ||
    Reflect.ownKeys(value).length !== value.length + 1 ||
    Object.keys(value).length !== value.length ||
    Object.values(Object.getOwnPropertyDescriptors(value)).some((d) => !Object.hasOwn(d, 'value'))
  )
    fail();
}
function unique(rows, key) {
  if (new Set(rows.map(key)).size !== rows.length) fail();
}

/** Validate and copy one closed, bounded raw-counter run without I/O or coercion.
 * @param {object} input @returns {object} @since v0.19.2
 */
function resourceInput(input) {
  object(input, [
    'version',
    'runId',
    'cadenceUs',
    'sampleWindow',
    'units',
    'provenance',
    'memory',
    'phases',
    'cohorts',
    'lifetimes',
    'samples',
  ]);
  if (input.version !== 'resource-intervals/1' || !id(input.runId) || input.cadenceUs !== 1000000)
    fail();
  object(input.sampleWindow, ['startUs', 'endUs']);
  const window = input.sampleWindow;
  if (
    !integer(window.startUs) ||
    !integer(window.endUs) ||
    window.endUs < window.startUs ||
    (window.endUs - window.startUs) % input.cadenceUs !== 0 ||
    (window.endUs - window.startUs) / input.cadenceUs + 1 > LIMITS.samples
  )
    fail();
  object(input.units, ['wall', 'cpu', 'memory']);
  if (input.units.wall !== 'us' || input.units.cpu !== 'us' || input.units.memory !== 'bytes')
    fail();
  object(input.provenance, ['collectorId', 'clockId', 'sourceSha256']);
  if (
    !id(input.provenance.collectorId) ||
    !id(input.provenance.clockId) ||
    typeof input.provenance.sourceSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(input.provenance.sourceSha256)
  )
    fail();
  object(input.memory, ['platform', 'definition', 'api', 'sharedPages']);
  if (
    typeof input.memory.platform !== 'string' ||
    { win32: 'working-set', linux: 'rss', darwin: 'resident-size' }[input.memory.platform] !==
      input.memory.definition ||
    !['win32', 'linux', 'darwin'].includes(input.memory.platform) ||
    !id(input.memory.api) ||
    input.memory.sharedPages !== 'may-double-count'
  )
    fail();
  array(input.phases, 16);
  array(input.cohorts, 16);
  array(input.lifetimes, LIMITS.lifetimes);
  array(input.samples, LIMITS.samples);
  if (input.samples.length * Math.max(input.lifetimes.length, input.cohorts.length) > LIMITS.rows)
    fail();
  if (!input.phases.length || !input.cohorts.length || input.cohorts.some((c) => !id(c))) fail();
  unique(input.cohorts, (c) => c);
  for (const phase of input.phases) {
    object(phase, ['id', 'kind', 'steady', 'startUs', 'endUs']);
    if (
      !id(phase.id) ||
      !['warmup', 'idle', 'workload', 'burst', 'drain'].includes(phase.kind) ||
      typeof phase.steady !== 'boolean' ||
      (phase.kind === 'warmup' && phase.steady) ||
      !integer(phase.startUs) ||
      !integer(phase.endUs) ||
      phase.endUs <= phase.startUs
    )
      fail();
  }
  unique(input.phases, (p) => p.id);
  for (let i = 1; i < input.phases.length; i++)
    if (input.phases[i].startUs < input.phases[i - 1].endUs) fail();
  for (const life of input.lifetimes) {
    object(life, ['id', 'pid', 'cohort', 'startUs', 'endUs']);
    if (
      !id(life.id) ||
      !input.cohorts.includes(life.cohort) ||
      !integer(life.pid) ||
      life.pid === 0 ||
      life.pid > 2147483647 ||
      !integer(life.startUs) ||
      (life.endUs !== null && (!integer(life.endUs) || life.endUs <= life.startUs))
    )
      fail();
  }
  unique(input.lifetimes, (l) => l.id);
  for (let i = 0; i < input.lifetimes.length; i++)
    for (let j = i + 1; j < input.lifetimes.length; j++) {
      const a = input.lifetimes[i],
        b = input.lifetimes[j];
      if (a.pid === b.pid && a.startUs < (b.endUs ?? Infinity) && b.startUs < (a.endUs ?? Infinity))
        fail();
    }
  const lives = new Set(input.lifetimes.map((l) => l.id));
  let count = 0;
  for (const sample of input.samples) {
    object(sample, ['id', 'scheduledUs', 'actualUs', 'populationKnown', 'members']);
    if (
      !id(sample.id) ||
      !integer(sample.scheduledUs) ||
      !integer(sample.actualUs) ||
      typeof sample.populationKnown !== 'boolean'
    )
      fail();
    if (
      sample.scheduledUs < window.startUs ||
      sample.scheduledUs > window.endUs ||
      (sample.scheduledUs - window.startUs) % input.cadenceUs !== 0
    )
      fail();
    array(sample.members, LIMITS.lifetimes);
    count += sample.members.length;
    if (count > LIMITS.rows) fail();
    for (const member of sample.members) {
      object(member, ['lifetime', 'userUs', 'kernelUs', 'residentBytes']);
      if (
        !lives.has(member.lifetime) ||
        ['userUs', 'kernelUs', 'residentBytes'].some(
          (k) => member[k] !== null && !integer(member[k]),
        )
      )
        fail();
    }
    unique(sample.members, (m) => m.lifetime);
  }
  unique(input.samples, (s) => s.id);
  const encoded = JSON.stringify(input);
  if (Buffer.byteLength(encoded) > LIMITS.bytes) fail();
  return JSON.parse(encoded);
}

module.exports = { resourceInput, LIMITS };
