import { afterEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const {
  createClaudeGuardLauncher,
  buildClaudeGuardCommand,
} = require('../../src/main/claude-guard-launch');
const directories = [];

it('builds one synchronous PowerShell command with a single quoted native archive argument', () => {
  const command = buildClaudeGuardCommand(
    'C:\\Program Files\\AEGIS.exe',
    'C:\\App Folder\\app.asar',
    1234,
    'b'.repeat(32),
  );
  expect(command).toBe(
    `& { try { $aegisGuardProcess = Microsoft.PowerShell.Management\\Start-Process -FilePath 'C:\\Program Files\\AEGIS.exe' -ArgumentList '"C:\\App Folder\\app.asar" --claude-guard-session 1234 ${'b'.repeat(32)}' -NoNewWindow -Wait -PassThru -ErrorAction Stop; ` +
      "if ($aegisGuardProcess.ExitCode -ne 0) { Microsoft.PowerShell.Utility\\Write-Host 'AEGIS Guard session did not complete successfully.' } " +
      "} catch { Microsoft.PowerShell.Utility\\Write-Host 'AEGIS Guard session could not start.' } }",
  );
});

it('quotes apostrophes, ampersands and terminal backslashes without exposing a launch key', () => {
  const command = buildClaudeGuardCommand(
    "C:\\Owner's & Tools\\AEGIS.exe",
    "C:\\Owner's & Project\\",
    65535,
    'a'.repeat(32),
  );
  expect(command).toBe(
    `& { try { $aegisGuardProcess = Microsoft.PowerShell.Management\\Start-Process -FilePath 'C:\\Owner''s & Tools\\AEGIS.exe' -ArgumentList '"C:\\Owner''s & Project\\\\" --claude-guard-session 65535 ${'a'.repeat(32)}' -NoNewWindow -Wait -PassThru -ErrorAction Stop; ` +
      "if ($aegisGuardProcess.ExitCode -ne 0) { Microsoft.PowerShell.Utility\\Write-Host 'AEGIS Guard session did not complete successfully.' } " +
      "} catch { Microsoft.PowerShell.Utility\\Write-Host 'AEGIS Guard session could not start.' } }",
  );
  expect(command).not.toContain('launchKey');
  expect(command).not.toContain('capability');
});

it.each([
  ['relative', 'C:\\app.asar', 1234, 'a'.repeat(32)],
  ['C:\\Bad"Name\\app.exe', 'C:\\app.asar', 1234, 'a'.repeat(32)],
  ['C:\\app.exe', 'C:\\line\nfeed', 1234, 'a'.repeat(32)],
  ['C:\\app.exe', 'C:\\hidden\u0085control', 1234, 'a'.repeat(32)],
  ['\\\\server\\share\\app.exe', 'C:\\app.asar', 1234, 'a'.repeat(32)],
  ['C:\\app.exe', 'C:\\app.asar', 0, 'a'.repeat(32)],
  ['C:\\app.exe', 'C:\\app.asar', 1234, 'a'.repeat(31)],
])('rejects unsafe or invalid copied launch arguments', (executable, appPath, port, sessionId) => {
  expect(() => buildClaudeGuardCommand(executable, appPath, port, sessionId)).toThrow(
    'unsupported-launch-command',
  );
});

it.each(Array.from({ length: 8 }, (_, index) => String.fromCodePoint(0x2018 + index)))(
  'rejects PowerShell smart quote %s in executable or archive path',
  (quote) => {
    const injected = `C:\\owner${quote}; Write-Output INERT; ${quote}\\file`;
    expect(() => buildClaudeGuardCommand(injected, 'C:\\app.asar', 1234, 'a'.repeat(32))).toThrow();
    expect(() => buildClaudeGuardCommand('C:\\app.exe', injected, 1234, 'a'.repeat(32))).toThrow();
  },
);

it.skipIf(process.platform !== 'win32')(
  'rejects a path that PowerShell would parse as a separate inert command',
  () => {
    const injected = 'C:\\sample\u2019; Write-Output INERT; \u2018';
    const formerlyUnsafe = `Start-Process -FilePath '${injected}' -Wait`;
    const encodedInput = Buffer.from(formerlyUnsafe, 'utf16le').toString('base64');
    const parserScript = `
      $sourceText = [System.Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encodedInput}'))
      $parsedTokens = $null
      $parsedErrors = $null
      $tree = [System.Management.Automation.Language.Parser]::ParseInput($sourceText, [ref]$parsedTokens, [ref]$parsedErrors)
      $names = @($tree.FindAll({ param($node) $node -is [System.Management.Automation.Language.CommandAst] }, $true) | ForEach-Object { $_.GetCommandName() })
      $names -join ','
    `;
    const parser = spawnSync(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(parserScript, 'utf16le').toString('base64'),
      ],
      { encoding: 'utf8', timeout: 5000, windowsHide: true },
    );
    expect(parser.status).toBe(0);
    expect(parser.stdout.trim()).toBe('Start-Process,Write-Output');
    expect(() => buildClaudeGuardCommand(injected, 'C:\\app.asar', 1234, 'a'.repeat(32))).toThrow(
      'unsupported-launch-command',
    );
  },
);

it.skipIf(process.platform !== 'win32')(
  'shows fixed nonzero and startup feedback in real PowerShell without changing outer variables',
  () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'aegis-guard-powershell-'));
    directories.push(directory);
    const special = path.join(directory, "Owner's & tools");
    mkdirSync(special);
    const source = path.join(special, 'Stub.cs');
    const executable = path.join(special, "Aegis's & App.exe");
    writeFileSync(
      source,
      'using System; using System.Threading; class Stub { static int Main(string[] args) { Thread.Sleep(150); Console.WriteLine("STUB_FINISHED"); return args.Length == 4 && !args[0].Contains("exit2") ? 0 : 2; } }',
    );
    const csc = path.join(
      process.env.WINDIR || 'C:\\Windows',
      'Microsoft.NET',
      'Framework64',
      'v4.0.30319',
      'csc.exe',
    );
    const compiled = spawnSync(csc, ['/nologo', `/out:${executable}`, source], {
      encoding: 'utf8',
      timeout: 10000,
      windowsHide: true,
    });
    expect(compiled.status, compiled.stderr || compiled.stdout).toBe(0);
    const run = (exe, appPath) => {
      const command = buildClaudeGuardCommand(exe, appPath, 1234, 'b'.repeat(32));
      const script = `$aegisGuardProcess = 'OUTER_UNCHANGED'; ${command}; Write-Output ('OUTER=' + $aegisGuardProcess)`;
      return spawnSync(
        'powershell.exe',
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-EncodedCommand',
          Buffer.from(script, 'utf16le').toString('base64'),
        ],
        { encoding: 'utf8', timeout: 10000, windowsHide: true },
      );
    };
    const success = run(executable, "C:\\Project's & area\\exit0\\");
    expect(success.status, success.stderr).toBe(0);
    expect(success.stdout).toContain('STUB_FINISHED');
    expect(success.stdout).not.toContain('AEGIS Guard session did not complete successfully.');
    expect(success.stdout).toContain('OUTER=OUTER_UNCHANGED');

    const failure = run(executable, "C:\\Project's & area\\exit2\\");
    expect(failure.status, failure.stderr).toBe(0);
    expect(failure.stdout).toContain('STUB_FINISHED');
    expect(failure.stdout).toContain('AEGIS Guard session did not complete successfully.');
    expect(failure.stdout.indexOf('STUB_FINISHED')).toBeLessThan(
      failure.stdout.indexOf('AEGIS Guard session did not complete successfully.'),
    );
    expect(failure.stdout).toContain('OUTER=OUTER_UNCHANGED');

    const unavailable = run(path.join(special, 'missing.exe'), 'C:\\app.asar');
    expect(unavailable.status, unavailable.stderr).toBe(0);
    expect(unavailable.stdout).toContain('AEGIS Guard session could not start.');
    expect(unavailable.stdout).toContain('OUTER=OUTER_UNCHANGED');
    expect(unavailable.stdout).not.toContain(special);
  },
);

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function fixture(overrides = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), 'aegis-guard-launch-'));
  directories.push(directory);
  const target = path.join(directory, 'settings.json');
  const program = path.join(directory, 'claude.exe');
  const cwd = path.join(directory, 'work');
  writeFileSync(target, '{}');
  writeFileSync(program, 'fixture');
  mkdirSync(cwd);
  const clipboard = { writeText: vi.fn() };
  const dialog = {
    showOpenDialog: vi
      .fn()
      .mockResolvedValueOnce({ canceled: false, filePaths: [program] })
      .mockResolvedValueOnce({ canceled: false, filePaths: [cwd] }),
    showMessageBox: vi.fn().mockResolvedValue({ response: 1 }),
  };
  const receiver = {
    port: 1234,
    sessionId: 'b'.repeat(32),
    launchKey: 'c'.repeat(24),
    snapshot: () => ({ status: 'waiting', available: true, entries: [] }),
    close: vi.fn().mockResolvedValue(),
  };
  const startReceiver = overrides.startReceiver || vi.fn().mockResolvedValue(receiver);
  const reader = {
    close: vi.fn().mockResolvedValue(),
    status: () => ({ admission: 'closed', exit: 'confirmed' }),
  };
  const binding = Object.freeze({});
  const admission = {
    capture: vi.fn().mockResolvedValue(binding),
    verify: vi.fn().mockResolvedValue(true),
    close: vi.fn(),
  };
  const launcher = createClaudeGuardLauncher({
    target,
    executable: path.join(directory, 'AEGIS.exe'),
    appPath: path.join(directory, 'app.asar'),
    dialog,
    getWindow: () => ({}),
    clipboard,
    startReceiver,
    openRead: overrides.openRead || (async () => reader),
    createAdmission: () => admission,
    checkIntervalMs: 20,
  });

  return {
    launcher,
    dialog,
    clipboard,
    startReceiver,
    receiver,
    reader,
    admission,
    program,
    cwd,
    target,
  };
}

it.skipIf(process.platform !== 'win32')(
  'waits for a pending native open and confirmed cleanup during shutdown',
  async () => {
    let resolveOpen;
    const openRead = vi.fn(() => new Promise((resolve) => (resolveOpen = resolve)));
    const f = fixture({ openRead });
    const starting = f.launcher.start(() => true);
    await vi.waitFor(() => expect(openRead).toHaveBeenCalledOnce());
    let stopped = false;
    const closing = f.launcher.close().then(() => {
      stopped = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(stopped).toBe(false);
    resolveOpen(f.reader);
    expect(await starting).toBe('GUARD_UNAVAILABLE');
    await closing;
    expect(f.reader.close).toHaveBeenCalledOnce();
    expect(f.startReceiver).not.toHaveBeenCalled();
    expect(f.launcher.hasPending()).toBe(false);
  },
);

it.skipIf(process.platform !== 'win32')(
  'waits for a pending listener startup during shutdown',
  async () => {
    let resolveReceiver;
    const startReceiver = vi.fn(() => new Promise((resolve) => (resolveReceiver = resolve)));
    const f = fixture({ startReceiver });
    const starting = f.launcher.start(() => true);
    await vi.waitFor(() => expect(startReceiver).toHaveBeenCalledOnce());
    let stopped = false;
    const closing = f.launcher.close().then(() => {
      stopped = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(stopped).toBe(false);
    resolveReceiver(f.receiver);
    expect(await starting).toBe('GUARD_UNAVAILABLE');
    await closing;
    expect(f.receiver.close).toHaveBeenCalled();
    expect(f.reader.close).toHaveBeenCalledOnce();
    expect(f.launcher.hasPending()).toBe(false);
  },
);

it.skipIf(process.platform !== 'win32')(
  'refuses another session when native cleanup cannot be confirmed',
  async () => {
    const f = fixture();
    f.reader.status = () => ({ admission: 'closed', exit: 'unknown' });
    expect(await f.launcher.start(() => true)).toBe('GUARD_READY');
    expect(await f.launcher.stop()).toBe(false);
    expect(await f.launcher.start(() => true)).toBe('GUARD_RELEASE_UNCONFIRMED');
    expect(f.launcher.snapshot()).toMatchObject({ status: 'refused', lossDetected: true });
  },
);

it.skipIf(process.platform !== 'win32')(
  'refuses restart when expired-session cleanup is unconfirmed',
  async () => {
    const f = fixture();
    expect(await f.launcher.start(() => true)).toBe('GUARD_READY');
    f.receiver.snapshot = () => ({ status: 'expired', available: false, entries: [] });
    f.reader.status = () => ({ admission: 'closed', exit: 'unknown' });
    expect(await f.launcher.start(() => true)).toBe('GUARD_RELEASE_UNCONFIRMED');
    expect(f.reader.close).toHaveBeenCalledOnce();
    expect(f.startReceiver).toHaveBeenCalledOnce();
    expect(f.launcher.snapshot()).toMatchObject({ status: 'refused', lossDetected: true });
  },
);

it.skipIf(process.platform !== 'win32')(
  'requires exact selection and native confirmation without copying the launch secret',
  async () => {
    const f = fixture();
    expect(await f.launcher.start(() => true)).toBe('GUARD_READY');
    const call = f.startReceiver.mock.calls[0][0];
    expect(call.selection).toEqual({ executable: f.program, cwd: f.cwd, settings: f.target });
    expect(f.dialog.showMessageBox.mock.calls[0][1]).toMatchObject({ defaultId: 0, cancelId: 0 });
    expect(f.dialog.showMessageBox.mock.calls[1][1].detail).toContain(
      'cccc cccc cccc cccc cccc cccc',
    );
    expect(f.clipboard.writeText).toHaveBeenCalledOnce();
    expect(f.clipboard.writeText.mock.calls[0][0]).not.toContain(f.receiver.launchKey);
    expect(f.clipboard.writeText.mock.calls[0][0]).toContain('--claude-guard-session 1234');
    expect(await call.approve('123456')).toBe(true);
    expect(f.dialog.showMessageBox.mock.calls[2][1].detail).toContain('Code: 123456');
    expect(f.dialog.showMessageBox.mock.calls[2][1].detail).toContain(f.program);
    expect(f.dialog.showMessageBox.mock.calls[2][1].detail).toContain(f.cwd);
    expect(JSON.stringify(f.launcher.snapshot())).not.toContain(f.receiver.launchKey);
    await f.launcher.close();
    expect(f.receiver.close).toHaveBeenCalledOnce();
    expect(await call.approve('123456')).toBe(false);
  },
);

it.skipIf(process.platform !== 'win32')(
  'refuses an unverified profile before starting the receiver or copying a command',
  async () => {
    const f = fixture();
    f.admission.capture.mockResolvedValue(null);
    expect(await f.launcher.start(() => true)).toBe('GUARD_PROFILE_UNVERIFIED');
    expect(f.startReceiver).not.toHaveBeenCalled();
    expect(f.clipboard.writeText).not.toHaveBeenCalled();
    expect(f.reader.close).toHaveBeenCalledOnce();
  },
);

it.skipIf(process.platform !== 'win32')(
  'releases the read-only witness if native review fails',
  async () => {
    const f = fixture();
    f.dialog.showMessageBox.mockRejectedValueOnce(Error('PRIVATE_DIALOG_FAILURE'));
    expect(await f.launcher.start(() => true)).toBe('GUARD_UNAVAILABLE');
    expect(f.reader.close).toHaveBeenCalledOnce();
    expect(f.startReceiver).not.toHaveBeenCalled();
    expect(f.launcher.hasPending()).toBe(false);
  },
);

it.skipIf(process.platform !== 'win32')(
  'revokes an active reporting session after profile or policy drift is detected',
  async () => {
    const f = fixture();
    expect(await f.launcher.start(() => true)).toBe('GUARD_READY');
    f.admission.verify.mockResolvedValue(false);
    await vi.waitFor(() => expect(f.launcher.snapshot().status).toBe('refused'));
    expect(f.receiver.close).toHaveBeenCalledOnce();
    expect(f.reader.close).toHaveBeenCalledOnce();
    expect(f.launcher.snapshot().lossDetected).toBe(true);
  },
);

it.skipIf(process.platform !== 'win32')(
  'refuses admission when the selected executable changes after confirmation',
  async () => {
    const f = fixture();
    expect(await f.launcher.start(() => true)).toBe('GUARD_READY');
    writeFileSync(f.program, 'replacement executable contents');
    const verify = f.startReceiver.mock.calls[0][0].verify;
    expect(await verify()).toBe(false);
    await vi.waitFor(() => expect(f.launcher.snapshot().status).toBe('refused'));
    expect(f.receiver.close).toHaveBeenCalledOnce();
  },
);

it.skipIf(process.platform !== 'win32')(
  'cancels and closes the receiver if the one-time key dialog is declined',
  async () => {
    const f = fixture();
    f.dialog.showMessageBox
      .mockResolvedValueOnce({ response: 1 })
      .mockResolvedValueOnce({ response: 0 });
    expect(await f.launcher.start(() => true)).toBe('GUARD_CANCELLED');
    expect(f.receiver.close).toHaveBeenCalledOnce();
    expect(f.launcher.snapshot().status).toBe('inactive');
    expect(await f.startReceiver.mock.calls[0][0].approve('123456')).toBe(false);
  },
);
