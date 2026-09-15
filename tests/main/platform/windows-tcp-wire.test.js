import { it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import tcp from '../../../src/main/platform/windows-tcp.js';

it.skipIf(process.platform !== 'win32')(
  'filters large excluded tables before the bounded JSON transport',
  async () => {
    // Shadow the cmdlet: this executes the real generated pipeline on disposable
    // objects, with no OS network query and no live host endpoint output.
    const fixture = `function Get-CimInstance {
    for($i=0;$i -lt 10000;$i++) {
      [pscustomobject]@{OwningProcess=42;RemoteAddress="127.0.0.1";RemotePort=443;LocalAddress="127.0.0.1";LocalPort=$i;State=5}
    }
    foreach($port in @(50001,50002)) {
      [pscustomobject]@{OwningProcess=42;RemoteAddress="203.0.113.1";RemotePort=443;LocalAddress="192.0.2.1";LocalPort=$port;State=5}
    }
  };`;
    const { stdout } = await promisify(execFile)(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', fixture + tcp.buildTcpQuery([42])],
      { timeout: 15000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 },
    );
    expect(Buffer.byteLength(stdout)).toBeLessThan(4096);
    expect(tcp.parseTcpRows(stdout, [42]).map((row) => row.localPort)).toEqual([50001, 50002]);
  },
  20000,
);
