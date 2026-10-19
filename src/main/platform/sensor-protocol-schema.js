/** @file Stateless closed sensor/1 messages. @since 0.19.2-beta */
'use strict';
const {
  MODES,
  fail,
  exact,
  text,
  integer,
  u64,
  choice,
  array,
  unique,
} = require('./sensor-protocol-values');
const {
  capabilities,
  versions,
  processRow,
  watchRoot,
  event,
} = require('./sensor-protocol-observations');

const MODE_REASONS = [
  'startup-fallback',
  'permission-denied',
  'attach-failed',
  'read-failed',
  'recovery',
  'requested',
];
const LOSS_REASONS = ['ring-full', 'queue-full', 'verifier-limit', 'read-failed'];
const HEALTH = ['STARTING', 'HEALTHY', 'DEGRADED', 'FAILED', 'DISABLED', 'UNSUPPORTED'];
const DETAILS = [
  'starting',
  'ready',
  'permission-denied',
  'read-failed',
  'loss-observed',
  'sensor-failed',
  'disabled',
  'unsupported',
];
const ERRORS = [
  'request-failed',
  'root-mismatch',
  'permission-denied',
  'read-failed',
  'unsupported',
  'request-too-large',
];
const id = (value) => integer(value, 1, 4294967295);

function range(value) {
  const from = u64(value.from);
  const to = u64(value.to);
  if (BigInt(to) < BigInt(from)) fail();
  return { from, to, count: BigInt(to) - BigInt(from) + 1n };
}

function host(message) {
  const { t } = message;
  if (t === 'snap' || t === 'stop') {
    exact(message, ['t', 'id']);
    return { t, id: id(message.id) };
  }
  if (t === 'paths') {
    exact(message, ['t', 'id', 'prefixes']);
    const prefixes = array(message.prefixes, 1024).map((entry) => text(entry, 4096));
    unique(prefixes);
    return { t, id: id(message.id), prefixes };
  }
  if (t === 'watch') {
    exact(message, ['t', 'id', 'roots', 'descendants']);
    if (message.descendants !== true) fail();
    const platforms = new Set();
    const roots = array(message.roots, 4096).map((entry) => watchRoot(entry, platforms));
    unique(roots.map((entry) => entry.pid));
    return { t, id: id(message.id), roots, descendants: true };
  }
  fail();
}

function sensor(message) {
  const { t } = message;
  if (t === 'hello') {
    exact(message, ['t', 'proto', 'platform', 'mode', 'modes', 'caps', 'versions', 'pid']);
    if (typeof message.proto !== 'string') fail();
    if (message.proto !== 'sensor/1') fail('protocol-unsupported');
    const platform = choice(message.platform, ['linux', 'darwin']);
    const mode = choice(message.mode, Object.keys(MODES));
    const modes = array(message.modes, 5, 1).map((entry) => choice(entry, Object.keys(MODES)));
    unique(modes);
    if (!modes.includes(mode) || modes.some((entry) => MODES[entry] !== platform)) fail();
    return {
      t,
      proto: 'sensor/1',
      platform,
      mode,
      modes,
      caps: capabilities(message.caps, mode),
      versions: versions(message.versions, platform),
      pid: integer(message.pid, 1, 2147483647),
    };
  }
  if (t === 'mode') {
    exact(message, ['t', 'mode', 'caps', 'reason', 'seq']);
    const mode = choice(message.mode, Object.keys(MODES));
    return {
      t,
      mode,
      caps: capabilities(message.caps, mode),
      reason: choice(message.reason, MODE_REASONS),
      seq: u64(message.seq),
    };
  }
  if (t === 'evs') {
    exact(message, ['t', 'from', 'to', 'events']);
    const interval = range(message);
    const platforms = new Set();
    const events = array(message.events, 4096, 1).map((entry, index) => {
      const result = event(entry, platforms);
      if (BigInt(result.seq) !== BigInt(interval.from) + BigInt(index)) fail();
      return result;
    });
    if (interval.count !== BigInt(events.length)) fail();
    return { t, from: interval.from, to: interval.to, events };
  }
  if (t === 'loss') {
    exact(message, ['t', 'from', 'to', 'count', 'reason']);
    const interval = range(message);
    const count = u64(message.count);
    if (BigInt(count) !== interval.count) fail();
    return {
      t,
      from: interval.from,
      to: interval.to,
      count,
      reason: choice(message.reason, LOSS_REASONS),
    };
  }
  if (t === 'snap') {
    exact(message, ['t', 'id', 'procs']);
    const platforms = new Set();
    const procs = array(message.procs, 4096).map((entry) => processRow(entry, platforms));
    unique(procs.map((entry) => entry.pid));
    return { t, id: id(message.id), procs };
  }
  if (t === 'health') {
    exact(message, ['t', 'state', 'detail']);
    return { t, state: choice(message.state, HEALTH), detail: choice(message.detail, DETAILS) };
  }
  if (t === 'err') {
    exact(message, ['t', 'id', 'code']);
    return { t, id: id(message.id), code: choice(message.code, ERRORS) };
  }
  if (t === 'ack') {
    exact(message, ['t', 'id']);
    return { t, id: id(message.id) };
  }
  fail();
}

/** @param {object} message @param {string} direction @returns {object} @since 0.19.2-beta */
function projectMessage(message, direction) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) fail();
  return direction === 'host-to-sensor' ? host(message) : sensor(message);
}

module.exports = { projectMessage };
