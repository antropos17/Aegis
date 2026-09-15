'use strict';
// Local-only sockets; stdout contains aggregate counts/timings, never host observations.
const net = require('node:net');
const { execFile } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { getRawTcpConnections } = require('../src/main/platform/win32');

// Frozen pre-change query from 9c6b8b3, with this fixture's PID substituted.
function legacyQuery() {
  return [
    '$ErrorActionPreference="SilentlyContinue"',
    `$pids=@(${process.pid})`,
    '$conns=Get-NetTCPConnection -OwningProcess $pids -EA SilentlyContinue|Where-Object{$_.State -ne "Listen" -and $_.State -ne "Bound" -and $_.RemoteAddress -ne "0.0.0.0" -and $_.RemoteAddress -ne "::" -and $_.RemoteAddress -ne "127.0.0.1" -and $_.RemoteAddress -ne "::1"}',
    '$r=@()',
    'foreach($c in $conns){$r+=@{pid=[int]$c.OwningProcess;ip=$c.RemoteAddress;port=[int]$c.RemotePort;localIp=$c.LocalAddress;localPort=[int]$c.LocalPort;state=$c.State.ToString()}}',
    'if($r.Count -gt 0){$r|ConvertTo-Json -Compress}else{"[]"}',
  ].join('\n');
}
function legacy() {
  return new Promise((resolve, reject) =>
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', legacyQuery()],
      { timeout: 10000, windowsHide: true },
      (err, out) => {
        if (err) return reject(new Error('Legacy query failed'));
        try {
          const rows = JSON.parse(out);
          resolve(Array.isArray(rows) ? rows : [rows]);
        } catch {
          reject(new Error('Legacy JSON invalid'));
        }
      },
    ),
  );
}
const sockets = [],
  servers = [];
async function fixture(host) {
  const server = net.createServer((socket) => sockets.push(socket));
  servers.push(server);
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, host, resolve));
  const clients = [];
  for (let i = 0; i < 2; i++) {
    const socket = net.createConnection({ host, port: server.address().port });
    sockets.push(socket);
    clients.push(socket);
    await new Promise((resolve, reject) => socket.once('connect', resolve).once('error', reject));
  }
  return clients;
}
function key(row) {
  return JSON.stringify([row.pid, row.ip, row.port, row.localIp, row.localPort, row.state]);
}
async function main() {
  if (process.platform !== 'win32') throw new Error('Windows is required');
  // Safety deadline only closes this harness's own sockets.
  const deadline = setTimeout(() => {
    sockets.forEach((socket) => socket.destroy());
    servers.forEach((server) => server.close());
  }, 120000);
  try {
    const clients = await fixture('127.0.0.2');
    await fixture('127.0.0.1');
    await fixture('::1');
    const expected = clients
      .map((socket) =>
        key({
          pid: process.pid,
          ip: socket.remoteAddress,
          port: socket.remotePort,
          localIp: socket.localAddress,
          localPort: socket.localPort,
          state: 'Established',
        }),
      )
      .sort();
    const samples = [];
    for (let pair = 0; pair < 6; pair++)
      for (const provider of pair % 2 ? ['cim', 'cmdlet'] : ['cmdlet', 'cim']) {
        const start = performance.now();
        const rows =
          provider === 'cim' ? await getRawTcpConnections([process.pid]) : await legacy();
        const actual = rows.map(key).sort();
        if (JSON.stringify(actual) !== JSON.stringify(expected))
          throw new Error('Fixture endpoint/state mismatch');
        samples.push({ provider, ms: performance.now() - start, connections: rows.length });
      }
    const absent = await getRawTcpConnections([4294967295]);
    if (absent.length) throw new Error('Empty PID scope mismatch');
    const files = ['src/main/platform/win32.js', 'src/main/platform/windows-tcp.js'];
    const hashes = Object.fromEntries(
      files.map((file) => [
        file,
        createHash('sha256')
          .update(fs.readFileSync(path.join(__dirname, '..', file)))
          .digest('hex'),
      ]),
    );
    process.stdout.write(
      JSON.stringify({
        schema: 1,
        baseline: '9c6b8b3',
        samples,
        exactEndpointStateMatches: 12,
        emptyScopeMatched: true,
        hashes,
      }) + '\n',
    );
  } finally {
    clearTimeout(deadline);
    sockets.forEach((socket) => socket.destroy());
    servers.forEach((server) => server.close());
  }
}
main().catch(() => {
  process.stderr.write('TCP comparison failed; no performance result established.\n');
  process.exitCode = 1;
});
