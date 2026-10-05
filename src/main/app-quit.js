'use strict';
const { ownsTopLevelRenderer } = require('./external-url-boundary');

/**
 * Confirm exit in main and use the existing normal shutdown lifecycle.
 * @param {Object} deps Electron app/dialog and the current renderer owner.
 * @returns {(event: Object) => Promise<Object>} The narrow app:quit handler.
 * @since v0.19.0-beta
 */
function createQuitAppHandler({ app, dialog, getWindow, rendererUrl }) {
  let confirmationPending = false;
  let quitting = false;
  return async (event) => {
    const window = getWindow?.();
    const stillOwned = () =>
      getWindow?.() === window && ownsTopLevelRenderer(event, window, rendererUrl);
    if (!stillOwned()) return { success: false, error: 'Renderer request denied' };
    if (confirmationPending || quitting)
      return { success: false, error: 'App exit already in progress' };
    confirmationPending = true;
    try {
      let answer;
      try {
        answer = await dialog.showMessageBox(window, {
          type: 'question',
          title: 'Quit AEGIS / Sair do AEGIS',
          message: 'Quit AEGIS? / Sair do AEGIS?',
          detail:
            'Monitoring stops until you open AEGIS again. Saved preferences and recorded history are kept; unsaved edits are discarded. / O monitoramento para até você abrir o AEGIS novamente. Preferências salvas e histórico registrado são mantidos; alterações não salvas são descartadas.',
          buttons: ['Cancel / Cancelar', 'Quit AEGIS / Sair do AEGIS'],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
      } catch {
        return { success: false, error: 'App exit confirmation unavailable' };
      }
      if (!stillOwned()) return { success: false, error: 'Renderer request denied' };
      if (answer?.response !== 1) return { success: false, cancelled: true };
      quitting = true;
      // Settle the invoke reply first; app.quit still drains accepted observations.
      setImmediate(() => {
        if (stillOwned()) app.quit();
        else quitting = false;
      });
      return { success: true };
    } finally {
      confirmationPending = false;
    }
  };
}

module.exports = { createQuitAppHandler };
