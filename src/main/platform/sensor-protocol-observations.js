/** @file Pure sensor/1 observation projection. @since 0.19.2-beta */
'use strict';
const net = require('node:net');
const { validateSensorIdentity } = require('./sensor-identity');
const { MODES, fail, exact, text, integer, u64, choice } = require('./sensor-protocol-values');
const IDENTITY_KEYS = ['birth', 'witness', 'identityError'];
const BASE_EVENT = ['seq', 'kind', 'pid', 'ppid', ...IDENTITY_KEYS, 'ts'];
const EXTRAS = Object.freeze({
  exec: ['exe', 'argc'],
  open: ['path', 'access'],
  connect: ['family', 'daddr', 'dport', 'saddr', 'sport'],
  fork: [],
  exit: [],
});

/** @param {object} value @param {Set<string>} platforms @returns {object} @since 0.19.2-beta */
function identity(value, platforms) {
  let result;
  try {
    result = validateSensorIdentity(value);
  } catch {
    fail();
  }
  if (result.witness) platforms.add(result.witness.kind);
  if (platforms.size > 1) fail();
  return result;
}

/** @param {unknown} value @param {string} mode @returns {object} @since 0.19.2-beta */
function capabilities(value, mode) {
  const platform = MODES[mode];
  if (!Object.hasOwn(MODES, mode)) fail();
  const bools = ['exec', 'exit', 'fork', 'fileOpen', 'tcpConnect'];
  exact(value, [...bools, 'identity', 'witness']);
  const result = {};
  for (const key of bools) {
    if (typeof value[key] !== 'boolean') fail();
    result[key] = value[key];
  }
  const expected =
    platform === 'linux'
      ? mode === 'ebpf'
        ? 'bpf-start-boottime-ticks'
        : 'procfs-ticks'
      : 'pbi-start-usec';
  if (
    value.identity !== expected ||
    value.witness !== (platform === 'linux' ? 'boot-id' : 'p-uniqueid') ||
    (mode === 'libproc' && value.fileOpen)
  )
    fail();
  return { ...result, identity: expected, witness: value.witness };
}

/** @param {unknown} value @param {string} platform @returns {object} @since 0.19.2-beta */
function versions(value, platform) {
  const os = platform === 'linux' ? 'kernel' : 'os';
  exact(value, ['sensor', os, 'clockAnchor']);
  const anchor = value.clockAnchor;
  exact(anchor, ['clock', 'monotonicUsec', 'unixUsec']);
  if (anchor.clock !== (platform === 'linux' ? 'boottime' : 'mach-continuous')) fail();
  return {
    sensor: text(value.sensor, 128),
    [os]: text(value[os], 128),
    clockAnchor: {
      clock: anchor.clock,
      monotonicUsec: u64(anchor.monotonicUsec, false),
      unixUsec: u64(anchor.unixUsec, false),
    },
  };
}

/** @param {object} value @param {Set<string>} platforms @returns {object} @since 0.19.2-beta */
function processRow(value, platforms) {
  exact(value, ['pid', 'ppid', 'name', ...IDENTITY_KEYS]);
  return {
    pid: integer(value.pid, 1, 2147483647),
    ppid: integer(value.ppid, 0, 2147483647),
    name: text(value.name, 256),
    ...identity(value, platforms),
  };
}

/** @param {object} value @param {Set<string>} platforms @returns {object} @since 0.19.2-beta */
function watchRoot(value, platforms) {
  exact(value, ['pid', 'birth', 'witness']);
  const checked = identity({ ...value, identityError: null }, platforms);
  if (checked.birth === null) fail();
  return { pid: integer(value.pid, 1, 2147483647), birth: checked.birth, witness: checked.witness };
}

/** @param {object} value @param {Set<string>} platforms @returns {object} @since 0.19.2-beta */
function event(value, platforms) {
  if (!value || typeof value.kind !== 'string' || !Object.hasOwn(EXTRAS, value.kind)) fail();
  exact(value, [...BASE_EVENT, ...EXTRAS[value.kind]]);
  const result = {
    seq: u64(value.seq),
    kind: value.kind,
    pid: integer(value.pid, 1, 2147483647),
    ppid: integer(value.ppid, 0, 2147483647),
    ...identity(value, platforms),
    ts: u64(value.ts, false),
  };
  if (value.kind === 'exec') {
    result.exe = text(value.exe, 4096);
    result.argc = integer(value.argc, 0, 4294967295);
  } else if (value.kind === 'open') {
    result.path = text(value.path, 4096);
    result.access = choice(value.access, ['read', 'write', 'read-write', 'execute']);
  } else if (value.kind === 'connect') {
    result.family = choice(value.family, [4, 6]);
    for (const key of ['daddr', 'saddr']) {
      if (
        typeof value[key] !== 'string' ||
        value[key].includes('%') ||
        net.isIP(value[key]) !== value.family
      )
        fail();
    }
    result.daddr = value.daddr;
    result.dport = integer(value.dport, 0, 65535);
    result.saddr = value.saddr;
    result.sport = integer(value.sport, 0, 65535);
  }
  return result;
}

module.exports = { capabilities, versions, processRow, watchRoot, event };
