import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Module, { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const trayPath = require.resolve('../../src/main/tray-icon.js');

describe('tray update work', () => {
  let tray, state, count, paused, agents, menu, previousModule;
  const nativeTray = () => ({ setImage: vi.fn(), setToolTip: vi.fn(), setContextMenu: vi.fn() });

  beforeEach(() => {
    previousModule = require.cache[trayPath];
    delete require.cache[trayPath];
    menu = vi.fn((template) => template);
    const originalLoad = Module._load;
    Module._load = function (name) {
      if (name === 'electron')
        return {
          Menu: { buildFromTemplate: menu },
          nativeImage: { createFromBuffer: (buffer) => buffer },
        };
      return originalLoad.apply(this, arguments);
    };
    try {
      tray = require(trayPath);
    } finally {
      Module._load = originalLoad;
    }
    count = 0;
    paused = false;
    agents = 1;
    state = {
      tray: nativeTray(),
      currentTrayColor: 'green',
      getSensitiveCount: vi.fn(() => count),
      getActivityLog: vi.fn(() => {
        throw new Error('history traversal');
      }),
      isMonitoringPaused: () => paused,
      getAgentCount: () => agents,
      setMonitoringPaused: (value) => {
        paused = value;
      },
      stopScanIntervals: vi.fn(),
      startScanIntervals: vi.fn(),
      getMainWindow: vi.fn(),
      setIsQuitting: vi.fn(),
      appQuit: vi.fn(),
    };
    tray.init(state);
  });

  afterEach(() => {
    if (previousModule) require.cache[trayPath] = previousModule;
    else delete require.cache[trayPath];
  });

  it('handles a burst with one native update and no history reads', () => {
    count = 6;
    for (let i = 0; i < 1000; i++) tray.updateTrayIcon();
    expect(state.getActivityLog).not.toHaveBeenCalled();
    expect(state.getSensitiveCount).toHaveBeenCalledTimes(1000);
    expect(state.tray.setImage).toHaveBeenCalledTimes(1);
    expect(state.tray.setToolTip).toHaveBeenCalledTimes(1);
    expect(state.tray.setContextMenu).toHaveBeenCalledTimes(1);
    expect(menu).toHaveBeenCalledTimes(1);
  });

  it('refreshes count, color, agents and pause after additions and evictions', () => {
    for (const [next, color] of [
      [0, 'green'],
      [1, 'yellow'],
      [5, 'yellow'],
      [6, 'red'],
      [5, 'yellow'],
      [0, 'green'],
    ]) {
      count = next;
      tray.updateTrayIcon();
      expect(state.currentTrayColor).toBe(color);
      expect(state.tray.setToolTip).toHaveBeenLastCalledWith(
        expect.stringContaining(`${next} sensitive alerts`),
      );
    }
    expect(menu).toHaveBeenCalledTimes(1);
    agents = 2;
    tray.updateTrayIcon();
    expect(menu.mock.lastCall[0][1].label).toBe('2 active agents');
    const pauseItem = menu.mock.lastCall[0].find((item) => item.label === 'Pause Monitoring');
    pauseItem.click();
    expect(state.stopScanIntervals).toHaveBeenCalledTimes(1);
    expect(state.tray.setToolTip).toHaveBeenLastCalledWith(expect.stringContaining('[PAUSED]'));
    menu.mock.lastCall[0].find((item) => item.label === 'Resume Monitoring').click();
    expect(state.startScanIntervals).toHaveBeenCalledTimes(1);
    expect(state.tray.setToolTip.mock.lastCall[0]).not.toContain('[PAUSED]');
    expect(menu).toHaveBeenCalledTimes(4);
  });

  it('initializes a replacement tray and retries failed native updates', () => {
    tray.updateTrayIcon();
    state.tray = nativeTray();
    state.tray.setToolTip.mockImplementationOnce(() => {
      throw new Error('native tooltip failure');
    });
    expect(() => tray.updateTrayIcon()).toThrow('native tooltip failure');
    tray.updateTrayIcon();
    expect(state.tray.setToolTip).toHaveBeenCalledTimes(2);
    expect(state.tray.setContextMenu).toHaveBeenCalledTimes(1);
    agents++;
    state.tray.setContextMenu.mockImplementationOnce(() => {
      throw new Error('native menu failure');
    });
    expect(() => tray.updateTrayIcon()).toThrow('native menu failure');
    tray.updateTrayIcon();
    expect(state.tray.setContextMenu).toHaveBeenCalledTimes(3);
    tray.init(state);
    tray.updateTrayIcon();
    expect(state.tray.setContextMenu).toHaveBeenCalledTimes(4);
  });
});
