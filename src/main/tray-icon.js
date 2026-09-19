/**
 * @file tray-icon.js
 * @module main/tray-icon
 * @description System-tray Observatory shield artwork,
 *   colour-coded threat updates, tray context menu, and native notifications.
 * @requires electron
 * @requires fs
 * @requires path
 * @author AEGIS Contributors
 * @license MIT
 * @version 0.1.0
 */
'use strict';
const { Tray, Menu, Notification, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const { UNKNOWN_SOURCE_LABEL } = require('./attribution');

const TRAY_COLORS = { green: [0, 230, 118], yellow: [255, 193, 7], red: [255, 23, 68] };
let _state = null;
let lastTooltip = null;
let lastMenu = null;

/**
 * @param {Object} state - shared refs (tray, currentTrayColor, lastNotificationTime, getSensitiveCount, getSettings, isMonitoringPaused, setMonitoringPaused, stopScanIntervals, startScanIntervals, openWindow, setIsQuitting, appQuit)
 * @returns {void} @since v0.1.0
 */
function init(state) {
  _state = state;
  lastTooltip = null;
  lastMenu = null;
}

/**
 * Load the Observatory shield with its existing semantic status marker.
 * @param {string} color Green, yellow or red status.
 * @returns {Electron.NativeImage} A 32px image for native tray scaling.
 * @since v0.15.0
 */
function createTrayIconImage(color) {
  const key = Object.hasOwn(TRAY_COLORS, color) ? color : 'green';
  return nativeImage.createFromBuffer(
    fs.readFileSync(path.join(__dirname, '..', '..', 'assets', `tray-${key}.png`)),
  );
}
/** @param {number} n @returns {string} @since v0.1.0 */
function getTrayThreatColor(n) {
  return n >= 6 ? 'red' : n >= 1 ? 'yellow' : 'green';
}

/** @returns {void} @since v0.1.0 */
function updateTrayIcon() {
  if (!_state || !_state.tray) return;
  const total = _state.getSensitiveCount();
  const color = getTrayThreatColor(total);
  if (color !== _state.currentTrayColor) {
    _state.currentTrayColor = color;
    _state.tray.setImage(createTrayIconImage(color));
  }
  const labels = { green: 'Clear', yellow: 'Elevated', red: 'Critical' };
  const agentCount = typeof _state.getAgentCount === 'function' ? _state.getAgentCount() : 0;
  const tooltip = `AEGIS \u2014 ${labels[color]}${_state.isMonitoringPaused() ? ' [PAUSED]' : ''} | ${agentCount} agents | ${total} sensitive alerts`;
  if (lastTooltip?.tray !== _state.tray || lastTooltip.value !== tooltip) {
    _state.tray.setToolTip(tooltip);
    lastTooltip = { tray: _state.tray, value: tooltip };
  }
  rebuildTrayMenu();
}

/**
 * @param {Array} events
 * @returns {void} @since v0.1.0
 */
function notifySensitive(events) {
  if (!_state.getSettings().notificationsEnabled) return;
  const se = events.filter((e) => e.sensitive);
  if (se.length === 0) return;
  const now = Date.now();
  if (now - _state.lastNotificationTime < 30000) return;
  _state.lastNotificationTime = now;
  const f = se[0],
    more = se.length > 1 ? ` (+${se.length - 1} more)` : '';
  // An unattributed event carries an empty agent name; without a label the body
  // would open with a bare space and read as a formatting bug.
  const source = f.agent || UNKNOWN_SOURCE_LABEL;
  new Notification({
    title: 'AEGIS \u2014 Sensitive File Access',
    body: `${source} ${f.action || 'accessed'}: ${path.basename(f.file)}${more}\n${f.reason}`,
    urgency: 'critical',
  }).show();
}

/** @returns {void} @since v0.1.0 */
function rebuildTrayMenu() {
  if (!_state || !_state.tray) return;
  const paused = _state.isMonitoringPaused();
  const agentCount = typeof _state.getAgentCount === 'function' ? _state.getAgentCount() : 0;
  // Menu actions read current state when clicked. Only these two labels vary.
  // Remember successful native writes, and never reuse them for another Tray.
  if (
    lastMenu?.tray === _state.tray &&
    lastMenu.paused === paused &&
    lastMenu.agentCount === agentCount
  )
    return;
  _state.tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        id: 'open',
        label: 'Open AEGIS',
        click: () => _state.openWindow(),
      },
      {
        label: `${agentCount} active agents`,
        enabled: false,
      },
      { type: 'separator' },
      {
        id: 'monitoring',
        label: paused ? 'Resume Monitoring' : 'Pause Monitoring',
        click: () => {
          const p = !_state.isMonitoringPaused();
          _state.setMonitoringPaused(p);
          if (p) _state.stopScanIntervals();
          else _state.startScanIntervals();
          rebuildTrayMenu();
          updateTrayIcon();
        },
      },
      { id: 'settings', label: 'Settings', click: () => _state.openWindow('settings') },
      { type: 'separator' },
      {
        id: 'quit',
        label: 'Quit',
        click: () => {
          _state.setIsQuitting(true);
          _state.appQuit();
        },
      },
    ]),
  );
  lastMenu = { tray: _state.tray, paused, agentCount };
}

/**
 * @returns {Electron.Tray}
 * @since v0.1.0
 */
function createTray() {
  const tray = new Tray(createTrayIconImage('green'));
  tray.setToolTip('AEGIS \u2014 Clear | 0 agents | 0 sensitive alerts');
  _state.tray = tray;
  rebuildTrayMenu();
  tray.on('double-click', () => _state.openWindow());
  return tray;
}

module.exports = {
  init,
  createTrayIconImage,
  updateTrayIcon,
  createTray,
  rebuildTrayMenu,
  notifySensitive,
  get _state() {
    return _state;
  },
};
