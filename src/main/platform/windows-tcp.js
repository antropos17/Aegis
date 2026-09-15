'use strict';
const { isIP } = require('node:net');

// MSFT_NetTCPConnection.cdxml: the enum Get-NetTCPConnection exposes.
const STATES = [
  'Closed',
  'Listen',
  'SynSent',
  'SynReceived',
  'Established',
  'FinWait1',
  'FinWait2',
  'CloseWait',
  'Closing',
  'LastAck',
  'TimeWait',
  'DeleteTCB',
];
const OMIT_REMOTE = new Set(['0.0.0.0', '::', '127.0.0.1', '::1']);
const OMIT_STATES = new Set([2, 100]);
const uint = (value, max) => Number.isInteger(value) && value >= 0 && value <= max;

/** Query the same CIM table directly, avoiding NetTCPIP module initialization.
 * @param {number[]} pids - Validated positive uint32 process IDs.
 * @returns {string} PowerShell script with only numeric input interpolation.
 * @since 0.15.0
 */
function buildTcpQuery(pids) {
  if (!pids.length || pids.some((pid) => !uint(pid, 0xffffffff) || pid === 0))
    throw new Error('Invalid TCP query targets');
  const fields = 'OwningProcess,RemoteAddress,RemotePort,LocalAddress,LocalPort,State';
  const filter = [...new Set(pids)].map((pid) => `OwningProcess=${pid}`).join(' OR ');
  // Filter before serialization as the old cmdlet did. A large loopback/listener
  // table must not consume the bounded stdout buffer intended for retained rows.
  const keep = [
    ...[...OMIT_STATES].map((state) => `$_.State -ne ${state}`),
    ...[...OMIT_REMOTE].map((ip) => `$_.RemoteAddress -ne "${ip}"`),
  ].join(' -and ');
  return (
    '$ErrorActionPreference="Stop"; ' +
    `Get-CimInstance -Namespace root/StandardCimv2 -ClassName MSFT_NetTCPConnection ` +
    `-Filter '${filter}' -Property ${fields} -ErrorAction Stop ` +
    `| Where-Object {${keep}} | Select-Object ${fields} | ConvertTo-Json -Compress`
  );
}

/** Preserve TCP rows and literal exclusions, including scoped IPv6 addresses.
 * Invalid output rejects the observation instead of reporting a healthy empty table.
 * @param {string} stdout - Selected CIM fields in JSON object or array form.
 * @param {number[]} pids - Requested process scope.
 * @returns {import('../../shared/types/process').RawTcpConnection[]} Fresh rows.
 * @since 0.15.0
 */
function parseTcpRows(stdout, pids) {
  const raw = (stdout || '').trim();
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const wanted = new Set(pids),
    output = [];
  for (const row of rows) {
    if (!row || !uint(row.State, 255) || !wanted.has(row.OwningProcess))
      throw new Error('Invalid TCP observation');
    // Keep the original literal exclusions. Do not widen these to an address
    // range or discard transient TCP states.
    if (OMIT_STATES.has(row.State) || OMIT_REMOTE.has(row.RemoteAddress)) continue;
    if (
      typeof row.RemoteAddress !== 'string' ||
      !isIP(row.RemoteAddress) ||
      typeof row.LocalAddress !== 'string' ||
      !isIP(row.LocalAddress) ||
      !uint(row.RemotePort, 65535) ||
      !uint(row.LocalPort, 65535)
    )
      throw new Error('Invalid TCP endpoint');
    output.push({
      pid: row.OwningProcess,
      ip: row.RemoteAddress,
      port: row.RemotePort,
      localIp: row.LocalAddress,
      localPort: row.LocalPort,
      state: STATES[row.State - 1] || String(row.State),
    });
  }
  return output;
}

module.exports = { buildTcpQuery, parseTcpRows };
