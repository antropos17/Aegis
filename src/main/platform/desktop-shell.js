/** Desktop window navigation and Windows application identity. */
'use strict';

// Runtime identity must survive electron-builder stripping package.json.build.
// desktop-shell.test.js checks this against the installer configuration.
const APP_ID = 'com.aegis.oversight';

/**
 * Queue tray navigation until the renderer is ready and restore the same window.
 * @param {object} deps Electron app and platform.
 * @returns {object} Identity setup, window attachment and navigation methods.
 * @since v0.15.0
 */
function createDesktopShell({ app, platform }) {
  let pending = null;
  let requested = false;
  let window = null;
  let loaded = false;
  function reveal() {
    if (!window || window.isDestroyed()) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }
  function deliver() {
    if (!loaded || !window || window.isDestroyed() || !pending) return;
    window.webContents.send('navigate-view', pending);
    pending = null;
  }
  return {
    configureIdentity() {
      if (platform === 'win32') {
        app.setAppUserModelId(app.isPackaged ? APP_ID : `${APP_ID}.development`);
      }
    },
    wasRequested: () => requested,
    open(view = null) {
      if (view !== null && view !== 'settings') return;
      requested = true;
      if (view) pending = view;
      reveal();
      deliver();
    },
    attach(nextWindow) {
      window = nextWindow;
      loaded = false;
      window.webContents.on('did-start-loading', () => {
        loaded = false;
      });
      window.webContents.on('did-finish-load', () => {
        loaded = true;
        deliver();
        if (requested) reveal();
      });
    },
  };
}
module.exports = { createDesktopShell };
