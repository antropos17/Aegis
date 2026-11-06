'use strict';

const { encodeLaunch, terminalCommand } = require('./codex-profile-launch');
const fields = [
  'profilePath',
  'profileIdentity',
  'profileSha256',
  'policyPath',
  'policyIdentity',
  'policySha256',
  'cwd',
  'codexPath',
  'codexIdentity',
  'codexSha256',
];
const denied = () => ({ success: false, error: 'Renderer request denied' });

/** Bind private native launch review to one fixed user-invoked terminal command.
 * @param {object} options Trusted profile, window and clipboard capabilities.
 * @returns {object} Path-free UI operations and bounded shutdown. @since v0.21.0 */
function createCodexHookService({
  profile,
  dialog,
  getWindow,
  clipboard,
  executable,
  appPath,
  powershell,
}) {
  let busy = false,
    closed = false,
    active = null;
  async function handle(action, guard) {
    const owned = () => !closed && typeof guard === 'function' && guard() === true;
    if (!owned()) return denied();
    if (!['status', 'install', 'remove', 'open-profile', 'prepare-launch'].includes(action))
      return { success: false, error: 'Invalid profile operation' };
    if (busy)
      return {
        success: true,
        code: 'BUSY',
        available: false,
        canInstall: false,
        canRemove: false,
        canOpen: false,
      };
    busy = true;
    active = (async () => {
      if (action !== 'prepare-launch') return profile.handle(action, owned);
      if (!clipboard?.writeText)
        return {
          success: true,
          code: 'UNAVAILABLE',
          available: false,
          canInstall: false,
          canRemove: false,
          canOpen: false,
        };
      const reviewed = await profile.reviewLaunch(owned);
      if (!owned()) return denied();
      if (!reviewed.ok) {
        const status = await profile.handle('status', owned);
        return status.code === 'RETAINED_UNKNOWN' ? status : { ...status, code: reviewed.code };
      }
      const token = encodeLaunch(
        Object.fromEntries(fields.map((field) => [field, reviewed[field]])),
      );
      const prepared = terminalCommand(token, executable, appPath, powershell);
      const detail = `Run this command only from the exact policy working directory. The reviewed profile, policy and selected executable are rechecked at launch. They can change after the check and before use; identity through execution is not guaranteed.\n\nExact terminal command:\n${prepared.command}\n\nDecoded terminal script:\n${prepared.script}\n\nThis derives one session-only hook override. Review and trust the exact non-managed hook in Codex. Existing config layers still apply; managed policy can suppress it. Hook errors, timeouts or malformed output can leave the tool running. write_stdin is not checked again. Blocking and this installed Codex version are not verified.`;
      if (Buffer.byteLength(detail) > 32768) throw Error('preview-too-large');
      const answer = await dialog.showMessageBox(getWindow(), {
        type: 'question',
        title: 'Review Codex terminal command',
        message: 'Copy this reviewed terminal command?',
        detail,
        buttons: ['Cancel', 'Copy command'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (!owned()) return denied();
      const status = await profile.handle('status', owned);
      if (!owned()) return denied();
      if (status.code === 'RETAINED_UNKNOWN') return status;
      if (answer.response !== 1) return { ...status, code: 'CANCELLED' };
      clipboard.writeText(prepared.command);
      return { ...status, code: 'LAUNCH_READY' };
    })();
    try {
      return await active;
    } catch {
      return owned()
        ? {
            success: true,
            code: 'OPERATION_FAILED',
            available: false,
            canInstall: false,
            canRemove: false,
            canOpen: false,
          }
        : denied();
    } finally {
      active = null;
      busy = false;
    }
  }
  async function close() {
    closed = true;
    await active?.catch(() => {});
    await profile.close();
  }
  return Object.freeze({ handle, close, hasPending: () => busy || profile.hasPending() });
}
module.exports = { createCodexHookService };
