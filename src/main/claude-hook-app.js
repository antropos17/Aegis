'use strict';

const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { createOwnedHookReview } = require('./claude-hook-review');
const { createWindowsHookIO } = require('./claude-hook-windows-io');
const { CONTRACT } = require('./claude-hook-plan');
const {
  loadProfileAssets,
  prepareProfile,
  profileCommand,
  checkProfilePolicy,
  profileReviewText,
  profileDraftEligibility,
} = require('./claude-hook-app-profile');
const CODES = new Set([
  'IDLE',
  'READY',
  'UNAVAILABLE',
  'BUSY',
  'CANCELLED',
  'INSTALLED',
  'REMOVED',
  'CONFIGURED_UNOWNED',
  'OWNED_INSTALL_EXISTS',
  'NO_OWNED_INSTALL',
  'EXPIRED',
  'SESSION_ENDED',
  'INVALID_POLICY',
  'UNSUPPORTED_PATH',
  'RETENTION_LIMIT',
  'PREVIEW_TOO_LARGE',
  'TARGET_READ_FAILED',
  'PLAN_REFUSED',
  'BACKUP_TAMPERED',
  'BACKUP_FAILED',
  'TARGET_IDENTITY_CHANGED',
  'OWNED_ENTRY_REFUSED',
  'TARGET_CHANGED',
  'WRITE_UNCERTAIN',
  'READBACK_FAILED',
  'RETAINED_UNKNOWN',
  'OPERATION_FAILED',
]);

/** Create the application-owned separate Claude profile review boundary.
 * Personal profile discovery, arbitrary renderer paths and activation are excluded.
 * @param {object} options Trusted application capabilities and optional test seams.
 * @returns {object} Owned operations and bounded cleanup. @since v0.21.0 */
function createClaudeHookApp(options) {
  const {
    userData,
    assetsRoot,
    dialog,
    getWindow,
    executable,
    appPath,
    shell,
    platform = process.platform,
    getAssets = () => loadProfileAssets(assetsRoot),
    makeIO = createWindowsHookIO,
    now = () => performance.now(),
  } = options;
  const directory = path.join(userData, 'claude-hook-profile');
  const target = path.join(directory, 'settings.json');
  const owner = Object.freeze({});
  let session = null,
    busy = false,
    closed = false,
    configured = false,
    ownedInstall = false,
    retained = false;
  let applying = false;
  let last = 'IDLE',
    ready = false,
    active = null;
  function reply(code = last) {
    return {
      success: true,
      code: CODES.has(code) ? code : 'OPERATION_FAILED',
      presence: configured ? 'Configured' : 'Unknown',
      available: ready && !closed,
      canInstall: ready && !closed && !configured && !retained && !session?.ended,
      canRemove: ready && !closed && ownedInstall && !retained && !!session && !session.ended,
      canOpen: !!session || configured || retained,
    };
  }
  async function endSession() {
    if (!session) return;
    if (session.closing) return session.closing;
    session.ended = true;
    clearTimeout(session.timer);
    session.review.release(owner);
    session.closing = (async () => {
      if (applying && active) await active.catch(() => {});
      await session.io.close();
    })();
    await session.closing;
  }
  async function ensureSession(assets) {
    if (session) return session;
    const selected = await prepareProfile(directory);
    const io = await makeIO({
      ownedProfile: true,
      ...selected,
      assets,
      requestMs: 1500,
      sessionMs: 180000,
      cleanupMs: 1000,
    });
    const review = createOwnedHookReview({ owner, configPath: target, io, lifetimeMs: 90000, now });
    if (review.ok !== true) {
      await io.close();
      throw Error('profile-unavailable');
    }
    session = {
      io,
      review,
      ended: false,
      timer: setTimeout(() => {
        void endSession().catch(() => {});
      }, 180000),
    };
    session.timer.unref?.();
    return session;
  }
  function retainResult(result) {
    last = CODES.has(result.code) ? result.code : 'OPERATION_FAILED';
    if (last === 'INSTALLED' || last === 'CONFIGURED_UNOWNED') configured = true;
    if (last === 'INSTALLED') ownedInstall = true;
    if (last === 'REMOVED') {
      configured = false;
      ownedInstall = false;
    }
    if (last === 'CONFIGURED_UNOWNED') ownedInstall = false;
    if (['WRITE_UNCERTAIN', 'READBACK_FAILED', 'RETAINED_UNKNOWN'].includes(last)) {
      configured = false;
      ownedInstall = false;
      retained = true;
    }
    return reply();
  }
  async function operate(action, owned, window) {
    const assets = platform === 'win32' ? await getAssets() : null;
    ready = !!assets;
    if (!owned()) return { success: false, error: 'Renderer request denied' };
    if (action === 'status')
      return reply(
        session?.ended
          ? 'SESSION_ENDED'
          : ready
            ? last === 'IDLE'
              ? 'READY'
              : last
            : 'UNAVAILABLE',
      );
    if (action === 'open-profile') {
      if (!configured && !session) return reply('NO_OWNED_INSTALL');
      shell?.showItemInFolder(target);
      return reply();
    }
    if (!ready) return reply('UNAVAILABLE');
    if (session?.ended) return reply('SESSION_ENDED');
    if (retained) return reply('RETAINED_UNKNOWN');
    if (action === 'install' && configured) return reply('OWNED_INSTALL_EXISTS');
    if (action === 'remove' && (!session || !ownedInstall)) return reply('NO_OWNED_INSTALL');
    let command;
    if (action === 'install') {
      const chosen = await dialog.showOpenDialog(window, {
        title: 'Select Claude Bash policy',
        properties: ['openFile'],
        filters: [{ name: 'AEGIS action policy', extensions: ['json'] }],
      });
      if (!owned()) return { success: false, error: 'Renderer request denied' };
      if (chosen.canceled || chosen.filePaths?.length !== 1) return reply('CANCELLED');
      if (!(await checkProfilePolicy(chosen.filePaths[0]))) return reply('INVALID_POLICY');
      command = profileCommand(executable, appPath, chosen.filePaths[0]);
      if (!owned()) return { success: false, error: 'Renderer request denied' };
    }
    const current = await ensureSession(assets);
    if (!owned()) {
      current.review.cancel(owner);
      return { success: false, error: 'Renderer request denied' };
    }
    const prepared =
      action === 'install'
        ? await current.review.prepareInstall(owner, {
            command,
            contract: CONTRACT,
            timeoutSeconds: 5,
          })
        : await current.review.prepareRemoval(owner);
    if (!owned()) {
      current.review.cancel(owner);
      return { success: false, error: 'Renderer request denied' };
    }
    if (!prepared.planId) return retainResult(prepared);
    if (action === 'install') {
      const currentTarget = await current.io.readTarget();
      let eligibility;
      try {
        eligibility = profileDraftEligibility(prepared.review, currentTarget.bytes);
      } finally {
        currentTarget.bytes.fill(0);
      }
      if (eligibility !== 'empty') {
        current.review.cancel(owner);
        return retainResult({
          code: eligibility === 'configured' ? 'CONFIGURED_UNOWNED' : 'TARGET_CHANGED',
        });
      }
    }
    if (!owned()) {
      current.review.cancel(owner);
      return { success: false, error: 'Renderer request denied' };
    }
    const detail = profileReviewText(prepared.review, target);
    const answer = await dialog.showMessageBox(window, {
      type: 'question',
      title: 'Review Claude hook profile',
      message:
        action === 'install'
          ? 'Install the reviewed Claude hook profile?'
          : 'Remove the reviewed Claude hook?',
      detail,
      buttons: ['Cancel', action === 'install' ? 'Install profile' : 'Remove hook'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (!owned()) {
      current.review.cancel(owner);
      return { success: false, error: 'Renderer request denied' };
    }
    if (answer.response !== 1) {
      current.review.cancel(owner);
      return reply('CANCELLED');
    }
    applying = true;
    try {
      return retainResult(await current.review.confirm(owner, prepared.planId, true));
    } finally {
      applying = false;
    }
  }
  /** Handle one path-free operation after owned-frame admission.
   * @param {string} action Fixed operation. @param {Function} guard Current renderer ownership.
   * @returns {Promise<object>} Fixed public outcome, never private review data. @since v0.21.0 */
  async function handle(action, guard) {
    if (!['status', 'install', 'remove', 'open-profile'].includes(action))
      return { success: false, error: 'Invalid profile operation' };
    const window = getWindow?.();
    const owned = () =>
      !closed &&
      window &&
      !window.isDestroyed() &&
      getWindow() === window &&
      typeof guard === 'function' &&
      guard() === true;
    if (!owned()) return { success: false, error: 'Renderer request denied' };
    if (busy) return reply('BUSY');
    busy = true;
    active = operate(action, owned, window);
    try {
      return await active;
    } catch (error) {
      const code = {
        'unsupported-path': 'UNSUPPORTED_PATH',
        'backup-retention-limit': 'RETENTION_LIMIT',
        'preview-too-large': 'PREVIEW_TOO_LARGE',
      }[error?.message];
      session?.review.cancel(owner);
      last = code || 'OPERATION_FAILED';
      return reply();
    } finally {
      busy = false;
      active = null;
    }
  }
  /** Close future admission, preserve admitted writer outcome, then close native IO.
   * @returns {Promise<void>} Cleanup settlement. @since v0.21.0 */
  async function close() {
    closed = true;
    session?.review.release(owner);
    if (applying && active) await active.catch(() => {});
    await endSession();
  }
  return Object.freeze({ handle, close, hasPending: () => !!session || busy });
}
module.exports = { createClaudeHookApp };
