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
const fs = require('fs');
const path = require('path');
const _platform = require('./platform');
const { ALLOWLIST_DOMAINS, ALLOWLIST_IP_RANGES } = require('../shared/constants');
const { readInstanceId } = require('./process-identity');

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
/** @internal Clear caches (for tests). */
function _resetForTest() {
  dnsCache.clear();
  networkScanRunning = false;
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
  const cached = dnsCache.get(ip);
  if (cached && Date.now() - cached.timestamp < DNS_CACHE_TTL) return cached.domain;
  // Prune stale entries when cache grows too large
  if (dnsCache.size > 500) {
    const now = Date.now();
    for (const [key, entry] of dnsCache) {
      if (now - entry.timestamp >= DNS_CACHE_TTL) dnsCache.delete(key);
    }
    if (dnsCache.size > 500) dnsCache.clear();
  }
  /** @param {string|null} domain @param {string} reason @returns {string|null} */
  const remember = (domain, reason) => {
    dnsCache.set(ip, { domain, reason, timestamp: Date.now() });
    return domain;
  };

  let hostnames = null;
  try {
    hostnames = await _dnsReverse(ip);
  } catch (_) {
    // Reverse lookup failed — `hostnames` stays null and the address is reported as unknown.
  }
  const candidate =
    hostnames && hostnames.length > 0
      ? String(hostnames[0]).trim().toLowerCase().replace(/\.$/, '')
      : '';
  if (!candidate) return remember(null, VERDICT_REASONS.PTR_MISSING);

  let confirmed = false;
  try {
    const addresses = await _dnsResolve(candidate);
    const target = normalizeIp(ip);
    confirmed =
      Array.isArray(addresses) && addresses.some((a) => normalizeIp(String(a)) === target);
  } catch (_) {
    // Forward lookup failed — the name stays unconfirmed and is discarded.
  }
  return confirmed
    ? remember(candidate, 'forward-confirmed')
    : remember(null, VERDICT_REASONS.PTR_UNCONFIRMED);
}

/**
 * Classify one remote address into allowlisted / unknown / flagged, using only the
 * cached DNS result (populated by resolveIp) and the published allowlists.
 *
 * Absence of a name is NOT evidence of wrongdoing: it yields `unknown`. Only a
 * forward-confirmed name that is on no allowlist yields `flagged`.
 * @param {string} ip
 * @returns {{verdict: 'allowlisted'|'unknown'|'flagged', reason: string, domain: string}}
 * @since 0.10.0
 */
function classifyConnection(ip) {
  if (isAllowlistedIp(ip)) {
    return { verdict: 'allowlisted', reason: VERDICT_REASONS.IP_ALLOWLIST, domain: '' };
  }
  const cached = dnsCache.get(ip);
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
 * @param {Array} agents
 * @returns {Promise<Array>} Enriched connection objects
 * @since v0.1.0
 */
async function scanNetworkConnections(agents) {
  if (agents.length === 0) return [];
  const pidMap = new Map();
  for (const a of agents) pidMap.set(a.pid, a);
  const raw = await _getRawTcpConnections(agents.map((a) => a.pid));
  const seen = new Set();
  const deduped = raw.filter((c) => {
    if (isPrivateIp(c.ip)) return false;
    const key = `${c.pid}:${c.ip}:${c.port}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // The IP allowlist is checked BEFORE any DNS work: an address inside a published
  // operator range needs no name to be trusted, and asking for one would only make the
  // verdict depend on whether that operator happens to publish PTR records.
  const uniqueIps = [...new Set(deduped.map((c) => c.ip))].filter((ip) => !isAllowlistedIp(ip));
  await Promise.all(uniqueIps.map((ip) => resolveIp(ip)));
  return deduped.map((c) => {
    const agent = pidMap.get(c.pid);
    const { verdict, reason, domain } = classifyConnection(c.ip);
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
