import { afterAll, expect, it, vi } from 'vitest';
import Module from 'module';
const show = vi.fn();
const notification = vi.fn(function () {
  return { show };
});
notification.isSupported = () => true;
const originalLoad = Module._load;
Module._load = function (request) {
  if (request === 'electron') return { Notification: notification };
  return originalLoad.apply(this, arguments);
};
afterAll(() => {
  Module._load = originalLoad;
});
const tray = (await import('../../src/main/tray-icon.js')).default;
const entry = { agentName: 'Claude', pattern: '^C:/work/\\.env$', timestamp: 1 };
const event = {
  agent: 'Claude',
  file: 'C:/work/.env',
  sensitive: true,
  reason: 'Sensitive path',
  attribution: { status: 'confirmed', evidence: ['handle-scan-pid'] },
};
it('simple-exceptions: suppresses matching popups, retains observations and resumes after undo', () => {
  let patterns = [entry];
  const state = {
    getSettings: () => ({ notificationsEnabled: true, falsePositivePatterns: patterns }),
    lastNotificationTime: 0,
  };
  tray.init(state);
  const retained = [event];
  const captured = structuredClone(retained);
  tray.notifySensitive(retained);
  expect(notification).not.toHaveBeenCalled();
  expect(state.lastNotificationTime).toBe(0);
  expect(retained).toEqual(captured);
  patterns = [];
  tray.notifySensitive(retained);
  expect(show).toHaveBeenCalledTimes(1);
  expect(retained).toEqual(captured);
});
it.each([
  { label: 'unrelated path', row: { ...event, file: 'C:/work/other.env' } },
  { label: 'unrelated owner', row: { ...event, agent: 'Codex' } },
  {
    label: 'unknown owner',
    row: { ...event, attribution: { status: 'unattributed', evidence: [] } },
  },
  { label: 'legacy unknown owner', row: { ...event, attribution: 'unattributed' } },
])('simple-exceptions: retains native delivery for $label', ({ row }) => {
  notification.mockClear();
  tray.init({
    getSettings: () => ({ notificationsEnabled: true, falsePositivePatterns: [entry] }),
    lastNotificationTime: 0,
  });
  tray.notifySensitive([row]);
  expect(notification).toHaveBeenCalledTimes(1);
  if (row.attribution === 'unattributed' || row.attribution?.status === 'unattributed') {
    expect(notification.mock.calls[0][0].body).toContain('Unknown source');
    expect(notification.mock.calls[0][0].body).not.toContain('Claude');
  }
});
