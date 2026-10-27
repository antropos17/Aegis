'use strict';

const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { createOwnedHookReview } = require('./claude-hook-review');
const { createWindowsHookIO } = require('./claude-hook-windows-io');
const { CONTRACT } = require('./claude-hook-plan');
const { prepareObservedRemoval } = require('./claude-hook-app-removal');
const {
  loadProfileAssets,
  prepareProfile,
  profileCommand,
  checkProfilePolicy,
  profileReviewText,
  profileDraftEligibility,
  profilePresence,
} = require('./claude-hook-app-profile');
const CODES = new Set([
  'IDLE',
  'READY',
  'UNAVAILABLE',
  'BUSY',
  'CANCELLED',
  'INSTALLED',
  'REMOVED',
  'OBSERVED_REMOVED',
  'PROFILE_REVIEW_AVAILABLE',
  'NO_MATCHING_HOOK',
  'AMBIGUOUS_HOOK',
  'CONFIGURED_UNOWNED',
  'OWNED_INSTALL_EXISTS',
  'NO_OWNED_INSTALL',
  'EXPIRED',
  'SESSION_ENDED',
  'SESSION_RELEASE_UNCONFIRMED',
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
  let observedPlan = null;
  let present = false,
    reviewable = false,
    profileMark = null;
  let last = 'IDLE',
    ready = false,
    active = null,
    pendingSession = null;
  function reply(code = last) {
    return {
      success: true,
      code: CODES.has(code) ? code : 'OPERATION_FAILED',
      presence: configured ? 'Configured' : 'Unknown',
      available: ready && !closed,
      canInstall: ready && !closed && !configured && !retained && !session?.ended,
      canRemove: ready && !closed && ownedInstall && !retained && !!session && !session.ended,
      canReviewExisting:
        ready &&
        !closed &&
        !retained &&
        reviewable &&
        (!ownedInstall || session?.ended) &&
        ![
          'OBSERVED_REMOVED',
          'REMOVED',
          'NO_MATCHING_HOOK',
          'AMBIGUOUS_HOOK',
          'PLAN_REFUSED',
        ].includes(last),
      canOpen: present || !!session || configured || retained,
    };
  }
  async function endSession() {
    if (!session) return;
    if (session.closing) return session.closing;
    session.ended = true;
    clearTimeout(session.timer);
    session.review.release(owner);
    if (!applying) observedPlan?.cancel();
    session.closing = (async () => {
      if (applying && active) await active.catch(() => {});
      await session.io.close();
    })();
    await session.closing;
  }
  async function ensureSession(assets, existingOnly = false) {
    if (session?.ended) {
      await endSession();
      const released = session.io.status?.();
      if (released?.admission !== 'closed' || released?.exit !== 'confirmed') {
        retained = true;
        throw Error('profile-session-release-unconfirmed');
      }
      session = null;
      ownedInstall = false;
    }
    if (session) return session;
    const selected = await prepareProfile(directory, existingOnly);
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
  async function retainResult(result) {
    last = CODES.has(result.code) ? result.code : 'OPERATION_FAILED';
    if (last === 'INSTALLED' || last === 'CONFIGURED_UNOWNED') configured = true;
    if (last === 'INSTALLED') ownedInstall = true;
    if (last === 'REMOVED' || last === 'OBSERVED_REMOVED' || last === 'NO_MATCHING_HOOK') {
      configured = false;
      ownedInstall = false;
      profileMark = (await profilePresence(target)).mark;
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
    if (ownedInstall && session?.ended) configured = false;
    if (ownedInstall && session && !session.ended) {
      const result = await session.review.reconcile(owner);
      if (!owned()) return { success: false, error: 'Renderer request denied' };
      if (!result.ok || result.code !== 'OWNED_MATCH' || session.ended) {
        configured = false;
        ownedInstall = false;
        retained = true;
        last = result.code === 'TARGET_CHANGED' ? 'TARGET_CHANGED' : 'TARGET_READ_FAILED';
        await endSession();
        if (!owned()) return { success: false, error: 'Renderer request denied' };
      }
    }
    const file = await profilePresence(target);
    present = file.present;
    reviewable = file.reviewable;
    if (
      profileMark !== file.mark &&
      !ownedInstall &&
      !retained &&
      [
        'NO_MATCHING_HOOK',
        'AMBIGUOUS_HOOK',
        'PLAN_REFUSED',
        'REMOVED',
        'OBSERVED_REMOVED',
      ].includes(last)
    )
      last = 'IDLE';
    profileMark = file.mark;
    if (!owned()) return { success: false, error: 'Renderer request denied' };
    if (action === 'status')
      return reply(
        ready && retained
          ? last
          : ready &&
              reviewable &&
              !retained &&
              (!ownedInstall || session?.ended) &&
              ![
                'NO_MATCHING_HOOK',
                'AMBIGUOUS_HOOK',
                'PLAN_REFUSED',
                'REMOVED',
                'OBSERVED_REMOVED',
              ].includes(last)
            ? 'PROFILE_REVIEW_AVAILABLE'
            : session?.ended
              ? 'SESSION_ENDED'
              : ready
                ? last === 'IDLE'
                  ? 'READY'
                  : last
                : 'UNAVAILABLE',
      );
    if (action === 'open-profile') {
      if (!present && !configured && !session) return reply('NO_OWNED_INSTALL');
      shell?.showItemInFolder(target);
      return reply();
    }
    if (!ready) return reply('UNAVAILABLE');
    if (retained) return reply('RETAINED_UNKNOWN');
    if (action === 'install' && session?.ended) return reply('SESSION_ENDED');
    if (action === 'install' && configured) return reply('OWNED_INSTALL_EXISTS');
    if (action === 'remove' && !reviewable) return reply('NO_MATCHING_HOOK');
    const observedRemoval = action === 'remove' && (!ownedInstall || session?.ended);
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
    pendingSession = ensureSession(assets, action === 'remove');
    let current;
    try {
      current = await pendingSession;
    } finally {
      pendingSession = null;
    }
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
        : observedRemoval
          ? await prepareObservedRemoval(current.io, { target, executable, appPath, now })
          : await current.review.prepareRemoval(owner);
    const cancel = () => {
      prepared.cancel?.();
      current.review.cancel(owner);
    };
    if (!owned()) {
      cancel();
      return { success: false, error: 'Renderer request denied' };
    }
    if (observedRemoval ? prepared.ok !== true : !prepared.planId) return retainResult(prepared);
    if (observedRemoval) observedPlan = prepared;
    if (action === 'install') {
      const currentTarget = await current.io.readTarget();
      let eligibility;
      try {
        eligibility = profileDraftEligibility(prepared.review, currentTarget.bytes);
      } finally {
        currentTarget.bytes.fill(0);
      }
      if (eligibility !== 'empty') {
        cancel();
        return retainResult({
          code: eligibility === 'configured' ? 'CONFIGURED_UNOWNED' : 'TARGET_CHANGED',
        });
      }
    }
    if (!owned()) {
      cancel();
      return { success: false, error: 'Renderer request denied' };
    }
    if (current.ended) {
      cancel();
      return reply('SESSION_ENDED');
    }
    const detail = profileReviewText(prepared.review, target, observedRemoval);
    const answer = await dialog.showMessageBox(window, {
      type: 'question',
      title: 'Review Claude hook profile',
      message:
        action === 'install'
          ? 'Install the reviewed Claude hook profile?'
          : observedRemoval
            ? 'Remove only this recognized current AEGIS hook?'
            : 'Remove the reviewed Claude hook?',
      detail,
      buttons: ['Cancel', action === 'install' ? 'Install profile' : 'Remove hook'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (!owned()) {
      cancel();
      return { success: false, error: 'Renderer request denied' };
    }
    if (answer.response !== 1) {
      cancel();
      return reply('CANCELLED');
    }
    if (current.ended) {
      cancel();
      return reply('SESSION_ENDED');
    }
    applying = true;
    try {
      return retainResult(
        observedRemoval
          ? await prepared.confirm(true)
          : await current.review.confirm(owner, prepared.planId, true),
      );
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
        'profile-session-release-unconfirmed': 'SESSION_RELEASE_UNCONFIRMED',
      }[error?.message];
      session?.review.cancel(owner);
      last = code || 'OPERATION_FAILED';
      return reply();
    } finally {
      observedPlan?.cancel();
      observedPlan = null;
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
    if (pendingSession) await pendingSession.catch(() => {});
    await endSession();
  }
  return Object.freeze({ handle, close, hasPending: () => !!session || busy });
}
module.exports = { createClaudeHookApp };
