import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { createRequire } from 'module';
import Module from 'module';

const require = createRequire(import.meta.url);

// Mock electron via Module._load
const mockTrayInstance = {
  setImage: vi.fn(),
  setToolTip: vi.fn(),
  setContextMenu: vi.fn(),
  on: vi.fn(),
  destroy: vi.fn(),
};
const mockTrayConstructor = vi.fn(function() { return mockTrayInstance; });
const mockBuildFromTemplate = vi.fn((template) => template);
const mockNotificationInstance = { show: vi.fn() };
const mockNotificationConstructor = vi.fn(function() { return mockNotificationInstance; });
const mockCreateFromBuffer = vi.fn((buf) => ({ buffer: buf, isNativeImage: true }));

const fakeElectron = {
  Tray: mockTrayConstructor,
  Menu: { buildFromTemplate: mockBuildFromTemplate },
  Notification: mockNotificationConstructor,
  nativeImage: { createFromBuffer: mockCreateFromBuffer },
};

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return fakeElectron;
  return originalLoad.apply(this, arguments);
};

afterAll(() => {
  Module._load = originalLoad;
});

describe('tray-icon', () => {
  let tray;

  beforeEach(() => {
    mockTrayInstance.setImage.mockClear();
    mockTrayInstance.setToolTip.mockClear();
    mockTrayInstance.setContextMenu.mockClear();
    mockTrayInstance.on.mockClear();
    mockTrayInstance.destroy.mockClear();
    mockTrayConstructor.mockClear();
    mockBuildFromTemplate.mockClear();
    mockNotificationConstructor.mockClear();
    mockNotificationInstance.show.mockClear();
    mockCreateFromBuffer.mockClear();

    const modPath = require.resolve('../../src/main/tray-icon.js');
    delete require.cache[modPath];
    tray = require('../../src/main/tray-icon.js');
  });

  function initTray(overrides = {}) {
    const state = {
      tray: null,
      currentTrayColor: 'green',
      lastNotificationTime: 0,
      getActivityLog: () => overrides.activityLog || [],
      getSettings: () => ({ notificationsEnabled: true, ...overrides.settings }),
      isMonitoringPaused: () => overrides.paused || false,
      setMonitoringPaused: vi.fn(),
      stopScanIntervals: vi.fn(),
      startScanIntervals: vi.fn(),
      getMainWindow: () => overrides.mainWindow || { show: vi.fn(), focus: vi.fn(), isDestroyed: () => false, webContents: { send: vi.fn() } },
      setIsQuitting: vi.fn(),
      appQuit: vi.fn(),
    };
    tray.init(state);
    return state;
  }

  describe('createTrayIconImage', () => {
    it('creates a valid PNG buffer for green', () => {
      tray.createTrayIconImage('green');
      expect(mockCreateFromBuffer).toHaveBeenCalled();
      const buf = mockCreateFromBuffer.mock.calls[0][0];
      expect(buf[0]).toBe(137);
      expect(buf[1]).toBe(80);
      expect(buf[2]).toBe(78);
      expect(buf[3]).toBe(71);
    });

    it('creates images for all color variants', () => {
      for (const color of ['green', 'yellow', 'red']) {
        const img = tray.createTrayIconImage(color);
        expect(img).toBeDefined();
      }
    });

    it('defaults to green for unknown color', () => {
      const img = tray.createTrayIconImage('purple');
      expect(img).toBeDefined();
    });
  });

  describe('updateTrayIcon', () => {
    it('does nothing when state not initialized', () => {
      const state = initTray();
      state.tray = null;
      tray.updateTrayIcon();
    });

    it('updates color when threat level changes', () => {
      const state = initTray({
        activityLog: Array.from({ length: 6 }, () => ({ sensitive: true })),
      });
      state.tray = { setImage: vi.fn(), setToolTip: vi.fn(), setContextMenu: vi.fn() };
      state.currentTrayColor = 'green';
      tray.updateTrayIcon();
      expect(state.currentTrayColor).toBe('red');
      expect(state.tray.setImage).toHaveBeenCalled();
    });

    it('does not update image when color unchanged', () => {
      const state = initTray({ activityLog: [] });
      state.tray = { setImage: vi.fn(), setToolTip: vi.fn(), setContextMenu: vi.fn() };
      state.currentTrayColor = 'green';
      tray.updateTrayIcon();
      expect(state.tray.setImage).not.toHaveBeenCalled();
    });

    it('shows [PAUSED] in tooltip when monitoring is paused', () => {
      const state = initTray({ paused: true, activityLog: [] });
      state.tray = { setImage: vi.fn(), setToolTip: vi.fn(), setContextMenu: vi.fn() };
      tray.updateTrayIcon();
      const tooltip = state.tray.setToolTip.mock.calls[0][0];
      expect(tooltip).toContain('[PAUSED]');
    });

    it('tooltip shows sensitive alert count', () => {
      const state = initTray({
        activityLog: [{ sensitive: true }, { sensitive: true }, { sensitive: false }],
      });
      state.tray = { setImage: vi.fn(), setToolTip: vi.fn(), setContextMenu: vi.fn() };
      tray.updateTrayIcon();
      const tooltip = state.tray.setToolTip.mock.calls[0][0];
      expect(tooltip).toContain('2 sensitive alerts');
    });
  });

  describe('getTrayThreatColor (tested via updateTrayIcon)', () => {
    it('green for 0 sensitive events', () => {
      const state = initTray({ activityLog: [] });
      state.tray = { setImage: vi.fn(), setToolTip: vi.fn(), setContextMenu: vi.fn() };
      state.currentTrayColor = 'red';
      tray.updateTrayIcon();
      expect(state.currentTrayColor).toBe('green');
    });

    it('yellow for 1-5 sensitive events', () => {
      const state = initTray({
        activityLog: [{ sensitive: true }, { sensitive: true }, { sensitive: true }],
      });
      state.tray = { setImage: vi.fn(), setToolTip: vi.fn(), setContextMenu: vi.fn() };
      state.currentTrayColor = 'green';
      tray.updateTrayIcon();
      expect(state.currentTrayColor).toBe('yellow');
    });

    it('red for 6+ sensitive events', () => {
      const state = initTray({
        activityLog: Array.from({ length: 10 }, () => ({ sensitive: true })),
      });
      state.tray = { setImage: vi.fn(), setToolTip: vi.fn(), setContextMenu: vi.fn() };
      state.currentTrayColor = 'green';
      tray.updateTrayIcon();
      expect(state.currentTrayColor).toBe('red');
    });
  });

  describe('notifySensitive', () => {
    it('shows notification for sensitive events', () => {
      initTray();
      const events = [
        { sensitive: true, agent: 'Claude', action: 'read', file: '/home/.ssh/id_rsa', reason: 'SSH key' },
      ];
      tray.notifySensitive(events);
      expect(mockNotificationConstructor).toHaveBeenCalledTimes(1);
      const notifArgs = mockNotificationConstructor.mock.calls[0][0];
      expect(notifArgs.title).toContain('Sensitive File Access');
      expect(notifArgs.body).toContain('Claude');
      expect(notifArgs.body).toContain('id_rsa');
    });

    it('does not notify when notifications disabled', () => {
      initTray({ settings: { notificationsEnabled: false } });
      tray.notifySensitive([{ sensitive: true, agent: 'A', file: '/f', reason: 'r' }]);
      expect(mockNotificationConstructor).not.toHaveBeenCalled();
    });

    it('does not notify for non-sensitive events', () => {
      initTray();
      tray.notifySensitive([{ sensitive: false, agent: 'A', file: '/f' }]);
      expect(mockNotificationConstructor).not.toHaveBeenCalled();
    });

    it('throttles notifications to 30s apart', () => {
      initTray();
      const events = [{ sensitive: true, agent: 'A', action: 'r', file: '/f', reason: 'r' }];
      tray.notifySensitive(events);
      expect(mockNotificationConstructor).toHaveBeenCalledTimes(1);
      tray.notifySensitive(events);
      expect(mockNotificationConstructor).toHaveBeenCalledTimes(1);
    });

    it('shows (+N more) for multiple sensitive events', () => {
      initTray();
      const events = [
        { sensitive: true, agent: 'Claude', action: 'read', file: '/a', reason: 'SSH' },
        { sensitive: true, agent: 'Claude', action: 'read', file: '/b', reason: 'AWS' },
        { sensitive: true, agent: 'Claude', action: 'read', file: '/c', reason: 'key' },
      ];
      tray.notifySensitive(events);
      const body = mockNotificationConstructor.mock.calls[0][0].body;
      expect(body).toContain('+2 more');
    });
  });

  describe('createTray', () => {
    it('creates tray with green icon and sets up context menu', () => {
      const state = initTray();
      tray.createTray();
      expect(mockTrayConstructor).toHaveBeenCalled();
      expect(state.tray).toBeDefined();
    });
  });

  describe('rebuildTrayMenu', () => {
    it('does nothing when no tray exists', () => {
      const state = initTray();
      state.tray = null;
      tray.rebuildTrayMenu();
    });

    it('builds menu with correct items', () => {
      const state = initTray();
      state.tray = { setContextMenu: vi.fn() };
      tray.rebuildTrayMenu();
      expect(mockBuildFromTemplate).toHaveBeenCalled();
      const template = mockBuildFromTemplate.mock.calls[0][0];
      expect(template.some(item => item.label === 'Show Dashboard')).toBe(true);
      expect(template.some(item => item.label === 'Pause Monitoring')).toBe(true);
      expect(template.some(item => item.label === 'Quit')).toBe(true);
    });

    it('shows "Resume Monitoring" when paused', () => {
      const state = initTray({ paused: true });
      state.tray = { setContextMenu: vi.fn() };
      tray.rebuildTrayMenu();
      const template = mockBuildFromTemplate.mock.calls[0][0];
      expect(template.some(item => item.label === 'Resume Monitoring')).toBe(true);
    });
  });
});
