/**
 * @file tray-icon.js
 * @module main/tray-icon
 * @description System-tray shield icon generation (procedural PNG),
 *   colour-coded threat updates, tray context menu, and native notifications.
 * @requires electron
 * @requires zlib
 * @requires path
 * @author AEGIS Contributors
 * @license MIT
 * @version 0.1.0
 */
'use strict';
const { Tray, Menu, Notification, nativeImage } = require('electron');
const zlib = require('zlib');
const path = require('path');

const TRAY_COLORS = { green: [0, 230, 118], yellow: [255, 193, 7], red: [255, 23, 68] };
let _state = null;

/**
 * @param {Object} state - shared refs (tray, currentTrayColor, lastNotificationTime, getActivityLog, getSettings, isMonitoringPaused, setMonitoringPaused, stopScanIntervals, startScanIntervals, getMainWindow, setIsQuitting, appQuit)
 * @returns {void} @since v0.1.0
 */
function init(state) {
  _state = state;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([typeBytes, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crcBuf]);
}

/**
 * @param {string} color - 'green' | 'yellow' | 'red'
 * @returns {Electron.NativeImage}
 * @since v0.1.0
 */
function createTrayIconImage(color) {
  const [r, g, b] = TRAY_COLORS[color] || TRAY_COLORS.green;
  const w = 16,
    h = 16,
    raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    const rowOff = y * (1 + w * 4);
    raw[rowOff] = 0;
    const ny = y / 15;
    let hw;
    if (ny < 0.07) hw = 0;
    else if (ny < 0.3) hw = 3 + ((ny - 0.07) / 0.23) * 3;
    else if (ny < 0.5) hw = 6;
    else if (ny < 0.93) {
      const t = (ny - 0.5) / 0.43;
      hw = 6 * (1 - t * t);
    } else hw = 0;
    for (let x = 0; x < w; x++) {
      const px = rowOff + 1 + x * 4,
        dist = Math.abs(x - 7.5) - hw;
      if (dist < 0.5 && hw > 0) {
        const alpha = dist < -0.5 ? 255 : Math.round(255 * (0.5 - dist));
        raw[px] = r;
        raw[px + 1] = g;
        raw[px + 2] = b;
        raw[px + 3] = alpha;
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return nativeImage.createFromBuffer(
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      pngChunk('IHDR', ihdr),
      pngChunk('IDAT', zlib.deflateSync(raw)),
      pngChunk('IEND', Buffer.alloc(0)),
    ]),
  );
}

/** @param {number} n @returns {string} @since v0.1.0 */
function getTrayThreatColor(n) {
  return n >= 6 ? 'red' : n >= 1 ? 'yellow' : 'green';
}

/** @returns {void} @since v0.1.0 */
function updateTrayIcon() {
  if (!_state || !_state.tray) return;
  const total = _state.getActivityLog().filter((e) => e.sensitive).length;
  const color = getTrayThreatColor(total);
  if (color !== _state.currentTrayColor) {
    _state.currentTrayColor = color;
    _state.tray.setImage(createTrayIconImage(color));
  }
  const labels = { green: 'Clear', yellow: 'Elevated', red: 'Critical' };
  const agentCount = typeof _state.getAgentCount === 'function' ? _state.getAgentCount() : 0;
  _state.tray.setToolTip(
    `AEGIS \u2014 ${labels[color]}${_state.isMonitoringPaused() ? ' [PAUSED]' : ''} | ${agentCount} agents | ${total} sensitive alerts`,
  );
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
  new Notification({
    title: 'AEGIS \u2014 Sensitive File Access',
    body: `${f.agent} ${f.action || 'accessed'}: ${path.basename(f.file)}${more}\n${f.reason}`,
    urgency: 'critical',
  }).show();
}

/** @returns {void} @since v0.1.0 */
function rebuildTrayMenu() {
  if (!_state || !_state.tray) return;
  _state.tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Show Dashboard',
        click: () => {
          const mw = _state.getMainWindow();
          if (mw) {
            mw.show();
            mw.focus();
          }
        },
      },
      {
        label: `${typeof _state.getAgentCount === 'function' ? _state.getAgentCount() : 0} active agents`,
        enabled: false,
      },
      { type: 'separator' },
      {
        label: _state.isMonitoringPaused() ? 'Resume Monitoring' : 'Pause Monitoring',
        click: () => {
          const p = !_state.isMonitoringPaused();
          _state.setMonitoringPaused(p);
          if (p) _state.stopScanIntervals();
          else _state.startScanIntervals();
          rebuildTrayMenu();
          updateTrayIcon();
          const mw = _state.getMainWindow();
          if (mw && !mw.isDestroyed()) mw.webContents.send('monitoring-paused', p);
        },
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          _state.setIsQuitting(true);
          _state.appQuit();
        },
      },
    ]),
  );
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
  tray.on('double-click', () => {
    const mw = _state.getMainWindow();
    if (mw) {
      mw.show();
      mw.focus();
    }
  });
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
