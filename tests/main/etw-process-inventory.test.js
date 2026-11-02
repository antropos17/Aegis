import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import {
  captureDurableProcessInventory,
  inventoryPowerShell,
  projectOwnedProcessInventory,
  INVENTORY_TOTAL_MS,
} from '../../tools/development/etw-process-inventory.mjs';

const seams = vi.hoisted(() => ({
  launch: vi.fn(),
  paths: vi.fn(),
  diagnostics: vi.fn(),
  oldOwn: vi.fn(),
  oldHelpers: vi.fn(),
  observe: vi.fn(),
  window: vi.fn(),
  reservation: vi.fn(),
  retainFailure: vi.fn(),
}));
vi.mock('playwright', () => ({ _electron: { launch: seams.launch } }));
vi.mock('../../frontend/observatory/tests/etw-support.mjs', () => ({
  scenarioPaths: seams.paths,
  diagnostics: seams.diagnostics,
  traceHelpers: seams.oldHelpers,
}));
vi.mock('../../frontend/observatory/tests/sensor-support.mjs', () => ({
  ownedPids: seams.oldOwn,
  exitWithin: vi.fn(),
}));
vi.mock('../../frontend/observatory/tests/etw-custodian-support.mjs', () => ({
  observeCustodian: seams.observe,
}));
vi.mock('../../frontend/observatory/tests/etw-failure-support.mjs', () => ({
  waitOwnedExit: vi.fn(),
}));
vi.mock('../../frontend/observatory/tests/package-window-observation.mjs', () => ({
  observePackageWindow: seams.window,
}));
vi.mock('../../tools/development/etw-startup-evidence.mjs', () => ({
  waitForJournalReservation: seams.reservation,
  retainStartupFailure: seams.retainFailure,
}));
import { durableLaunch } from '../../frontend/observatory/tests/etw-durable-support.mjs';

beforeEach(() => vi.resetAllMocks());
const folders = [];
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  for (const folder of folders.splice(0)) {
    expect(path.dirname(folder)).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(folder).startsWith('aegis-inventory-')).toBe(true);
    expect(fs.lstatSync(folder).isSymbolicLink()).toBe(false);
    fs.rmSync(folder, { recursive: true });
  }
});
describe('actual durable caller inventory composition', () => {
  it('consumes one controlled bounded inventory result instead of the legacy synchronous query chain', async () => {
    vi.stubEnv('TEMP', undefined);
    const out = path.join(os.tmpdir(), 'aegis-inventory-mocked-only');
    const child = { pid: 10 };
    const page = { getByRole: () => ({ waitFor: async () => {} }) };
    const app = { process: () => child, firstWindow: async () => page };
    const reserved = { originalPids: [10, 11, 12, 13, 14], custodianPid: 15 };
    const observer = { until: vi.fn().mockResolvedValue({ address: 'synthetic-endpoint' }) };
    seams.paths.mockReturnValue({ home: out, profile: out, fixture: out, temp: out });
    seams.launch.mockResolvedValue(app);
    seams.observe.mockReturnValue(observer);
    seams.reservation.mockResolvedValue(reserved);
    seams.window.mockResolvedValue({ packaged: true });
    seams.diagnostics.mockResolvedValue({ nativeProcessIds: [11, 12, 13, 14] });
    seams.oldOwn.mockResolvedValue([10, 20]);
    seams.oldHelpers.mockReturnValue([11, 12, 13, 14]);
    const collectInventory = vi
      .fn()
      .mockResolvedValue({ own: [10, 20, 21], helpers: [11, 12, 13, 14, 22] });
    const result = await durableLaunch({
      executable: path.join(out, 'owned.exe'),
      out,
      canary: 'synthetic-only',
      fault: 'orphan-total-running',
      total: true,
      collectInventory,
    });
    expect(collectInventory).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        app,
        rootPid: 10,
        nativeIds: [11, 12, 13, 14],
        originalPids: reserved.originalPids,
        custodianPid: 15,
        env: expect.objectContaining({ HOME: out }),
      }),
    );
    expect(result.own).toEqual([10, 20, 21]);
    expect(result.helpers).toEqual([11, 12, 13, 14, 22]);
    expect(seams.oldOwn).not.toHaveBeenCalled();
    expect(seams.oldHelpers).not.toHaveBeenCalled();
  });
  it('retains the actual inventory refusal before closing its owned main and observer', async () => {
    vi.stubEnv('TEMP', undefined);
    const out = path.join(os.tmpdir(), 'aegis-inventory-mocked-only');
    const app = {
      process: () => ({ pid: 10 }),
      firstWindow: async () => ({ getByRole: () => ({ waitFor: async () => {} }) }),
    };
    const observer = { until: vi.fn().mockResolvedValue({ address: 'synthetic-endpoint' }) };
    seams.paths.mockReturnValue({ home: out, profile: out, fixture: out, temp: out });
    seams.launch.mockResolvedValue(app);
    seams.observe.mockReturnValue(observer);
    seams.window.mockResolvedValue({ packaged: true });
    seams.reservation.mockResolvedValue({ originalPids: [10, 11, 12, 13, 14], custodianPid: 15 });
    seams.diagnostics.mockResolvedValue({ nativeProcessIds: [11, 12, 13, 14] });
    const failure = new Error('Owned process inventory refused: timeout');
    await expect(
      durableLaunch({
        executable: path.join(out, 'owned.exe'),
        out,
        canary: 'synthetic-only',
        fault: 'orphan-total-running',
        collectInventory: async () => {
          throw failure;
        },
      }),
    ).rejects.toBe(failure);
    expect(seams.retainFailure).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        stage: 'process-inventory',
        observer,
        readDiagnostics: expect.any(Function),
        closeMain: expect.any(Function),
      }),
    );
  });
});

const inputs = {
  rootPid: 10,
  metricPids: [10, 20],
  nativeIds: [11, 12, 13, 14],
  originalPids: [10, 11, 12, 13, 14],
  custodianPid: 15,
};
const rows = [
  [10, 999, false],
  [20, 10, false],
  [21, 10, false],
  [11, 10, true],
  [12, 11, true],
  [13, 12, true],
  [14, 12, true],
  [15, 12, true],
  [30, 20, false],
  [31, 30, true],
  [32, 31, false],
  [33, 32, true],
  [34, 33, true],
  [90, 999, true],
  [91, 90, true],
].map(([pid, parentPid, native]) => ({ pid, parentPid, native }));
const expectedOwn = [10, 11, 20, 21],
  expectedHelpers = [11, 12, 13, 14, 15, 31, 33];
const selected = [10, 11, 12, 13, 14, 15, 20, 21, 30, 31, 32, 33];
const projection = {
  schema: 1,
  rootPid: 10,
  rows: rows.filter((row) => selected.includes(row.pid)),
};
function child() {
  const value = new EventEmitter();
  value.stdout = new EventEmitter();
  value.stderr = new EventEmitter();
  value.stdout.destroy = vi.fn();
  value.stderr.destroy = vi.fn();
  value.unref = vi.fn();
  value.kill = vi.fn(() => {
    queueMicrotask(() => value.emit('close', null, 'SIGTERM'));
    return true;
  });
  return value;
}
function options(spawnProcess) {
  return {
    app: { evaluate: vi.fn().mockResolvedValue(inputs.metricPids) },
    ...inputs,
    env: {
      SystemRoot: 'C:\\Windows',
      TEMP: os.tmpdir(),
      HOME: os.tmpdir(),
      PSMODULEPATH: 'PRIVATE_UNWANTED_MODULE_PATH',
    },
    spawnProcess,
  };
}
describe('one bounded owned process snapshot', () => {
  it('preserves direct app children and the exact four-level helper graph while excluding foreign trees', () => {
    expect(projectOwnedProcessInventory(rows, inputs)).toEqual({
      own: expectedOwn,
      helpers: expectedHelpers,
      selectedPids: selected,
    });
    expect(inventoryPowerShell(inputs).match(/Get-CimInstance/g)).toHaveLength(1);
    expect(inventoryPowerShell(inputs)).toContain("$ErrorActionPreference='Stop'");
    expect(inventoryPowerShell(inputs)).not.toMatch(/CommandLine|ExecutablePath/);
  });
  it('spawns once with process-only inbox modules and permits observer progress until the original child closes', async () => {
    const owned = child(),
      spawn = vi.fn(() => owned),
      args = options(spawn);
    const originalEnv = { ...args.env };
    let settled = false;
    const promise = captureDurableProcessInventory(args).then((value) => {
      settled = true;
      return value;
    });
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledTimes(1));
    const [file, argv, supplied] = spawn.mock.calls[0];
    expect(file).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    expect(argv.slice(0, 5)).toEqual([
      '-NoProfile',
      '-NonInteractive',
      '-OutputFormat',
      'Text',
      '-EncodedCommand',
    ]);
    expect(Buffer.from(argv[5], 'base64').toString('utf16le')).toBe(inventoryPowerShell(inputs));
    expect(Object.keys(supplied.env).filter((key) => key.toLowerCase() === 'psmodulepath')).toEqual(
      ['PSModulePath'],
    );
    expect(supplied.env.PSModulePath).toBe(
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules',
    );
    expect(args.env).toEqual(originalEnv);
    expect(supplied).toMatchObject({ shell: false, windowsHide: true, cwd: os.tmpdir() });
    const observer = new EventEmitter();
    let drained = false;
    observer.on('data', () => {
      drained = true;
    });
    await Promise.resolve().then(() => observer.emit('data', 'running'));
    expect(drained).toBe(true);
    expect(settled).toBe(false);
    owned.stdout.emit('data', Buffer.from(JSON.stringify(projection)));
    owned.emit('exit', 0, null);
    await Promise.resolve();
    expect(settled).toBe(false);
    owned.emit('close', 0, null);
    await expect(promise).resolves.toEqual({ own: expectedOwn, helpers: expectedHelpers });
    expect(owned.kill).not.toHaveBeenCalled();
  });
  it.each([
    'denial',
    'stderr',
    'oversize',
    'malformed',
    'foreign',
    'missing-root',
    'duplicate',
    'unknown-field',
  ])('refuses %s as unknown instead of returning absence', async (mode) => {
    const owned = child();
    const spawn = () => {
      queueMicrotask(() => {
        if (mode === 'denial') {
          owned.emit('close', 5, null);
          return;
        }
        if (mode === 'stderr') {
          owned.stderr.emit('data', Buffer.from('PRIVATE_STDERR'));
          return;
        }
        if (mode === 'oversize') {
          owned.stdout.emit('data', Buffer.alloc(65537, 120));
          return;
        }
        const value = JSON.parse(JSON.stringify(projection));
        if (mode === 'foreign') value.rows.push({ pid: 90, parentPid: 999, native: true });
        if (mode === 'missing-root') value.rows = value.rows.filter((row) => row.pid !== 10);
        if (mode === 'duplicate') value.rows.push(value.rows[0]);
        if (mode === 'unknown-field') value.extra = 'PRIVATE_EXTRA';
        owned.stdout.emit(
          'data',
          Buffer.from(mode === 'malformed' ? 'PRIVATE_MALFORMED' : JSON.stringify(value)),
        );
        owned.emit('close', 0, null);
      });
      return owned;
    };
    let error;
    try {
      await captureDurableProcessInventory(options(spawn));
    } catch (value) {
      error = value;
    }
    expect(error?.message).toMatch(/^Owned process inventory refused: /);
    expect(error?.inventoryDiagnostic).toMatchObject({
      commandKind: 'owned-process-snapshot',
      childClosed: true,
    });
    expect(JSON.stringify(error)).not.toMatch(/PRIVATE_STDERR|PRIVATE_EXTRA|PRIVATE_MALFORMED/);
  });
  it.each([true, false])(
    'keeps the 30s total deadline when original-child closure is %s',
    async (closes) => {
      vi.useFakeTimers();
      const owned = child();
      if (!closes) owned.kill.mockReturnValue(true);
      expect(INVENTORY_TOTAL_MS).toBe(30000);
      const started = Date.now();
      let settledAt;
      const promise = captureDurableProcessInventory(options(() => owned)).finally(() => {
        settledAt = Date.now() - started;
      });
      const rejected = expect(promise).rejects.toMatchObject({
        message: 'Owned process inventory refused: timeout',
        inventoryDiagnostic: {
          commandKind: 'owned-process-snapshot',
          code: 'timeout',
          childClosed: closes,
        },
      });
      await vi.advanceTimersByTimeAsync(INVENTORY_TOTAL_MS - 2000);
      expect(owned.kill).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(2000);
      await rejected;
      if (!closes) expect(owned.unref).toHaveBeenCalledTimes(1);
      expect(settledAt).toBe(closes ? 28000 : INVENTORY_TOTAL_MS);
    },
  );
  it('bounds a stalled Electron metrics read without launching any command', async () => {
    vi.useFakeTimers();
    const spawn = vi.fn();
    const args = options(spawn);
    args.app.evaluate.mockReturnValue(new Promise(() => {}));
    const rejected = expect(captureDurableProcessInventory(args)).rejects.toThrow(
      'metrics-timeout',
    );
    await vi.advanceTimersByTimeAsync(28000);
    await rejected;
    expect(spawn).not.toHaveBeenCalled();
  });
  it('never starts a query for malformed or foreign native seeds', async () => {
    const spawn = vi.fn();
    await expect(
      captureDurableProcessInventory({ ...options(spawn), nativeIds: [90] }),
    ).rejects.toThrow('seed-shape');
    expect(spawn).not.toHaveBeenCalled();
  });
  it.skipIf(process.platform !== 'win32')(
    'executes the actual PowerShell graph against one mocked CIM snapshot without querying the primary process table',
    () => {
      const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-inventory-'));
      folders.push(folder);
      fs.writeFileSync(path.join(folder, 'rows.json'), JSON.stringify({ rows }));
      fs.writeFileSync(path.join(folder, 'command.txt'), inventoryPowerShell(inputs));
      const fixture = path.join(folder, 'fixture.ps1');
      fs.writeFileSync(
        fixture,
        String.raw`$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue'
$snapshot=(ConvertFrom-Json -InputObject ([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'rows.json')))).rows;$script:queries=0
function Get-CimInstance { param($ClassName,[string[]]$Property,[int]$OperationTimeoutSec)
  if($ClassName -cne 'Win32_Process' -or ($Property -join ',') -cne 'ProcessId,ParentProcessId,Name' -or $OperationTimeoutSec -ne 20){throw 'unexpected-query'};$script:queries++
  foreach($row in $snapshot){[pscustomobject]@{ProcessId=$row.pid;ParentProcessId=$row.parentPid;Name=$(if($row.native){'EtwFile.exe'}else{'PRIVATE_UNRELATED_PROCESS_NAME'})}}
}
$text=& ([scriptblock]::Create([IO.File]::ReadAllText((Join-Path $PSScriptRoot 'command.txt'))))
if($script:queries -ne 1 -or $text.Contains('PRIVATE_UNRELATED_PROCESS_NAME')){throw 'query-projection-refused'}
$text
`,
      );
      const result = spawnSync(
        path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
        ['-NoProfile', '-NonInteractive', '-File', fixture],
        {
          cwd: folder,
          env: {
            ...process.env,
            PSModulePath: path.join(
              process.env.SystemRoot,
              'System32/WindowsPowerShell/v1.0/Modules',
            ),
          },
          encoding: 'utf8',
          windowsHide: true,
          timeout: 15000,
          maxBuffer: 8192,
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      expect(result.stderr).toBe('');
      const value = JSON.parse(result.stdout.replace(/^\uFEFF/, '').trim());
      expect(value).toMatchObject({ schema: 1, rootPid: 10 });
      expect(value.rows.map((row) => row.pid).sort((a, b) => a - b)).toEqual(selected);
      expect(projectOwnedProcessInventory(value.rows, inputs)).toEqual({
        own: expectedOwn,
        helpers: expectedHelpers,
        selectedPids: selected,
      });
    },
  );
});
