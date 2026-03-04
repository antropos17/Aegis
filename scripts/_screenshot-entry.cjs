/**
 * Minimal Electron main process for screenshot capture.
 * Loads the demo build without preload — renderer auto-enters demo mode.
 */
'use strict';
const { app, BrowserWindow } = require('electron');
const path = require('path');

const DEMO_HTML = path.join(__dirname, '..', 'dist', 'demo', 'index.html');

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    backgroundColor: '#050507',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(DEMO_HTML);
  win.once('ready-to-show', () => win.show());
});
