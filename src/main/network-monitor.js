/**
 * @file network-monitor.js
 * @module main/network-monitor
 * @description Network connection scanning via PowerShell Get-NetTCPConnection,
 *   reverse-DNS resolution with TTL cache, and known-domain classification.
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

let _getRawTcpConnections = _platform.getRawTcpConnections;
let _dnsReverse = (ip) => dns.promises.reverse(ip);
/** @internal Override dependencies (for tests). */
function _setDepsForTest(overrides) {
  if (overrides.getRawTcpConnections) _getRawTcpConnections = overrides.getRawTcpConnections;
  if (overrides.dnsReverse) _dnsReverse = overrides.dnsReverse;
}
/** @internal Clear caches (for tests). */
function _resetForTest() {
  dnsCache.clear();
  networkScanRunning = false;
}

const agentDb = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'shared', 'agent-database.json'), 'utf-8'),
);

const dnsCache = new Map();
const DNS_CACHE_TTL = 300000;
let networkScanRunning = false;

/** @type {RegExp[]} Domain patterns considered safe/known */
const KNOWN_DOMAINS = [
  /anthropic\.com$/i,
  /openai\.com$/i,
  /github\.com$/i,
  /githubusercontent\.com$/i,
  /githubassets\.com$/i,
  /microsoft\.com$/i,
  /azure\.com$/i,
  /azure\.net$/i,
  /windows\.net$/i,
  /live\.com$/i,
  /google\.com$/i,
  /googleapis\.com$/i,
  /gstatic\.com$/i,
  /cursor\.sh$/i,
  /cursor\.com$/i,
  /tabnine\.com$/i,
  /sourcegraph\.com$/i,
  /cloudflare\.com$/i,
  /cloudflare-dns\.com$/i,
  /cloudflare\.net$/i,
  /cloudflareinsights\.com$/i,
  /amazonaws\.com$/i,
  /akamai\.net$/i,
  /akamaiedge\.net$/i,
  /fastly\.net$/i,
  /sentry\.io$/i,
  /vsassets\.io$/i,
  /vscode-cdn\.net$/i,
  /visualstudio\.com$/i,
  /vo\.msecnd\.net$/i,
  /trafficmanager\.net$/i,
  /1e100\.net$/i,
  /googleusercontent\.com$/i,
  /googlevideo\.com$/i,
  /cloudfront\.net$/i,
  /github\.io$/i,
  /electronjs\.org$/i,
  /nodejs\.org$/i,
  /npmjs\.org$/i,
  /npmjs\.com$/i,
  /yarnpkg\.com$/i,
  ...agentDb.agents
    .flatMap((a) => a.knownDomains || [])
    .filter((d, i, arr) => arr.indexOf(d) === i)
    .map((d) => new RegExp(d.replace(/\./g, '\\.') + '$', 'i')),
];

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
 * Test whether a domain matches any KNOWN_DOMAINS pattern.
 * @param {string} domain
 * @returns {boolean}
 * @since v0.1.0
 */
function isKnownDomain(domain) {
  return KNOWN_DOMAINS.some((p) => p.test(domain));
}

/**
 * Reverse-resolve an IP to a hostname with TTL cache.
 * @param {string} ip
 * @returns {Promise<string|null>}
 * @since v0.1.0
 */
async function resolveIp(ip) {
  const cached = dnsCache.get(ip);
  if (cached && Date.now() - cached.timestamp < DNS_CACHE_TTL) return cached.domain;
  // Prune stale entries when cache grows too large
  if (dnsCache.size > 1000) {
    const now = Date.now();
    for (const [key, entry] of dnsCache) {
      if (now - entry.timestamp >= DNS_CACHE_TTL) dnsCache.delete(key);
    }
  }
  try {
    const hostnames = await _dnsReverse(ip);
    const domain = hostnames && hostnames.length > 0 ? hostnames[0] : null;
    dnsCache.set(ip, { domain, timestamp: Date.now() });
    return domain;
  } catch (_) {
    dnsCache.set(ip, { domain: null, timestamp: Date.now() });
    return null;
  }
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
  const uniqueIps = [...new Set(deduped.map((c) => c.ip))];
  await Promise.all(uniqueIps.map((ip) => resolveIp(ip)));
  return deduped.map((c) => {
    const agent = pidMap.get(c.pid);
    const cached = dnsCache.get(c.ip);
    const domain = cached ? cached.domain : null;
    return {
      agent: agent ? agent.agent : `PID ${c.pid}`,
      pid: c.pid,
      parentEditor: agent ? agent.parentEditor || null : null,
      cwd: agent ? agent.cwd || null : null,
      category: agent ? agent.category : 'other',
      remoteIp: c.ip,
      remotePort: c.port,
      domain: domain || '',
      state: c.state,
      flagged: !domain || !isKnownDomain(domain),
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
  isPrivateIp,
  resolveIp,
  KNOWN_DOMAINS,
  isNetworkScanRunning,
  setNetworkScanRunning,
  _setDepsForTest,
  _resetForTest,
};
