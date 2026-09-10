/**
 * @file network-monitor.js
 * @module main/network-monitor
 * @description Network connection scanning via PowerShell Get-NetTCPConnection,
 *   forward-confirmed reverse-DNS resolution with TTL cache, and allowlist-based
 *   classification of every remote endpoint into allowlisted / unknown / flagged.
 * @requires child_process
 * @requires dns
 * @requires fs
 * @requires path
 * @author AEGIS Contributors
 * @license MIT
 * @version 0.1.0
 */

'use strict';

const dns = require('dns');
const { isIP } = require('net');
const fs = require('fs');
const path = require('path');
const _platform = require('./platform');
const sensorHealth = require('./sensor-health');
const { ALLOWLIST_DOMAINS, ALLOWLIST_IP_RANGES } = require('../shared/constants');
const { readInstanceId } = require('./process-identity');

/** Authoritative agent-scoped TCP observation sensor id (Block B4). */
const NETWORK_SENSOR_ID = 'network';

/**
 * Persistent network health. Survives poll ticks; reset only at module reinit /
 * test reset — never recreated per 30s interval.
 * @type {import('./sensor-health').SensorHealth}
 */
let _networkHealth = sensorHealth.createSensorHealth(NETWORK_SENSOR_ID);

/**
 * @param {unknown} err
 * @returns {string}
 */
function healthErrorMessage(err) {
  if (err == null) return 'unknown-error';
  if (typeof err === 'string') return err.slice(0, 200);
  const msg = err && err.message != null ? String(err.message) : String(err);
  return msg.slice(0, 200);
}

/**
 * Plain serializable snapshot for future B6 — callers must not mutate.
 * @returns {object}
 * @since 0.11.0
 */
function getNetworkSensorHealth() {
  return sensorHealth.toPlain(_networkHealth);
}

/**
 * Orchestration-only skip (TCP provider not invoked).
 *
 * Sensor definition: agent-scoped network observation.
 * - `confirmed-zero-agents`: process HEALTHY + empty fleet → vacuous scope complete → HEALTHY
 * - `process-observation-unavailable`: cannot trust agent list → DEGRADED (not provider FAILED)
 *
 * lastSuccessAt advances only on confirmed-zero (scoped semantic success), not on
 * process-unavailable skip.
 *
 * @param {'confirmed-zero-agents'|'process-observation-unavailable'|string} reason
 * @returns {void}
 * @since 0.11.0
 */
function noteNetworkSkip(reason) {
  const now = Date.now();
  if (reason === 'confirmed-zero-agents') {
    _networkHealth = sensorHealth.markHealthy(_networkHealth, now, {
      detail: 'confirmed-zero-agents',
    });
    return;
  }
  // process-observation-unavailable (and any unknown skip): must leave HEALTHY
  _networkHealth = sensorHealth.markDegraded(_networkHealth, now, {
    error:
      reason === 'process-observation-unavailable'
        ? 'process-observation-unavailable'
        : healthErrorMessage(reason),
    detail:
      reason === 'process-observation-unavailable'
        ? 'process-observation-unavailable'
        : 'network-skip',
  });
}

/**
 * Hard provider failure when the throw path is outside scanNetworkConnections.
 * Prefer the internal catch in scanNetworkConnections (avoids double-count).
 * @param {unknown} err
 * @returns {void}
 * @since 0.11.0
 */
function noteNetworkScanHardFailure(err) {
  const now = Date.now();
  _networkHealth = sensorHealth.markFailed(_networkHealth, now, {
    error: healthErrorMessage(err),
    detail: 'provider-failure',
  });
}

let _getRawTcpConnections = _platform.getRawTcpConnections;
let _dnsReverse = (ip) => dns.promises.reverse(ip);
/**
 * Forward-resolve a hostname to every address it publishes. Uses resolve4/resolve6
 * (authoritative DNS) rather than dns.lookup, which would consult the hosts file — a
 * local file an attacker on the box can write is not evidence about a remote endpoint.
 * @param {string} hostname
 * @returns {Promise<string[]>}
 */
let _dnsResolve = async (hostname) => {
  const settled = await Promise.allSettled([
    dns.promises.resolve4(hostname),
    dns.promises.resolve6(hostname),
  ]);
  const out = [];
  for (const r of settled) if (r.status === 'fulfilled') out.push(...r.value);
  return out;
};
/** @internal Override dependencies (for tests). */
function _setDepsForTest(overrides) {
  if (overrides.getRawTcpConnections) _getRawTcpConnections = overrides.getRawTcpConnections;
  if (overrides.dnsReverse) _dnsReverse = overrides.dnsReverse;
  if (overrides.dnsResolve) _dnsResolve = overrides.dnsResolve;
}
/** @internal Clear caches + health (for tests). */
function _resetForTest() {
  dnsGeneration++;
  dnsCache.clear();
  dnsPending.clear();
  forwardPending.clear();
  networkScanRunning = false;
  _networkHealth = sensorHealth.createSensorHealth(NETWORK_SENSOR_ID);
}

let _agentDb = null;
/** @returns {Object} Parsed agent-database.json (lazy-loaded on first call) */
function getAgentDb() {
  if (!_agentDb) {
    _agentDb = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'shared', 'agent-database.json'), 'utf-8'),
    );
  }
  return _agentDb;
}

const dnsCache = new Map();
const DNS_CACHE_TTL = 300000;
const DNS_NEGATIVE_TTL = 30000;
const DNS_CACHE_CAPACITY = 500;
const dnsPending = new Map();
const forwardPending = new Map();
let dnsGeneration = 0;
let networkScanRunning = false;

/**
 * Verdict reason codes. Every classification records which rule decided it, so a
 * verdict can be argued with instead of guessed at.
 * @type {Readonly<Record<string, string>>}
 * @since 0.10.0
 */
const VERDICT_REASONS = {
  /** Remote address falls inside a published operator IP range. No DNS was consulted. */
  IP_ALLOWLIST: 'ip-allowlist',
  /** Forward-confirmed name is an allowlisted host or a subdomain of one. */
  DOMAIN_ALLOWLIST: 'domain-allowlist',
  /** Forward-confirmed name, but it is on no allowlist. */
  DOMAIN_NOT_ALLOWLISTED: 'domain-not-allowlisted',
  /** No PTR record, or the reverse lookup failed. Nothing is known about the endpoint. */
  PTR_MISSING: 'ptr-missing',
  /** A PTR name existed but did not resolve back to this address, so it was discarded. */
  PTR_UNCONFIRMED: 'ptr-unconfirmed',
};

/** @type {string[]|null} Allowlisted hosts (lazy-built): published set + agent-db entries */
let _knownDomains = null;
/** @returns {string[]} Full allowlist — exact hosts, matched with a label boundary */
function getKnownDomains() {
  if (!_knownDomains) {
    _knownDomains = [
      ...ALLOWLIST_DOMAINS,
      ...getAgentDb().agents.flatMap((a) => a.knownDomains || []),
    ]
      .map((d) => String(d).toLowerCase().replace(/\.$/, ''))
      .filter((d, i, arr) => d.length > 0 && arr.indexOf(d) === i);
  }
  return _knownDomains;
}

/** @type {Array<{bytes: number[], bits: number}>|null} Parsed ALLOWLIST_IP_RANGES (lazy-built) */
let _ipRanges = null;

/**
 * Convert dotted-quad IPv4 to an unsigned 32-bit integer.
 * @param {string} ip
 * @returns {number|null} `null` when the input is not a valid IPv4 literal
 * @since 0.10.0
 */
function ipv4ToInt(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  let n = 0;
  for (let i = 1; i <= 4; i++) {
    const octet = Number(m[i]);
    if (octet > 255) return null;
    n = n * 256 + octet;
  }
  return n >>> 0;
}

/** @returns {Array<{bytes: number[], bits: number}>} Parsed CIDR ranges from constants */
function getIpRanges() {
  if (!_ipRanges) {
    _ipRanges = [];
    for (const cidr of ALLOWLIST_IP_RANGES) {
      const [addr, prefix] = String(cidr).split('/');
      const bytes = ipToBytes(addr);
      const bits = Number(prefix);
      if (!bytes || !Number.isInteger(bits) || bits < 0 || bits > bytes.length * 8) continue;
      _ipRanges.push({ bytes, bits });
    }
  }
  return _ipRanges;
}

/**
 * Normalize an address for comparison: lowercase, drop a zone id, unwrap an
 * IPv4-mapped IPv6 address, and expand `::` so two spellings of one IPv6 address
 * compare equal.
 * @param {string} ip
 * @returns {string}
 * @since 0.10.0
 */
function normalizeIp(ip) {
  let s = String(ip).trim().toLowerCase();
  const zone = s.indexOf('%');
  if (zone !== -1) s = s.slice(0, zone);
  if (s.startsWith('::ffff:') && s.includes('.')) s = s.slice(7);
  if (!s.includes(':')) return s;
  const [head, tail] = s.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const parts =
    tail === undefined
      ? h
      : [...h, ...new Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
  if (parts.length !== 8) return s;
  return parts.map((p) => p.replace(/^0+(?=.)/, '')).join(':');
}

/**
 * Convert an address to its raw bytes — 4 for IPv4, 16 for IPv6 — so both families can be
 * compared against a CIDR prefix by the same code.
 * @param {string} ip
 * @returns {number[]|null} `null` when the input is not a valid address literal
 * @since 0.10.0
 */
function ipToBytes(ip) {
  const s = normalizeIp(ip);
  if (!s.includes(':')) {
    const n = ipv4ToInt(s);
    return n === null ? null : [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  }
  const groups = s.split(':');
  if (groups.length !== 8) return null;
  const bytes = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    const v = parseInt(g, 16);
    bytes.push((v >> 8) & 255, v & 255);
  }
  return bytes;
}

/**
 * Test whether an address falls inside one parsed CIDR range. Same-family only: an IPv4
 * address never matches an IPv6 prefix, and vice versa.
 * @param {number[]} bytes
 * @param {{bytes: number[], bits: number}} range
 * @returns {boolean}
 * @since 0.10.0
 */
function matchesCidr(bytes, range) {
  if (bytes.length !== range.bytes.length) return false;
  let remaining = range.bits;
  for (let i = 0; i < bytes.length && remaining > 0; i++) {
    const take = Math.min(8, remaining);
    const mask = (0xff << (8 - take)) & 0xff;
    if ((bytes[i] & mask) !== (range.bytes[i] & mask)) return false;
    remaining -= take;
  }
  return true;
}

/**
 * Test whether an IP belongs to a private/loopback range.
 * @param {string} ip
 * @returns {boolean}
 * @since v0.1.0
 */
function isPrivateIp(ip) {
  return /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.0\.0\.0|::1$|::$|fe80:)/i.test(ip);
}

/**
 * Test whether an address falls inside a published operator IP range (ALLOWLIST_IP_RANGES).
 * Matched numerically on the address bytes, never as a string prefix: `160.79.104.0/21`
 * covers `160.79.111.255`, which shares no textual prefix with the range's own address.
 * Both IPv4 and IPv6 are supported — the API is reachable over either.
 * @param {string} ip
 * @returns {boolean}
 * @since 0.10.0
 */
function isAllowlistedIp(ip) {
  const bytes = ipToBytes(ip);
  if (!bytes) return false;
  return getIpRanges().some((range) => matchesCidr(bytes, range));
}

/**
 * Test whether a hostname is an allowlisted host or a subdomain of one.
 * Compared label-wise, not by suffix: `evilclaude.ai` does not match `claude.ai`.
 * @param {string} domain
 * @returns {boolean}
 * @since v0.1.0
 */
function isKnownDomain(domain) {
  if (!domain) return false;
  const host = String(domain).trim().toLowerCase().replace(/\.$/, '');
  return getKnownDomains().some((d) => host === d || host.endsWith('.' + d));
}

/**
 * Reverse-resolve an IP to a hostname with TTL cache, keeping the name only when it
 * forward-confirms — i.e. the name resolves back to the same address. An unconfirmed
 * PTR is attacker-controlled text (the owner of an address writes its own PTR record),
 * so it is discarded rather than reported as the endpoint's identity.
 * @param {string} ip
 * @returns {Promise<string|null>} The confirmed hostname, or `null` when none was established
 * @since v0.1.0
 */
async function resolveIp(ip) {
  return (await resolveIpEvidence(ip)).domain;
}

/** Resolve evidence for this caller even if a large scan evicts the shared cache entry.
 * @param {string} ip Address @returns {Promise<{domain: string|null, reason: string}>} DNS evidence
 * @since 0.14.1
 */
async function resolveIpEvidence(ip) {
  const key = normalizeIp(ip);
  if (!isIP(key)) return { domain: null, reason: VERDICT_REASONS.PTR_MISSING };
  const cached = freshDnsEntry(key);
  if (cached) return cached;
  if (dnsPending.has(key)) return dnsPending.get(key);
  const generation = dnsGeneration;
  const reverse = _dnsReverse;
  const forward = _dnsResolve;
  const pending = Promise.resolve().then(async () => {
    const result = await lookupIp(key, reverse, (name) =>
      resolveHostname(name, forward, generation),
    );
    // A reset must not let an earlier lookup repopulate the next generation's cache.
    if (generation === dnsGeneration) {
      if (dnsCache.size >= DNS_CACHE_CAPACITY) dnsCache.delete(dnsCache.keys().next().value);
      dnsCache.set(key, { ...result, timestamp: Date.now() });
    }
    return result;
  });
  dnsPending.set(key, pending);
  try {
    return await pending;
  } finally {
    if (dnsPending.get(key) === pending) dnsPending.delete(key);
  }
}

/** Share concurrent forward queries across endpoints with the same PTR name.
 * @param {string} name Normalized hostname @param {Function} resolve Forward resolver
 * @param {number} generation Lookup generation
 * @returns {Promise<string[]>} Resolver addresses @since 0.14.1
 */
async function resolveHostname(name, resolve, generation) {
  if (generation !== dnsGeneration) return resolve(name);
  if (forwardPending.has(name)) return forwardPending.get(name);
  const pending = Promise.resolve().then(() => resolve(name));
  forwardPending.set(name, pending);
  try {
    return await pending;
  } finally {
    if (forwardPending.get(name) === pending) forwardPending.delete(name);
  }
}

/** Read an unexpired normalized DNS entry. @param {string} ip Address @returns {object|null} Cached result @since 0.14.1 */
function freshDnsEntry(ip) {
  const key = normalizeIp(ip);
  const entry = dnsCache.get(key);
  if (!entry) return null;
  const age = Date.now() - entry.timestamp;
  if (age < 0 || age >= (entry.domain ? DNS_CACHE_TTL : DNS_NEGATIVE_TTL)) {
    dnsCache.delete(key);
    return null;
  }
  return entry;
}

/** Check distinct PTR candidates until one forward-confirms.
 * @param {string} ip Normalized address @param {Function} reverse Reverse resolver
 * @param {Function} forward Forward resolver @returns {Promise<{domain: string|null, reason: string}>} Evidence
 * @since 0.14.1
 */
async function lookupIp(ip, reverse, forward) {
  let hostnames;
  try {
    hostnames = await reverse(ip);
  } catch (_) {
    return { domain: null, reason: VERDICT_REASONS.PTR_MISSING };
  }
  const candidates = Array.isArray(hostnames)
    ? [
        ...new Set(
          hostnames
            .filter((name) => typeof name === 'string')
            .map((name) => name.trim().toLowerCase().replace(/\.$/, ''))
            .filter(Boolean),
        ),
      ]
    : [];
  for (const candidate of candidates) {
    try {
      const addresses = await forward(candidate);
      if (
        Array.isArray(addresses) &&
        addresses.some((address) => normalizeIp(String(address)) === ip)
      ) {
        return { domain: candidate, reason: 'forward-confirmed' };
      }
    } catch (_) {
      // One broken PTR candidate does not discard the remaining candidates.
    }
  }
  return {
    domain: null,
    reason: candidates.length ? VERDICT_REASONS.PTR_UNCONFIRMED : VERDICT_REASONS.PTR_MISSING,
  };
}

/**
 * Classify one remote address into allowlisted / unknown / flagged, using only the
 * cached DNS result (populated by resolveIp) and the published allowlists.
 *
 * Absence of a name is NOT evidence of wrongdoing: it yields `unknown`. Only a
 * forward-confirmed name that is on no allowlist yields `flagged`.
 * @param {string} ip
 * @param {{domain: string|null, reason: string}|null} [evidence] Same-scan DNS result
 * @returns {{verdict: 'allowlisted'|'unknown'|'flagged', reason: string, domain: string}}
 * @since 0.10.0
 */
function classifyConnection(ip, evidence = freshDnsEntry(ip)) {
  if (isAllowlistedIp(ip)) {
    return { verdict: 'allowlisted', reason: VERDICT_REASONS.IP_ALLOWLIST, domain: '' };
  }
  const cached = evidence;
  const domain = cached && cached.domain ? cached.domain : '';
  if (!domain) {
    const reason =
      cached && cached.reason === VERDICT_REASONS.PTR_UNCONFIRMED
        ? VERDICT_REASONS.PTR_UNCONFIRMED
        : VERDICT_REASONS.PTR_MISSING;
    return { verdict: 'unknown', reason, domain: '' };
  }
  return isKnownDomain(domain)
    ? { verdict: 'allowlisted', reason: VERDICT_REASONS.DOMAIN_ALLOWLIST, domain }
    : { verdict: 'flagged', reason: VERDICT_REASONS.DOMAIN_NOT_ALLOWLISTED, domain };
}

/**
 * Scan network connections for all given agents, resolve IPs, classify domains.
 *
 * Health (B4): observation validity, not connection cardinality.
 * - Successful provider run with zero relevant connections → HEALTHY empty
 * - Provider throw → FAILED (rethrow; do not convert to silent HEALTHY [])
 * - agents.length === 0 here is defensive only — orchestration must call
 *   {@link noteNetworkSkip} so empty fleet is not confused with provider success
 *
 * @param {Array} agents
 * @returns {Promise<Array>} Enriched connection objects
 * @since v0.1.0
 */
async function scanNetworkConnections(agents) {
  // Defensive: real empty-agent scheduling is scan-loop noteNetworkSkip.
  // Do not mark HEALTHY — no TCP provider observation occurred.
  if (agents.length === 0) return [];
  const now = Date.now();
  try {
    const pidMap = new Map();
    for (const a of agents) pidMap.set(a.pid, a);
    const raw = await _getRawTcpConnections(agents.map((a) => a.pid));
    if (!Array.isArray(raw)) {
      throw new Error('tcp-provider-invalid-response');
    }
    const seen = new Set();
    const deduped = raw.filter((c) => {
      if (isPrivateIp(c.ip)) return false;
      // A remote endpoint can have many simultaneous sockets from the same process.
      // Dedup only when both endpoints and the observation state identify the same
      // socket. Missing local identity is uncertainty, never a shared empty bucket.
      if (
        !Number.isInteger(c.pid) ||
        c.pid <= 0 ||
        typeof c.localIp !== 'string' ||
        !isIP(c.localIp) ||
        !Number.isInteger(c.localPort) ||
        c.localPort <= 0 ||
        c.localPort > 65535 ||
        typeof c.ip !== 'string' ||
        !isIP(c.ip) ||
        !Number.isInteger(c.port) ||
        c.port <= 0 ||
        c.port > 65535 ||
        typeof c.state !== 'string' ||
        !c.state
      )
        return true;
      const key = JSON.stringify([c.pid, c.localIp, c.localPort, c.ip, c.port, c.state]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    // The IP allowlist is checked BEFORE any DNS work: an address inside a published
    // operator range needs no name to be trusted, and asking for one would only make the
    // verdict depend on whether that operator happens to publish PTR records.
    const uniqueIps = [...new Set(deduped.map((c) => normalizeIp(c.ip)))].filter(
      (ip) => !isAllowlistedIp(ip),
    );
    const resolved = new Map(
      await Promise.all(uniqueIps.map(async (ip) => [ip, await resolveIpEvidence(ip)])),
    );
    const result = deduped.map((c) => {
      const agent = pidMap.get(c.pid);
      const { verdict, reason, domain } = classifyConnection(c.ip, resolved.get(normalizeIp(c.ip)));
      const httpUnencrypted = c.port === 80;
      return {
        // C-01: `''` for an unmatched connection, never a synthesized `PID <n>` label. This
        // value reaches the audit log, where a fabricated name would be indistinguishable
        // from a real agent — and under Event Schema v1 it would sit next to an attribution
        // status, making a guess look like a resolved owner. Display surfaces substitute
        // UNKNOWN_SOURCE_LABEL; machine output keeps the honest blank.
        //
        // Unreachable in practice: _getRawTcpConnections is called WITH these agents' pids,
        // so every returned pid is in pidMap. Kept as a guard, not as a fallback that
        // invents data.
        agent: agent ? agent.agent : '',
        pid: c.pid,
        // Same object, same call as the `agent` above — `pidMap` was built from the
        // agents this scan was invoked with, which is what makes the OS_TCP_OWNER_PID
        // evidence a same-tick observation rather than a later re-resolution.
        instanceId: readInstanceId(agent),
        parentEditor: agent ? agent.parentEditor || null : null,
        cwd: agent ? agent.cwd || null : null,
        category: agent ? agent.category : 'other',
        remoteIp: c.ip,
        remotePort: c.port,
        localIp: typeof c.localIp === 'string' && isIP(c.localIp) ? c.localIp : null,
        localPort:
          Number.isInteger(c.localPort) && c.localPort > 0 && c.localPort <= 65535
            ? c.localPort
            : null,
        domain: domain || '',
        state: c.state,
        // Three outcomes, and the rule that produced each one. `verdict` is the honest
        // answer; `flagged` is kept for the consumers that already read it (risk scoring,
        // CSV/HTML export, ai-analysis, scan-loop severity) and keeps its original meaning:
        // "not confirmed as an allowlisted endpoint". An `unknown` verdict therefore still
        // sets it — an unidentified endpoint must not be displayed as safe.
        verdict,
        verdictReason: reason,
        flagged: verdict !== 'allowlisted',
        httpUnencrypted,
        userAgent: agent ? agent.process || agent.agent : null,
      };
    });
    // Valid enumeration (including empty after filters) → HEALTHY. Cardinality ≠ health.
    _networkHealth = sensorHealth.markHealthy(_networkHealth, now);
    return result;
  } catch (err) {
    // B-S05: full observation failure — never look like calm empty HEALTHY.
    _networkHealth = sensorHealth.markFailed(_networkHealth, now, {
      error: healthErrorMessage(err),
      detail: 'provider-failure',
    });
    throw err;
  }
}

/** @returns {boolean} Whether a network scan is in progress */
function isNetworkScanRunning() {
  return networkScanRunning;
}

/**
 * @param {boolean} v
 * @returns {void}
 */
function setNetworkScanRunning(v) {
  networkScanRunning = v;
}

module.exports = {
  scanNetworkConnections,
  getNetworkSensorHealth,
  noteNetworkSkip,
  noteNetworkScanHardFailure,
  NETWORK_SENSOR_ID,
  isKnownDomain,
  isAllowlistedIp,
  isPrivateIp,
  classifyConnection,
  resolveIp,
  VERDICT_REASONS,
  get KNOWN_DOMAINS() {
    return getKnownDomains();
  },
  isNetworkScanRunning,
  setNetworkScanRunning,
  _setDepsForTest,
  _resetForTest,
};
