import { it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { EventEmitter } from 'node:events';
import { execFile as realExecFile } from 'node:child_process';
const require = createRequire(import.meta.url);
const transport = require('../../src/main/platform/windows-observer');

async function withProviders(responses, run) {
  const files = ['../../src/main/platform/win32', '../../src/main/platform/restart-manager'].map(
    (p) => require.resolve(p),
  );
  const saved = files.map((p) => require.cache[p]);
  files.forEach((p) => delete require.cache[p]);
  const load = Module._load;
  const execFile = vi.fn((file, args, opts, cb) => {
    const stdin = new EventEmitter();
    const complete = () => {
      const next = responses.shift();
      if (typeof next === 'function') {
        next(file, args, opts, cb);
        return;
      }
      queueMicrotask(() => (next instanceof Error ? cb(next) : cb(null, next)));
    };
    stdin.end = complete;
    if (file === 'powershell.exe') complete();
    return { stdin };
  });
  Module._load = function (request, parent, isMain) {
    if (request === 'child_process') return { execFile };
    if (request === './windows-observer')
      return {
        ...transport,
        createWindowsObserver: (deps) =>
          transport.createWindowsObserver({ ...deps, resolveExe: () => '/observer', mode: 'auto' }),
      };
    if (parent?.filename === files[1] && request === 'fs')
      return { readdirSync: () => [{ name: 'fixture', isFile: () => true }] };
    if (parent?.filename === files[1] && request === 'os') return { homedir: () => '/fixture' };
    if (parent?.filename === files[1] && request === '../rule-loader')
      return { getAllRules: () => new Map([['fixture', { pattern: /./, reason: 'fixture' }]]) };
    return load.call(this, request, parent, isMain);
  };
  try {
    await run(require(files[0]), require(files[1]), execFile);
  } finally {
    Module._load = load;
    files.forEach((p, i) => {
      if (saved[i]) require.cache[p] = saved[i];
      else delete require.cache[p];
    });
  }
}
const native = (rows) => JSON.stringify({ version: 1, rows });
const socket = {
  OwningProcess: 42,
  RemoteAddress: '203.0.113.1',
  RemotePort: 443,
  LocalAddress: '192.0.2.1',
  LocalPort: 1234,
  State: 5,
};

it.skipIf(process.platform !== 'win32')(
  'preserves Unicode through the actual CWD fallback pipeline',
  async () => {
    await withProviders(
      [
        new Error('helper missing'),
        (file, args, opts, cb) => {
          const fixture =
            'function Get-CimInstance { [pscustomobject]@{ProcessId=42;CommandLine=(\'node --cwd "X:\\проект"\')} };';
          realExecFile(
            file,
            [...args.slice(0, -1), fixture + args.at(-1)],
            { ...opts, windowsHide: true },
            cb,
          );
        },
      ],
      async (win) => {
        expect(await win.getProcessCwds([42])).toEqual(new Map([[42, 'X:\\проект']]));
      },
    );
  },
  15000,
);

it('routes TCP through the helper and validates scope before returning endpoint tuples', async () => {
  await withProviders(
    [native([socket]), native([{ ...socket, OwningProcess: 99 }]), '[]'],
    async (win, rm, exec) => {
      expect(await win.getRawTcpConnections([42])).toEqual([
        {
          pid: 42,
          ip: '203.0.113.1',
          port: 443,
          localIp: '192.0.2.1',
          localPort: 1234,
          state: 'Established',
        },
      ]);
      expect(await win.getRawTcpConnections([42])).toEqual([]);
      expect(exec.mock.calls.map((c) => c[0])).toEqual([
        '/observer',
        '/observer',
        'powershell.exe',
      ]);
    },
  );
});
it('keeps network failure rejecting after both native and fallback fail', async () => {
  await withProviders([new Error('helper'), new Error('fallback')], async (win) => {
    await expect(win.getRawTcpConnections([42])).rejects.toThrow('fallback');
  });
});
it('preserves CWD extraction, null and absent processes with fresh native observations', async () => {
  await withProviders(
    [
      native([
        { ProcessId: 42, CommandLine: 'node --cwd "X:\\проект"' },
        { ProcessId: 43, CommandLine: null },
      ]),
      native([]),
    ],
    async (win, rm, exec) => {
      expect(await win.getProcessCwds([42, 43, 44])).toEqual(
        new Map([
          [42, 'X:\\проект'],
          [43, null],
        ]),
      );
      expect(await win.getProcessCwds([42])).toEqual(new Map());
      expect(exec.mock.calls.every((c) => c[0] === '/observer')).toBe(true);
    },
  );
});
it('falls back after malformed CWD output and retains the legacy empty-on-error contract', async () => {
  await withProviders(['invalid', new Error('fallback')], async (win) => {
    expect(await win.getProcessCwds([42])).toEqual(new Map());
  });
});
it('maps real collector group indices and retains the PowerShell RM fallback', async () => {
  await withProviders(
    [
      native([{ index: 0, pids: [42] }]),
      native([]),
      '[{"group":"/fallback","reason":"fixture","pids":[43]}]',
    ],
    async (win, rm, exec) => {
      const groups = rm.buildSensitiveGroups(['fixture'], false);
      expect(await rm.getSensitiveHolders(['fixture'], false)).toEqual([
        { pid: 42, group: groups[0].group, reason: 'fixture' },
      ]);
      expect(await rm.getSensitiveHolders(['fixture'], false)).toEqual([
        { pid: 43, group: '/fallback', reason: 'fixture' },
      ]);
      expect(exec.mock.calls.map((c) => c[0])).toEqual([
        '/observer',
        '/observer',
        'powershell.exe',
      ]);
    },
  );
});
