/** Desktop window navigation and Windows application identity. */
'use strict';

/**
 * Queue tray navigation until the renderer is ready and restore the same window.
 * @param {object} deps Electron app, platform and packaging appId.
 * @returns {object} Identity setup, window attachment and navigation methods.
 * @since v0.15.0
 */
function createDesktopShell({ app, platform, appId }) {
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
        app.setAppUserModelId(app.isPackaged ? appId : `${appId}.development`);
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
