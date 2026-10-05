'use strict';
const { ownsTopLevelRenderer } = require('./external-url-boundary');

/**
 * Require explicit confirmation from the owned UI and use normal shutdown.
 * @param {Object} deps Electron app and the current renderer owner.
 * @returns {(event: Object, confirmed: boolean) => Promise<Object>} The narrow app:quit handler.
 * @since v0.19.0-beta
 */
function createQuitAppHandler({ app, getWindow, rendererUrl }) {
  let quitting = false;
  return async (event, confirmed) => {
    const window = getWindow?.();
    const stillOwned = () =>
      getWindow?.() === window && ownsTopLevelRenderer(event, window, rendererUrl);
    if (!stillOwned()) return { success: false, error: 'Renderer request denied' };
    if (confirmed !== true) return { success: false, error: 'App exit confirmation required' };
    if (quitting) return { success: false, error: 'App exit already in progress' };
    quitting = true;
    // Settle the invoke reply first; app.quit still drains accepted observations.
    setImmediate(() => {
      if (stillOwned()) app.quit();
      else quitting = false;
    });
    return { success: true };
  };
}

module.exports = { createQuitAppHandler };
