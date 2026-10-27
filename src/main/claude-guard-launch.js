'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { profilePresence } = require('./claude-hook-app-profile');

const INACTIVE = Object.freeze({
  status: 'inactive',
  available: false,
  lossDetected: false,
  delivery: 'unknown',
  sender: 'unverified',
  effect: 'unknown',
  entries: [],
});

function quotePowerShell(value) {
  // eslint-disable-next-line no-control-regex -- Controls cannot enter a copied terminal command.
  if (typeof value !== 'string' || !path.isAbsolute(value) || /[\u0000-\u001f\u007f]/.test(value))
    throw Error('unsupported-launch-path');
  return "'" + value.replaceAll("'", "''") + "'";
}

function localLaunchPath(value, basename) {
  if (typeof value !== 'string' || value.length > 4096 || !/^[A-Za-z]:[\\/]/.test(value))
    return false;
  // eslint-disable-next-line no-control-regex -- Refuse device syntax and terminal controls.
  if (/[\x00-\x1f\x7f"<>|?*]/.test(value) || value.slice(2).includes(':')) return false;
  return (
    path.win32.isAbsolute(value) &&
    path.win32.normalize(value) === value &&
    (!basename || path.win32.basename(value).toLowerCase() === basename)
  );
}

/** Manage one explicitly selected, finite terminal broker observation session.
 * @param {object} options Fixed app paths, owner dialogs, and clipboard.
 * @returns {object} User-invoked start/stop and redacted snapshot. @since v0.21.0 */
function createClaudeGuardLauncher(options) {
  const { target, executable, appPath, dialog, getWindow, clipboard } = options;
  const startReceiver =
    options.startReceiver || require('./claude-guard-receiver').startClaudeGuardReceiver;
  let active = null;
  let closed = false;

  const snapshot = () => (active ? active.snapshot() : { ...INACTIVE, entries: [] });
  async function stop() {
    if (!active) return;
    const previous = active;
    active = null;
    await previous.close();
  }
  async function start(owned) {
    if (closed || !owned()) return 'GUARD_UNAVAILABLE';
    if (active) {
      if (['waiting', 'awaiting-confirmation', 'active'].includes(active.snapshot().status))
        return 'GUARD_ALREADY_ACTIVE';
      await stop();
    }
    const window = getWindow();
    if (!(await profilePresence(target)).reviewable || !owned()) return 'GUARD_PROFILE_REQUIRED';
    const choice = await dialog.showOpenDialog(window, {
      title: 'Select Claude executable',
      properties: ['openFile'],
      filters: [{ name: 'Claude executable', extensions: ['exe'] }],
    });
    if (!owned()) return 'GUARD_UNAVAILABLE';
    if (choice.canceled || choice.filePaths?.length !== 1) return 'GUARD_CANCELLED';
    const program = choice.filePaths[0];
    if (!localLaunchPath(program, 'claude.exe')) return 'GUARD_UNAVAILABLE';
    const directoryChoice = await dialog.showOpenDialog(window, {
      title: 'Select the Claude working folder',
      properties: ['openDirectory'],
    });
    if (!owned()) return 'GUARD_UNAVAILABLE';
    if (directoryChoice.canceled || directoryChoice.filePaths?.length !== 1)
      return 'GUARD_CANCELLED';
    const cwd = directoryChoice.filePaths[0];
    if (!localLaunchPath(cwd) || !localLaunchPath(target, 'settings.json'))
      return 'GUARD_UNAVAILABLE';
    const responseBytes = Buffer.byteLength(
      JSON.stringify({
        token: '0'.repeat(64),
        executable: program,
        settings: target,
        cwd,
        proof: '0'.repeat(64),
      }),
    );
    if (responseBytes > 8192) return 'GUARD_UNAVAILABLE';
    const [programStat, cwdStat] = await Promise.all([fs.lstat(program), fs.lstat(cwd)]);
    if (
      !owned() ||
      !programStat.isFile() ||
      programStat.isSymbolicLink() ||
      !cwdStat.isDirectory() ||
      cwdStat.isSymbolicLink()
    )
      return 'GUARD_UNAVAILABLE';
    const review = await dialog.showMessageBox(window, {
      type: 'question',
      title: 'Prepare a Claude terminal session',
      message: 'Prepare the selected Claude launch?',
      detail:
        `Executable: ${program}\nWorking folder: ${cwd}\nSettings: ${target}\n\n` +
        'AEGIS will copy a broker command for your terminal. It does not verify the executable or sender. Provider approval and action effects remain unknown.',
      buttons: ['Cancel', 'Prepare command'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (!owned() || review.response !== 1) return 'GUARD_CANCELLED';
    let next;
    let readyForClaim = false;
    try {
      next = await startReceiver({
        selection: { executable: program, settings: target, cwd },
        approve: async (code) => {
          if (closed || !readyForClaim || active !== next || !owned()) return false;
          const approval = await dialog.showMessageBox(window, {
            type: 'question',
            title: 'Confirm the terminal session',
            message: 'Does this code match your terminal?',
            detail: `Code: ${code}\nExecutable: ${program}\nWorking folder: ${cwd}\nSettings: ${target}\n\nOnly confirm if you started the broker in your terminal. Sender identity remains unverified.`,
            buttons: ['Cancel', 'Confirm matching code'],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
          });
          return !closed && active === next && owned() && approval.response === 1;
        },
      });
      if (!owned() || closed) {
        await next.close();
        return 'GUARD_UNAVAILABLE';
      }
      if (
        !Number.isInteger(next.port) ||
        next.port < 1 ||
        next.port > 65535 ||
        !/^[a-f0-9]{32}$/.test(next.sessionId) ||
        !/^[a-f0-9]{24}$/.test(next.launchKey)
      )
        throw Error('invalid-guard-session');
      const command = `& ${quotePowerShell(executable)} ${quotePowerShell(appPath)} --claude-guard-session ${next.port} '${next.sessionId}'`;
      clipboard.writeText(command);
      const keyReview = await dialog.showMessageBox(window, {
        type: 'question',
        title: 'One-time terminal verification',
        message: 'Enter this one-time code in the terminal broker.',
        detail: `Code: ${next.launchKey.match(/.{4}/g).join(' ')}\n\nThe broker command is on the clipboard. After closing this dialog, paste it into PowerShell and type the code. Then compare the separate terminal confirmation code with the next native dialog.`,
        buttons: ['Cancel', 'Continue'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (!owned() || closed || keyReview.response !== 1) {
        await next.close();
        return 'GUARD_CANCELLED';
      }
      readyForClaim = true;
      active = next;
      return 'GUARD_READY';
    } catch {
      await next?.close();
      return 'GUARD_UNAVAILABLE';
    }
  }
  async function close() {
    closed = true;
    await stop();
  }
  return Object.freeze({ start, stop, close, snapshot, hasPending: () => !!active });
}

module.exports = { createClaudeGuardLauncher };
