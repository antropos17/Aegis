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

function sameObject(first, next, file) {
  return (
    first.dev === next.dev &&
    first.ino !== 0n &&
    first.ino === next.ino &&
    (!file ||
      (first.size === next.size &&
        first.mtimeNs === next.mtimeNs &&
        first.ctimeNs === next.ctimeNs))
  );
}

function bounded(promise, timeoutMs) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(false);
      },
    );
  });
}

/** Manage one explicitly selected, finite terminal broker observation session.
 * @param {object} options Fixed app paths, owner dialogs, and clipboard.
 * @returns {object} User-invoked start/stop and redacted snapshot. @since v0.21.0 */
function createClaudeGuardLauncher(options) {
  const { target, executable, appPath, dialog, getWindow, clipboard } = options;
  const startReceiver =
    options.startReceiver || require('./claude-guard-receiver').startClaudeGuardReceiver;
  const createAdmission =
    options.createAdmission || require('./claude-guard-admission').createClaudeGuardAdmission;
  let active = null;
  let closed = false;
  let reader = null,
    admission = null,
    binding = null,
    checking = null,
    stopping = null,
    opening = null,
    openingReceiver = null,
    generation = 0,
    selectedPaths = null,
    timer = null,
    retained = false,
    last = { ...INACTIVE, entries: [] };

  const snapshot = () => (active ? active.snapshot() : last);
  async function stop(stale = false) {
    generation++;
    if (stopping) {
      await stopping;
      return !retained;
    }
    stopping = stopCurrent(stale);
    try {
      await stopping;
      return !retained;
    } finally {
      stopping = null;
    }
  }
  async function stopCurrent(stale) {
    clearInterval(timer);
    timer = null;
    const readPending = opening,
      receiverPending = openingReceiver;
    const [lateReader, lateReceiver] = await Promise.all([
      readPending ? bounded(readPending, 2500) : null,
      receiverPending ? bounded(receiverPending, 2500) : null,
    ]);
    if ((readPending && !lateReader) || (receiverPending && !lateReceiver)) retained = true;
    if (!reader && lateReader) reader = lateReader;
    const previous = active || lateReceiver;
    active = null;
    if (previous) {
      const prior = previous.snapshot();
      last = {
        ...prior,
        status: ['expired', 'refused', 'ended'].includes(prior.status)
          ? prior.status
          : stale
            ? 'refused'
            : 'ended',
        available: false,
        lossDetected: stale || prior.lossDetected,
      };
      try {
        if (
          !(await bounded(
            Promise.resolve(previous.close()).then(() => true),
            1000,
          ))
        )
          retained = true;
      } catch {
        retained = true;
      }
    }
    admission?.close();
    admission = null;
    binding = null;
    selectedPaths = null;
    const previousReader = reader;
    reader = null;
    if (previousReader) {
      try {
        const finished = await bounded(
          Promise.resolve(previousReader.close()).then(() => true),
          1500,
        );
        if (!finished) retained = true;
        else {
          const state = previousReader.status();
          if (state.admission !== 'closed' || state.exit !== 'confirmed') retained = true;
        }
      } catch {
        retained = true;
      }
    }
    if (retained) last = { ...last, status: 'refused', available: false, lossDetected: true };
  }
  function verifyCurrent(owned) {
    if (!owned() || closed || !admission || !binding || !reader) return Promise.resolve(false);
    const selected = admission,
      current = binding;
    const prior = checking || Promise.resolve(true);
    const next = prior
      .then(async () => {
        if (admission !== selected || binding !== current || !owned() || closed) return false;
        const value = await bounded(selected.verify(current), 4000);
        if (value !== true || !selectedPaths) return false;
        const paths = selectedPaths;
        const observed = await bounded(
          Promise.all([
            fs.lstat(paths.program, { bigint: true }),
            fs.lstat(paths.cwd, { bigint: true }),
            fs.realpath(paths.program),
            fs.realpath(paths.cwd),
          ]),
          1000,
        );
        if (!observed) return false;
        const [program, cwd, realProgram, realCwd] = observed;
        return (
          admission === selected &&
          binding === current &&
          selectedPaths === paths &&
          program.isFile() &&
          !program.isSymbolicLink() &&
          cwd.isDirectory() &&
          !cwd.isSymbolicLink() &&
          realProgram === paths.realProgram &&
          realCwd === paths.realCwd &&
          sameObject(paths.programStat, program, true) &&
          sameObject(paths.cwdStat, cwd, false) &&
          owned() &&
          !closed
        );
      })
      .catch(() => false);
    checking = next;
    void next.finally(() => {
      if (checking === next) checking = null;
    });
    return next;
  }
  async function closeUnattached(next) {
    if (!next) return;
    try {
      if (
        !(await bounded(
          Promise.resolve(next.close()).then(() => true),
          1000,
        ))
      )
        retained = true;
    } catch {
      retained = true;
    }
  }
  async function start(isOwned) {
    if (stopping) await stopping;
    if (checking) await checking;
    if (retained) return 'GUARD_RELEASE_UNCONFIRMED';
    if (closed || !isOwned()) return 'GUARD_UNAVAILABLE';
    if (active) {
      if (['waiting', 'awaiting-confirmation', 'active'].includes(active.snapshot().status))
        return 'GUARD_ALREADY_ACTIVE';
      if (!(await stop()) || retained) return 'GUARD_RELEASE_UNCONFIRMED';
    }
    const currentGeneration = ++generation;
    const owned = () => currentGeneration === generation && !closed && isOwned();
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
    const [programStat, cwdStat, realProgram, realCwd] = await Promise.all([
      fs.lstat(program, { bigint: true }),
      fs.lstat(cwd, { bigint: true }),
      fs.realpath(program),
      fs.realpath(cwd),
    ]);
    if (
      !owned() ||
      !programStat.isFile() ||
      programStat.isSymbolicLink() ||
      !cwdStat.isDirectory() ||
      cwdStat.isSymbolicLink() ||
      programStat.ino === 0n ||
      cwdStat.ino === 0n
    )
      return 'GUARD_UNAVAILABLE';
    try {
      selectedPaths = { program, cwd, programStat, cwdStat, realProgram, realCwd };
      const attempt = Promise.resolve().then(() => (owned() ? options.openRead() : null));
      opening = attempt;
      reader = await attempt;
      if (opening === attempt) opening = null;
      if (!owned() || closed) {
        await stop();
        return 'GUARD_UNAVAILABLE';
      }
      admission = createAdmission({ io: reader, target, executable, appPath });
      binding = await bounded(admission.capture(cwd), 4000);
      if (!binding || !owned() || closed) {
        await stop(true);
        return 'GUARD_PROFILE_UNVERIFIED';
      }
    } catch {
      await stop(true);
      opening = null;
      return 'GUARD_PROFILE_UNVERIFIED';
    }
    let review;
    try {
      review = await dialog.showMessageBox(window, {
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
    } catch {
      await stop(true);
      return 'GUARD_UNAVAILABLE';
    }
    if (!owned() || review.response !== 1) {
      await stop();
      return 'GUARD_CANCELLED';
    }
    let next;
    let readyForClaim = false;
    try {
      const receiverAttempt = Promise.resolve().then(() =>
        startReceiver({
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
            return (
              !closed &&
              active === next &&
              owned() &&
              approval.response === 1 &&
              (await verifyCurrent(owned))
            );
          },
          verify: () => active === next && verifyCurrent(owned),
        }),
      );
      openingReceiver = receiverAttempt;
      next = await receiverAttempt;
      if (openingReceiver === receiverAttempt) openingReceiver = null;
      if (!owned() || closed) {
        await closeUnattached(next);
        await stop();
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
        await closeUnattached(next);
        await stop();
        return 'GUARD_CANCELLED';
      }
      if (next.snapshot().status !== 'waiting' || !(await verifyCurrent(owned))) {
        await closeUnattached(next);
        await stop(true);
        return 'GUARD_PROFILE_UNVERIFIED';
      }
      readyForClaim = true;
      active = next;
      timer = setInterval(async () => {
        try {
          if (active !== next) return;
          const state = next.snapshot();
          if (!['waiting', 'awaiting-confirmation', 'active'].includes(state.status))
            await stop(false);
          else if (!(await verifyCurrent(owned))) await stop(true);
        } catch {
          await stop(true).catch(() => {});
        }
      }, options.checkIntervalMs || 5000);
      timer.unref?.();
      return 'GUARD_READY';
    } catch {
      await closeUnattached(next);
      await stop(true);
      openingReceiver = null;
      return 'GUARD_UNAVAILABLE';
    }
  }
  async function close() {
    closed = true;
    await stop();
  }
  return Object.freeze({
    start,
    stop,
    close,
    snapshot,
    hasPending: () => !!active || !!reader || !!opening || !!openingReceiver || !!stopping,
  });
}

module.exports = { createClaudeGuardLauncher };
