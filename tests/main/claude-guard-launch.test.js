import { afterEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createClaudeGuardLauncher } = require('../../src/main/claude-guard-launch');
const directories = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function fixture() {
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
  const startReceiver = vi.fn().mockResolvedValue(receiver);
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
    openRead: async () => reader,
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
