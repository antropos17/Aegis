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

const { execFile } = require('child_process');
const dns = require('dns');
const fs = require('fs');
const path = require('path');

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
  try {
    const hostnames = await dns.promises.reverse(ip);
    const domain = hostnames && hostnames.length > 0 ? hostnames[0] : null;
    dnsCache.set(ip, { domain, timestamp: Date.now() });
    return domain;
  } catch (_) {
    dnsCache.set(ip, { domain: null, timestamp: Date.now() });
    return null;
  }
}

/**
 * Fetch raw TCP connections for given PIDs via PowerShell.
 * @param {number[]} pids
 * @returns {Promise<Array>}
 * @since v0.1.0
 */
function getRawConnections(pids) {
  return new Promise((resolve) => {
    if (pids.length === 0) {
      resolve([]);
      return;
    }
    const pidStr = pids.join(',');
    const psScript = [
      '$ErrorActionPreference="SilentlyContinue"',
      `$pids=@(${pidStr})`,
      '$conns=Get-NetTCPConnection -OwningProcess $pids -EA SilentlyContinue|Where-Object{$_.State -ne "Listen" -and $_.State -ne "Bound" -and $_.RemoteAddress -ne "0.0.0.0" -and $_.RemoteAddress -ne "::" -and $_.RemoteAddress -ne "127.0.0.1" -and $_.RemoteAddress -ne "::1"}',
      '$r=@()',
      'foreach($c in $conns){$r+=@{pid=[int]$c.OwningProcess;ip=$c.RemoteAddress;port=[int]$c.RemotePort;state=$c.State.ToString()}}',
      'if($r.Count -gt 0){$r|ConvertTo-Json -Compress}else{"[]"}',
    ].join('\n');
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', psScript],
      { timeout: 10000 },
      (err, stdout) => {
        if (err) {
          resolve([]);
          return;
        }
        try {
          const raw = stdout.trim();
          if (!raw || raw === '[]') {
            resolve([]);
            return;
          }
          let conns = JSON.parse(raw);
          if (!Array.isArray(conns)) conns = [conns];
          resolve(conns);
        } catch (_) {
          resolve([]);
        }
      },
    );
  });
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
  const raw = await getRawConnections(agents.map((a) => a.pid));
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
  KNOWN_DOMAINS,
  isNetworkScanRunning,
  setNetworkScanRunning,
};
