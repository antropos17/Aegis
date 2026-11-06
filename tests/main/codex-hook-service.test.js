import { expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createCodexHookService } = require('../../src/main/codex-hook-service');

function fixture() {
  const handoff = {
    ok: true,
    profilePath: 'C:/AEGIS/codex-hook-profile/hooks.json',
    profileIdentity: 'aaaaaaaaaaaaaaaa:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    profileSha256: 'a'.repeat(64),
    policyPath: 'C:/Project/policy.json',
    policyIdentity: 'bbbbbbbbbbbbbbbb:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    policySha256: 'b'.repeat(64),
    cwd: 'C:/Project',
    codexPath: 'C:/Tools/codex.exe',
    codexIdentity: 'test-identity',
    codexSha256: 'c'.repeat(64),
  };
  const status = {
    success: true,
    code: 'IDLE',
    available: true,
    canInstall: true,
    canRemove: true,
    canOpen: true,
  };
  const profile = {
    reviewLaunch: vi.fn(async () => handoff),
    handle: vi.fn(async () => status),
    close: vi.fn(),
    hasPending: () => false,
  };
  const clipboard = { writeText: vi.fn() };
  let approve = true,
    owned = true;
  const dialog = { showMessageBox: vi.fn(async () => ({ response: approve ? 1 : 0 })) };
  const service = createCodexHookService({
    profile,
    clipboard,
    dialog,
    getWindow: () => ({}),
    executable: 'C:/Program Files/AEGIS & Monitor/AEGIS.exe',
    appPath: 'C:/Program Files/AEGIS & Monitor/resources/app.asar',
    powershell: 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',
  });
  return {
    service,
    profile,
    clipboard,
    dialog,
    setApprove: (value) => {
      approve = value;
    },
    setOwned: (value) => {
      owned = value;
    },
    owned: () => owned,
  };
}

it('copies only after two trusted reviews and returns no paths, token, script or command', async () => {
  const f = fixture();
  const result = await f.service.handle('prepare-launch', f.owned);
  expect(result).toMatchObject({ success: true, code: 'LAUNCH_READY' });
  expect(f.profile.reviewLaunch).toHaveBeenCalledOnce();
  expect(f.dialog.showMessageBox.mock.calls[0][1]).toMatchObject({ defaultId: 0, cancelId: 0 });
  const detail = f.dialog.showMessageBox.mock.calls[0][1].detail;
  expect(detail).toContain('Decoded terminal script:');
  expect(detail).toContain('Review and trust the exact non-managed hook');
  expect(detail).toContain('identity through execution is not guaranteed');
  expect(f.clipboard.writeText).toHaveBeenCalledOnce();
  for (const secret of ['C:/Project', 'codex-hook-profile', '--config', 'aaaaaaaa'])
    expect(JSON.stringify(result)).not.toContain(secret);
  await f.service.close();
});

it('does not copy a cancelled or renderer-revoked launch', async () => {
  const f = fixture();
  f.setApprove(false);
  expect(await f.service.handle('prepare-launch', f.owned)).toMatchObject({ code: 'CANCELLED' });
  expect(f.clipboard.writeText).not.toHaveBeenCalled();
  f.setApprove(true);
  f.dialog.showMessageBox.mockImplementationOnce(async () => {
    f.setOwned(false);
    return { response: 1 };
  });
  expect(await f.service.handle('prepare-launch', f.owned)).toEqual({
    success: false,
    error: 'Renderer request denied',
  });
  expect(f.clipboard.writeText).not.toHaveBeenCalled();
  await f.service.close();
});

it('preserves a native retained-unknown result rather than copying a command', async () => {
  const f = fixture();
  f.profile.reviewLaunch.mockResolvedValueOnce({ ok: false, code: 'RETAINED_UNKNOWN' });
  f.profile.handle.mockResolvedValueOnce({
    success: true,
    code: 'RETAINED_UNKNOWN',
    available: true,
    canInstall: false,
    canRemove: false,
    canOpen: true,
  });
  expect(await f.service.handle('prepare-launch', f.owned)).toMatchObject({
    code: 'RETAINED_UNKNOWN',
  });
  expect(f.clipboard.writeText).not.toHaveBeenCalled();
  await f.service.close();
});
