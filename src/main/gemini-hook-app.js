'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const { createHash } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { readActionFile, parseActionJson } = require('./action-policy');
const { loadProfileAssets, prepareProfile, profilePresence } = require('./claude-hook-app-profile');
const {
  createWindowsHookIO,
  createWindowsHookReadIO,
  createWindowsPolicyIO,
} = require('./claude-hook-windows-io');
const { IO_CONTRACT } = require('./claude-hook-writer');
const { hookCommand, settingsBytes, removable } = require('./gemini-profile-model');

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const empty = Buffer.from('{}\n');
const denied = () => ({ success: false, error: 'Renderer request denied' });

/** Create one application-owned Gemini settings review and transaction boundary.
 * @param {object} options Trusted host capabilities and private test seams.
 * @returns {object} Bounded profile operations and shutdown.
 * @since v0.21.0
 */
function createGeminiHookApp(options) {
  const {
    userData,
    assetsRoot,
    dialog,
    getWindow,
    executable,
    appPath,
    shell,
    platform = process.platform,
    packaged = false,
    now = () => performance.now(),
    getAssets = () => loadProfileAssets(assetsRoot),
    makeIO = createWindowsHookIO,
    makeReadIO = createWindowsHookReadIO,
    makeDraftIO = createWindowsPolicyIO,
    readPolicy = readActionFile,
    validPolicy = (value) => require('./gemini-beforetool-hook').validGeminiPolicy(value),
  } = options;
  const home = path.join(userData, 'gemini-hook-profile');
  const directory = path.join(home, '.gemini');
  const target = path.join(directory, 'settings.json');
  let busy = false,
    closed = false,
    retained = false,
    active = null,
    last = 'IDLE';

  async function release(io) {
    try {
      await io.close();
      const result = io.status?.();
      return result?.admission === 'closed' && result?.exit === 'confirmed';
    } catch {
      return false;
    }
  }
  async function openFactory(factory, input) {
    try {
      return await factory(input);
    } catch {
      // The factory can spawn a native child before it rejects; without its
      // returned handle, confirmed shutdown cannot be established here.
      retained = true;
      throw Error('native-open-uncertain');
    }
  }
  const nativePath = (value) =>
    path.win32.normalize(value).replace(/^[a-z](?=:)/, (drive) => drive.toUpperCase());
  async function ordinaryDirectory(child, create) {
    if (create) {
      try { await fs.mkdir(child); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    const stat = await fs.lstat(child);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('profile-unavailable');
  }
  async function prepareSelected(assets, owned, installing) {
    const guards = [];
    const pin = async (parent, leaf) => {
      const guard = await openFactory(makeDraftIO, {
        targetPath: nativePath(path.join(parent, leaf)), scope: nativePath(parent), assets,
        requestMs: 1500, sessionMs: 180000, cleanupMs: 1000,
      });
      guards.push(guard);
      return guard;
    };
    try {
      // Pin each existing parent before creating its immediate child. Native
      // create leases reject reparse ancestors and prevent their replacement.
      await pin(userData, 'aegis-gemini-parent-witness');
      if (!owned() || closed) return null;
      await ordinaryDirectory(home, installing);
      if (!owned() || closed) return null;
      await pin(home, 'aegis-gemini-home-witness');
      if (!owned() || closed) return null;
      await ordinaryDirectory(directory, installing);
      if (!owned() || closed) return null;
      const targetGuard = await pin(directory, 'settings.json');
      if (!owned() || closed) return null;
      const present = await profilePresence(target);
      if (!owned() || closed) return null;
      if (installing && !present.present) {
        let outcome;
        try { outcome = await targetGuard.create(Buffer.from(empty)); }
        catch { retained = true; throw Error('native-create-uncertain'); }
        if (outcome === 'refused') throw Error('draft-refused');
        let verified;
        try { verified = outcome === 'written' && (await targetGuard.checkCreated()) === 'valid'; }
        catch { verified = false; }
        if (!verified) { retained = true; throw Error('native-create-uncertain'); }
      }
      if (!owned() || closed) return null;
      return await prepareProfile(directory, true);
    } finally {
      for (const guard of guards.reverse()) if (!(await release(guard))) retained = true;
    }
  }

  async function status(code = last) {
    const assets = platform === 'win32' && packaged ? await getAssets() : null;
    const present = (await profilePresence(target)).present;
    const available = !!assets && !closed;
    return {
      success: true,
      code: retained ? 'RETAINED_UNKNOWN' : available ? code : 'UNAVAILABLE',
      available,
      canInstall: available && !retained,
      canRemove: available && present && !retained,
      canOpen: present,
    };
  }
  async function selectedPolicy(file) {
    let bytes;
    try {
      bytes = await readPolicy(file);
      if (!Buffer.isBuffer(bytes) || bytes.length > 4096) return null;
      const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (!validPolicy(parseActionJson(bytes))) return null;
      return { content, digest: hash(bytes) };
    } catch {
      return null;
    } finally {
      bytes?.fill(0);
    }
  }
  async function operate(action, owned) {
    if (!owned()) return denied();
    if (action === 'status') return status();
    if (action === 'open-profile') {
      if ((await profilePresence(target)).present && owned() && !closed)
        shell?.showItemInFolder(target);
      return owned() ? status() : denied();
    }
    if (closed || retained) return status('UNAVAILABLE');
    const assets = platform === 'win32' && packaged ? await getAssets() : null;
    if (!assets) return status('UNAVAILABLE');
    let command, policy, file, io, readIO, before, after, current;
    try {
      if (action === 'install') {
        const chosen = await dialog.showOpenDialog(getWindow(), {
          title: 'Select Gemini exact-deny policy',
          properties: ['openFile'],
          filters: [{ name: 'AEGIS Gemini policy', extensions: ['json'] }],
        });
        if (!owned() || closed) return denied();
        if (chosen.canceled || chosen.filePaths?.length !== 1) return status('CANCELLED');
        file = chosen.filePaths[0];
        try {
          command = hookCommand(executable, appPath, file);
        } catch {
          return status('UNSUPPORTED_PATH');
        }
        policy = await selectedPolicy(file);
        if (!owned() || closed) return denied();
        if (!policy) return status('INVALID_POLICY');
      }
      const selected = await prepareSelected(assets, owned, action === 'install');
      if (!owned() || closed) return denied();
      if (retained) return status('RETAINED_UNKNOWN');
      if (!selected) return status('OPERATION_FAILED');
      readIO = await openFactory(makeReadIO, {
        ownedProfile: true,
        targetPath: selected.targetPath,
        assets,
        requestMs: 1500,
        sessionMs: 180000,
        cleanupMs: 1000,
      });
      if (!owned() || closed) return denied();
      const snap = await readIO.readTarget();
      if (!owned() || closed) {
        snap.bytes?.fill(0);
        return denied();
      }
      if (typeof snap.identity !== 'string' || !Buffer.isBuffer(snap.bytes))
        return status('TARGET_READ_FAILED');
      before = snap.bytes;
      if (action === 'install') {
        if (!before.equals(empty)) return status('PROFILE_CHANGED');
        after = settingsBytes(command);
      } else {
        if (!removable(before, executable, appPath)) return status('PROFILE_CHANGED');
        after = Buffer.from(empty);
      }
      const beforeText = new TextDecoder('utf-8', { fatal: true }).decode(before);
      const afterText = new TextDecoder('utf-8', { fatal: true }).decode(after);
      const detail =
        `AEGIS-owned Gemini settings:\n${target}\n\nCurrent:\n${beforeText}\nProposed:\n${afterText}` +
        (command ? `\nExact hook command:\n${command}\n` : '') +
        (policy ? `\nSelected policy:\n${file}\n\nExact policy:\n${policy.content}` : '') +
        '\nA private backup is retained. Gemini may ignore or override hooks. Unmatched requests receive no AEGIS decision; this is not a general execution barrier.';
      if (Buffer.byteLength(detail) > 8192) return status('PREVIEW_TOO_LARGE');
      const started = now();
      if (!Number.isFinite(started) || started < 0) return status('EXPIRED');
      const answer = await dialog.showMessageBox(getWindow(), {
        type: 'question',
        title: 'Review Gemini hook profile',
        message:
          action === 'install'
            ? 'Install this reviewed Gemini hook?'
            : 'Remove this reviewed Gemini hook?',
        detail,
        buttons: ['Cancel', action === 'install' ? 'Install profile' : 'Remove hook'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (!owned() || closed) return denied();
      const finished = now();
      if (!Number.isFinite(finished) || finished < started || finished - started > 90000)
        return status('EXPIRED');
      if (answer.response !== 1) return status('CANCELLED');
      if (policy) {
        const again = await selectedPolicy(file);
        if (!owned() || closed) return denied();
        if (!again || again.digest !== policy.digest) return status('POLICY_CHANGED');
      }
      if (!(await release(readIO))) {
        readIO = null;
        retained = true;
        return status('RETAINED_UNKNOWN');
      }
      readIO = null;
      if (!owned() || closed) return denied();
      io = await openFactory(makeIO, {
        ownedProfile: true,
        ...selected,
        assets,
        requestMs: 1500,
        sessionMs: 180000,
        cleanupMs: 1000,
      });
      if (!owned() || closed) return denied();
      if (io?.contract !== IO_CONTRACT) return status('UNAVAILABLE');
      current = await io.readTarget();
      if (!owned() || closed) return denied();
      if (current.identity !== snap.identity || !current.bytes.equals(before))
        return status('TARGET_CHANGED');
      current.bytes.fill(0);
      current = null;
      const manifest = JSON.stringify({
        type: 'gemini-profile',
        before: hash(before),
        after: hash(after),
      });
      const ref = await io.retainPrivate({ bytes: Buffer.from(before), manifest });
      if (!owned() || closed) return denied();
      const backup = await io.readPrivate(ref);
      try {
        if (
          !Buffer.isBuffer(backup?.bytes) ||
          !backup.bytes.equals(before) ||
          backup.manifest !== manifest
        )
          return status('BACKUP_FAILED');
      } finally {
        backup?.bytes?.fill(0);
      }
      if (!owned() || closed) return denied();
      current = await io.readTarget();
      if (!owned() || closed) return denied();
      if (current.identity !== snap.identity || !current.bytes.equals(before))
        return status('TARGET_CHANGED');
      const committing = now();
      if (!Number.isFinite(committing) || committing < finished || committing - started > 90000)
        return status('EXPIRED');
      let outcome;
      try {
        outcome = await io.compareAndWrite({
          identity: snap.identity,
          beforeBytes: before,
          afterBytes: after,
        });
      } catch {
        retained = true;
        return status('WRITE_UNCERTAIN');
      }
      if (outcome === 'stale') return status('TARGET_CHANGED');
      if (outcome !== 'written') {
        retained = true;
        return status('WRITE_UNCERTAIN');
      }
      try {
        const verification = await io.readTarget();
        try {
          if (verification.identity !== snap.identity || !verification.bytes.equals(after))
            throw Error();
        } finally {
          verification.bytes?.fill(0);
        }
      } catch {
        retained = true;
        return status('READBACK_FAILED');
      }
      last = action === 'install' ? 'INSTALLED' : 'REMOVED';
      return owned() ? status(last) : denied();
    } catch (error) {
      return owned()
        ? status(
            error?.message === 'backup-retention-limit'
              ? 'RETENTION_LIMIT'
              : error?.message === 'draft-refused'
                ? 'DRAFT_REFUSED'
                : 'OPERATION_FAILED',
          )
        : denied();
    } finally {
      before?.fill(0);
      after?.fill(0);
      current?.bytes?.fill(0);
      if (readIO && !(await release(readIO))) retained = true;
      if (io && !(await release(io))) retained = true;
    }
  }
  function handle(action, owned) {
    if (
      !['status', 'install', 'remove', 'open-profile'].includes(action) ||
      typeof owned !== 'function'
    )
      return Promise.resolve({ success: false, error: 'Invalid profile operation' });
    if (busy) return status('BUSY');
    busy = true;
    active = operate(action, owned)
      .then((result) => (result.success && retained ? status('RETAINED_UNKNOWN') : result))
      .finally(() => {
        busy = false;
        active = null;
      });
    return active;
  }
  async function close() {
    closed = true;
    await active?.catch(() => {});
  }
  return { handle, close, hasPending: () => busy };
}

module.exports = { createGeminiHookApp };
