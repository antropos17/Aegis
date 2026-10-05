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

it('keeps file observation available through the native RM probe when PowerShell fails', async () => {
  await withProviders(
    [new Error('PowerShell unavailable'), native([{ available: true }])],
    async (win, rm, exec) => {
      expect(await win.probeReadDetection()).toEqual({ available: true, handle: null, rm: true });
      expect(rm.isRestartManagerAvailable()).toBe(true);
      expect(exec.mock.calls.map((call) => [call[0], call[1][0]])).toEqual([
        ['powershell.exe', '-NoProfile'],
        ['/observer', 'rm-probe'],
      ]);
    },
  );
});

it.each([
  new Error('Older helper does not support rm-probe'),
  native([{ available: false }]),
  native([{ available: 'true' }]),
  native([]),
])('uses a real PowerShell session probe when native startup fails: %s', async (response) => {
  await withProviders(
    [new Error('No handle binary'), response, 'OK\r\n'],
    async (win, rm, exec) => {
      expect(await win.probeReadDetection()).toEqual({ available: true, handle: null, rm: true });
      expect(rm.isRestartManagerAvailable()).toBe(true);
      const fallback = exec.mock.calls.at(-1);
      expect(fallback[0]).toBe('powershell.exe');
      expect(fallback[1].at(-1)).toContain('[AegisRm]::Probe()');
      expect(fallback[1].at(-1)).not.toContain('::GetHolders(@())');
      expect(fallback[2].windowsHide).toBe(true);
    },
  );
});

it('keeps read detection unavailable when both native and PowerShell probes fail', async () => {
  await withProviders(
    [new Error('No handle binary'), new Error('Native probe failed'), 'FAIL\r\n'],
    async (win, rm) => {
      expect(await win.probeReadDetection()).toEqual({ available: false, handle: null, rm: false });
      expect(rm.isRestartManagerAvailable()).toBe(false);
      expect(win.isReadDetectionAvailable()).toBe(false);
    },
  );
});

it.skipIf(process.platform !== 'win32')(
  'preserves Unicode through the actual CWD fallback pipeline',
  async () => {
    await withProviders(
      [
        new Error('helper missing'),
        (file, args, opts, cb) => {
          const fixture =
            'function Get-CimInstance { [pscustomobject]@{ProcessId=42;CommandLine=(\'node --cwd "X:\\проект"\');CreationDate=([DateTimeOffset]::FromUnixTimeMilliseconds(1717000000000)).UtcDateTime} };';
          realExecFile(
            file,
            [...args.slice(0, -1), fixture + args.at(-1)],
            { ...opts, windowsHide: true },
            cb,
          );
        },
      ],
      async (win) => {
        expect(await win.getProcessCwds([42])).toEqual(
          new Map([
            [
              42,
              {
                cwd: 'X:\\проект',
                createTime100ns: null,
                startTimeMs: 1717000000000,
              },
            ],
          ]),
        );
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
        {
          ProcessId: 42,
          CommandLine: 'node --cwd "X:\\проект"',
          CreateTime100ns: '133614736000000001',
        },
        { ProcessId: 43, CommandLine: null, CreateTime100ns: '133614736000000002' },
      ]),
      native([]),
    ],
    async (win, rm, exec) => {
      expect(await win.getProcessCwds([42, 43, 44])).toEqual(
        new Map([
          [
            42,
            {
              cwd: 'X:\\проект',
              createTime100ns: '133614736000000001',
              startTimeMs: 1717000000000,
            },
          ],
          [43, { cwd: null, createTime100ns: '133614736000000002', startTimeMs: 1717000000000 }],
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
      native([{ index: 0, holders: [{ pid: 42, createTime100ns: '133000000000000001' }] }]),
      native([]),
      (file, args, opts, cb) => {
        const [group] = JSON.parse(opts.env.AEGIS_RM_GROUPS);
        cb(
          null,
          JSON.stringify([
            {
              group: group.group,
              reason: group.reason,
              holders: [{ pid: 43, createTime100ns: '133000000000000002' }],
            },
          ]),
        );
      },
    ],
    async (win, rm, exec) => {
      const groups = rm.buildSensitiveGroups(['fixture'], false);
      expect(await rm.getSensitiveHolders(['fixture'], false)).toEqual([
        {
          pid: 42,
          createTime100ns: '133000000000000001',
          group: groups[0].group,
          reason: 'fixture',
        },
      ]);
      expect(await rm.getSensitiveHolders(['fixture'], false)).toEqual([
        {
          pid: 43,
          createTime100ns: '133000000000000002',
          group: groups[0].group,
          reason: 'fixture',
        },
      ]);
      expect(exec.mock.calls.map((c) => c[0])).toEqual([
        '/observer',
        '/observer',
        'powershell.exe',
      ]);
    },
  );
});

it('rejects a malformed fallback holder instead of reporting a clean empty scan', async () => {
  await withProviders(
    [
      native([]),
      (file, args, opts, cb) => {
        const [group] = JSON.parse(opts.env.AEGIS_RM_GROUPS);
        cb(
          null,
          JSON.stringify([
            {
              group: group.group,
              reason: group.reason,
              holders: [{ pid: 43, createTime100ns: '0' }],
            },
          ]),
        );
      },
    ],
    async (win, rm) => {
      await expect(rm.getSensitiveHolders(['fixture'], false)).rejects.toThrow(
        'Invalid Restart Manager fallback response',
      );
    },
  );
});
