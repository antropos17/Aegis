'use strict';
// Disposable loopback sockets and a held fixture file. No host observations printed.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const cp = require('node:child_process');
const { once } = require('node:events');
const { createHash } = require('node:crypto');
const {
  createWindowsObserver,
  validateCwds,
  parseNativeHolders,
} = require('../src/main/platform/windows-observer');
const { buildTcpQuery, parseTcpRows } = require('../src/main/platform/windows-tcp');
const { RM_CSHARP } = require('../src/main/platform/rm-csharp');
function ps(script, env) {
  return new Promise((resolve, reject) =>
    cp.execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: 15000, maxBuffer: 2097152, windowsHide: true, env: env || process.env },
      (err, text) => (err ? reject(new Error('Fallback failed')) : resolve(text)),
    ),
  );
}
const rows = (text) => {
  const data = JSON.parse(text.trim() || '[]');
  return Array.isArray(data) ? data : [data];
};
const socketKey = (row) =>
  JSON.stringify([row.pid, row.ip, row.port, row.localIp, row.localPort, row.state]);
async function main() {
  if (process.platform !== 'win32') throw new Error('Windows required');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-observer-'));
  const file = path.join(dir, 'held-Ж.txt');
  fs.writeFileSync(file, 'disposable observation fixture');
  const child = cp.spawn(
    process.execPath,
    [
      '-e',
      'require("fs").openSync(process.argv[1],"r");process.send("ready");setInterval(()=>{},1000);',
      '--',
      file,
      '--cwd',
      dir,
    ],
    { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true },
  );
  const sockets = [],
    servers = [];
  let childClosed = false;
  child.once('exit', () => {
    childClosed = true;
  });
  const ready = once(child, 'message');
  const safety = setTimeout(() => {
    child.kill();
    sockets.forEach((s) => s.destroy());
    servers.forEach((s) => s.close());
  }, 180000);
  try {
    await ready;
    const expectedTcp = [];
    for (const host of ['127.0.0.2', '127.0.0.1', '::1']) {
      const server = net.createServer((socket) => sockets.push(socket));
      servers.push(server);
      await new Promise((resolve, reject) => server.once('error', reject).listen(0, host, resolve));
      for (let i = 0; i < 2; i++) {
        const socket = net.createConnection({ host, port: server.address().port });
        sockets.push(socket);
        await once(socket, 'connect');
        if (host === '127.0.0.2')
          expectedTcp.push(
            socketKey({
              pid: process.pid,
              ip: socket.remoteAddress,
              port: socket.remotePort,
              localIp: socket.localAddress,
              localPort: socket.localPort,
              state: 'Established',
            }),
          );
      }
    }
    expectedTcp.sort();
    const pids = [child.pid],
      groups = [{ group: dir, reason: 'fixture', files: [file] }];
    const observer = createWindowsObserver({ execFile: cp.execFile, mode: 'auto' });
    const cwdScript = `$ErrorActionPreference="SilentlyContinue";[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false);Get-CimInstance Win32_Process -Filter 'ProcessId=${child.pid}' -Property ProcessId,CommandLine | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress`;
    const expectedCommandLine = rows(await ps(cwdScript))[0]?.CommandLine;
    if (!expectedCommandLine?.includes(dir) || !expectedCommandLine.includes('--cwd'))
      throw new Error('Missing CWD witness');
    const holderScript = [
      '$ErrorActionPreference="Stop"',
      '[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)',
      `Add-Type -TypeDefinition @'\n${RM_CSHARP}\n'@`,
      '$groups=$env:AEGIS_RM_GROUPS|ConvertFrom-Json',
      '$out=@()',
      'foreach($g in $groups){$pids=[AegisRm]::GetHolders([string[]]$g.files);$out += [pscustomobject]@{group=$g.group;reason=$g.reason;pids=@($pids)}}',
      '$out|ConvertTo-Json -Compress -Depth 4',
    ].join('\n');
    const samples = [];
    for (const kind of ['tcp', 'cwd', 'holders']) {
      for (let pair = 0; pair < 6; pair++)
        for (const provider of pair % 2 ? ['native', 'powershell'] : ['powershell', 'native']) {
          const started = performance.now();
          let result;
          if (kind === 'tcp') {
            result =
              provider === 'native'
                ? await observer.tryRequest(kind, { pids: [process.pid] }, (data) =>
                    parseTcpRows(JSON.stringify(data), [process.pid]),
                  )
                : parseTcpRows(await ps(buildTcpQuery([process.pid])), [process.pid]);
            if (
              result === null ||
              JSON.stringify(result.map(socketKey).sort()) !== JSON.stringify(expectedTcp)
            )
              throw new Error('TCP mismatch');
          } else if (kind === 'cwd') {
            result =
              provider === 'native'
                ? await observer.tryRequest(kind, { pids }, (data) => validateCwds(data, pids))
                : validateCwds(rows(await ps(cwdScript)), pids);
            if (
              result === null ||
              result.length !== 1 ||
              result[0].CommandLine !== expectedCommandLine
            )
              throw new Error('CWD mismatch');
          } else {
            result =
              provider === 'native'
                ? await observer.tryRequest(kind, { groups: groups.map((g) => g.files) }, (data) =>
                    parseNativeHolders(data, groups),
                  )
                : rows(
                    await ps(holderScript, {
                      ...process.env,
                      AEGIS_RM_GROUPS: JSON.stringify(groups),
                    }),
                  ).flatMap((g) =>
                    g.pids.map((pid) => ({ pid, group: g.group, reason: g.reason })),
                  );
            if (
              result === null ||
              result.length !== 1 ||
              result[0].pid !== child.pid ||
              result[0].group !== dir ||
              result[0].reason !== 'fixture'
            )
              throw new Error('Holder mismatch');
          }
          samples.push({ kind, provider, ms: performance.now() - started, rows: result.length });
        }
    }
    for (const kind of ['tcp', 'cwd']) {
      const empty = await observer.tryRequest(kind, { pids: [4294967295] }, (r) => r);
      if (empty === null || empty.length) throw new Error('Empty scope mismatch');
    }
    child.kill();
    await once(child, 'exit');
    const released = await observer.tryRequest('holders', { groups: [[file]] }, (r) =>
      parseNativeHolders(r, groups),
    );
    if (released === null || released.length) throw new Error('Stale holder');
    const files = [
      'sidecar/observer/Program.cs',
      'src/main/platform/windows-observer.js',
      'src/main/platform/rm-csharp.js',
      'build/sidecar/aegis-observer.exe',
    ];
    const hashes = Object.fromEntries(
      files.map((file) => [
        file,
        createHash('sha256')
          .update(fs.readFileSync(path.join(__dirname, '..', file)))
          .digest('hex'),
      ]),
    );
    console.log(
      JSON.stringify({
        schema: 1,
        samples,
        exactMatches: 36,
        emptyScopes: 2,
        releasedHolderEmpty: true,
        hashes,
      }),
    );
  } finally {
    clearTimeout(safety);
    if (!childClosed) {
      child.kill();
      await once(child, 'exit');
    }
    sockets.forEach((s) => s.destroy());
    servers.forEach((s) => s.close());
    fs.unlinkSync(file);
    fs.rmdirSync(dir);
  }
}
main().catch((error) => {
  const known = [
    'TCP mismatch',
    'CWD mismatch',
    'Holder mismatch',
    'Empty scope mismatch',
    'Stale holder',
    'Missing CWD witness',
    'Fallback failed',
  ];
  console.error(
    'Observer comparison failed: ' +
      (known.includes(error.message) ? error.message : 'harness error') +
      '; no performance result established.',
  );
  process.exitCode = 1;
});
