'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const { createHash, randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { parseActionJson } = require('./action-policy');
const { loadProfileAssets, profilePresence } = require('./claude-hook-app-profile');
const {
  createWindowsHookIO,
  createWindowsHookReadIO,
  createWindowsPolicyIO,
} = require('./claude-hook-windows-io');
const { IO_CONTRACT } = require('./claude-hook-writer');
const {
  hookCommand,
  hookScript,
  readProfile,
  planProfileChange,
} = require('./codex-profile-model');

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const empty = Buffer.from('{}\n');
const denied = () => ({ success: false, error: 'Renderer request denied' });

// This is a point-in-time observation. The caller must repeat it immediately
// before spawn; a replacement can still occur between that check and spawn.
async function verifyCodexExecutable(selected) {
  if (
    process.platform !== 'win32' ||
    typeof selected !== 'string' ||
    selected.length > 1024 ||
    !/^[A-Za-z]:[\\/][A-Za-z0-9 _&.\\/-]+\.exe$/i.test(selected) ||
    path.win32.basename(selected).toLowerCase() !== 'codex.exe' ||
    selected.split(/[\\/]/).some((part) => part === '.' || part === '..')
  )
    throw Error('CODEX_INVALID');
  const codexPath = path.win32.normalize(selected);
  const canonical = (value) => path.win32.normalize(value).toLowerCase();
  const keys = ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'];
  const equal = (left, right) => keys.every((key) => left[key] === right[key]);
  const parts = [];
  for (let current = codexPath; ; current = path.win32.dirname(current)) {
    parts.push(current);
    if (path.win32.dirname(current) === current) break;
  }
  const before = [];
  for (const [index, part] of parts.entries()) {
    const stat = await fs.lstat(part, { bigint: true });
    if (stat.isSymbolicLink() || (index ? !stat.isDirectory() : !stat.isFile()))
      throw Error('CODEX_INVALID');
    before.push(stat);
  }
  const first = before[0];
  if (first.size <= 0n || first.size > 402653184n || first.ino === 0n) throw Error('CODEX_INVALID');
  if (canonical(await fs.realpath(codexPath)) !== canonical(codexPath))
    throw Error('CODEX_INVALID');
  const handle = await fs.open(codexPath, 'r');
  try {
    if (!equal(first, await handle.stat({ bigint: true }))) throw Error('CODEX_CHANGED');
    const hash = createHash('sha256');
    const buffer = Buffer.alloc(65536);
    let position = 0;
    const size = Number(first.size);
    while (position < size) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(buffer.length, size - position),
        position,
      );
      if (!bytesRead) throw Error('CODEX_CHANGED');
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    buffer.fill(0);
    if (!equal(first, await handle.stat({ bigint: true }))) throw Error('CODEX_CHANGED');
    for (const [index, part] of parts.entries()) {
      const stat = await fs.lstat(part, { bigint: true });
      if (stat.isSymbolicLink() || !equal(before[index], stat)) throw Error('CODEX_CHANGED');
    }
    if (canonical(await fs.realpath(codexPath)) !== canonical(codexPath))
      throw Error('CODEX_CHANGED');
    return {
      codexPath,
      codexIdentity: `${first.dev}:${first.ino}`,
      codexSha256: hash.digest('hex'),
    };
  } finally {
    await handle.close();
  }
}

/** Create one application-owned Codex hooks review and transaction boundary.
 * @param {object} options Trusted host capabilities and private test seams.
 * @returns {object} Bounded profile operations and shutdown.
 * @since v0.21.0
 */
function createCodexHookApp(options) {
  const {
    userData,
    assetsRoot,
    dialog,
    getWindow,
    executable,
    appPath,
    shell,
    powershell = path.win32.join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    ),
    platform = process.platform,
    packaged = false,
    now = () => performance.now(),
    getAssets = () => loadProfileAssets(assetsRoot),
    makeIO = createWindowsHookIO,
    makeReadIO = createWindowsHookReadIO,
    makeDraftIO = createWindowsPolicyIO,
    verifyExecutable = verifyCodexExecutable,
    validPolicy = (value) => require('./action-policy').validActionPolicy(value),
  } = options;
  const home = path.join(userData, 'codex-hook-profile');
  const directory = home;
  const target = path.join(directory, 'hooks.json');
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
      try {
        await fs.mkdir(child);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    }
    const stat = await fs.lstat(child);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('profile-unavailable');
  }
  async function prepareSelected(assets, owned, installing) {
    const guards = [];
    const pin = async (parent, leaf) => {
      const guard = await openFactory(makeDraftIO, {
        targetPath: nativePath(path.join(parent, leaf)),
        scope: nativePath(parent),
        assets,
        requestMs: 1500,
        sessionMs: 180000,
        cleanupMs: 1000,
      });
      guards.push(guard);
      return guard;
    };
    try {
      // Pin each existing parent before creating its immediate child. Native
      // create leases reject reparse ancestors and prevent their replacement.
      await pin(userData, 'aegis-codex-parent-witness');
      if (!owned() || closed) return null;
      await ordinaryDirectory(home, installing);
      if (!owned() || closed) return null;
      await pin(home, 'aegis-codex-home-witness');
      if (!owned() || closed) return null;
      const targetGuard = await pin(directory, 'hooks.json');
      if (!owned() || closed) return null;
      const present = await profilePresence(target);
      if (!owned() || closed) return null;
      if (installing && !present.present) {
        let outcome;
        try {
          outcome = await targetGuard.create(Buffer.from(empty));
        } catch {
          retained = true;
          throw Error('native-create-uncertain');
        }
        if (outcome === 'refused') throw Error('draft-refused');
        let verified;
        try {
          verified = outcome === 'written' && (await targetGuard.checkCreated()) === 'valid';
        } catch {
          verified = false;
        }
        if (!verified) {
          retained = true;
          throw Error('native-create-uncertain');
        }
      }
      if (!installing && !present.reviewable) return null;
      // A newly created target is held by the create lease. Release that file
      // handle before opening the reader; the separate directory pin stays live.
      guards.pop();
      if (!(await release(targetGuard))) {
        retained = true;
        return null;
      }
      if (!owned() || closed) return null;
      const backups = path.join(directory, 'backups');
      await ordinaryDirectory(backups, true);
      if (!owned() || closed) return null;
      await pin(backups, 'aegis-codex-backup-witness');
      if ((await fs.readdir(backups)).length >= 4) throw Error('backup-retention-limit');
      const selected = {
        targetPath: nativePath(target),
        backupRoot: nativePath(path.join(backups, randomUUID())),
      };
      if (!owned() || closed) return null;
      const readIO = await openFactory(makeReadIO, {
        ownedProfile: true,
        targetPath: selected.targetPath,
        assets,
        requestMs: 1500,
        sessionMs: 180000,
        cleanupMs: 1000,
      });
      if (!owned() || closed) {
        if (!(await release(readIO))) retained = true;
        return null;
      }
      return { selected, readIO };
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
  function selectedPolicy(bytes) {
    try {
      if (!Buffer.isBuffer(bytes) || bytes.length > 4096) return null;
      const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      const value = parseActionJson(bytes);
      if (!validPolicy(value)) return null;
      return { content, digest: hash(bytes), cwd: value.cwd };
    } catch {
      return null;
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
    let command, policy, file, io, readIO, policyIO, policySnapshot, before, after, current;
    try {
      if (action === 'install') {
        const chosen = await dialog.showOpenDialog(getWindow(), {
          title: 'Select Codex action policy',
          properties: ['openFile'],
          filters: [{ name: 'AEGIS action policy', extensions: ['json'] }],
        });
        if (!owned() || closed) return denied();
        if (chosen.canceled || chosen.filePaths?.length !== 1) return status('CANCELLED');
        file = chosen.filePaths[0];
        try {
          command = hookCommand(executable, appPath, file, powershell);
        } catch {
          return status('UNSUPPORTED_PATH');
        }
        policyIO = await openFactory(makeReadIO, {
          selectedPolicy: true,
          targetPath: nativePath(file),
          assets,
          requestMs: 1500,
          sessionMs: 180000,
          cleanupMs: 1000,
        });
        policySnapshot = await policyIO.readTarget();
        if (typeof policySnapshot?.identity !== 'string') return status('INVALID_POLICY');
        policy = selectedPolicy(policySnapshot.bytes);
        if (!owned() || closed) return denied();
        if (!policy) return status('INVALID_POLICY');
      }
      const prepared = await prepareSelected(assets, owned, action === 'install');
      const selected = prepared?.selected;
      readIO = prepared?.readIO;
      if (!owned() || closed) return denied();
      if (retained) return status('RETAINED_UNKNOWN');
      if (!selected) return status('OPERATION_FAILED');
      const snap = await readIO.readTarget();
      if (!owned() || closed) {
        snap.bytes?.fill(0);
        return denied();
      }
      if (typeof snap.identity !== 'string' || !Buffer.isBuffer(snap.bytes))
        return status('TARGET_READ_FAILED');
      before = snap.bytes;
      const planned = planProfileChange(before, {
        action,
        target,
        executable,
        appPath,
        powershell,
        command,
      });
      if (!planned) return status('PROFILE_CHANGED');
      after = planned.after;
      const fragments = planned.fragments.map(
        (item) =>
          `Lines ${item.before.start.line}:${item.before.start.column}–${item.before.end.line}:${item.before.end.column}\nRemove: ${item.removed || '(empty)'}\nInsert: ${item.inserted || '(empty)'}`,
      );
      const detail =
        `AEGIS-owned Codex hooks:\n${target}\n\nComplete changes:\n${fragments.join('\n\n')}` +
        (command
          ? `\nExact hook command:\n${command}\n\nDecoded command script:\n${hookScript(executable, appPath, file)}\n`
          : '') +
        (policy ? `\nSelected policy:\n${file}\n\nExact policy:\n${policy.content}` : '') +
        '\nA private backup is retained. Codex does not support PreToolUse ask; AEGIS emits deny for ask. Codex may skip untrusted hooks and managed settings may disable them. Hook failures or timeouts may continue the tool call; malformed responses can also fail without blocking. Other config layers remain active. PreToolUse does not cover write_stdin. No blocking is verified.';
      if (Buffer.byteLength(detail) > 8192) return status('PREVIEW_TOO_LARGE');
      const started = now();
      if (!Number.isFinite(started) || started < 0) return status('EXPIRED');
      const answer = await dialog.showMessageBox(getWindow(), {
        type: 'question',
        title: 'Review Codex hook profile',
        message:
          action === 'install'
            ? 'Install this reviewed Codex hook?'
            : 'Remove this reviewed Codex hook?',
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
        const again = await policyIO.readTarget();
        try {
          if (!owned() || closed) return denied();
          if (
            again.identity !== policySnapshot.identity ||
            !Buffer.isBuffer(again.bytes) ||
            !again.bytes.equals(policySnapshot.bytes)
          )
            return status('POLICY_CHANGED');
        } finally {
          again.bytes?.fill(0);
        }
      }
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
      // Keep the reviewed original handle alive until the new writer has
      // admitted the same file identity and exact bytes.
      if (!(await release(readIO))) {
        readIO = null;
        retained = true;
        return status('RETAINED_UNKNOWN');
      }
      readIO = null;
      if (!owned() || closed) return denied();
      const manifest = JSON.stringify({
        type: 'codex-profile',
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
      if (policyIO) {
        const again = await policyIO.readTarget();
        try {
          if (!owned() || closed) return denied();
          if (
            again.identity !== policySnapshot.identity ||
            !Buffer.isBuffer(again.bytes) ||
            !again.bytes.equals(policySnapshot.bytes)
          )
            return status('POLICY_CHANGED');
        } finally {
          again.bytes?.fill(0);
        }
      }
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
      policySnapshot?.bytes?.fill(0);
      if (policyIO && !(await release(policyIO))) retained = true;
      if (readIO && !(await release(readIO))) retained = true;
      if (io && !(await release(io))) retained = true;
    }
  }

  // Private handoff only: never expose this value through renderer IPC.
  async function reviewLaunchWork(owned) {
    let profileIO, policyIO, profile, policy, currentProfile, currentPolicy, result;
    try {
      if (!owned() || closed || retained) throw Error('UNAVAILABLE');
      const assets = platform === 'win32' && packaged ? await getAssets() : null;
      if (!assets || !(await profilePresence(target)).reviewable) throw Error('UNAVAILABLE');
      profileIO = await openFactory(makeReadIO, {
        ownedProfile: true,
        targetPath: nativePath(target),
        assets,
        requestMs: 1500,
        sessionMs: 180000,
        cleanupMs: 1000,
      });
      if (!owned() || closed) throw Error('CANCELLED');
      profile = await profileIO.readTarget();
      if (!Buffer.isBuffer(profile?.bytes) || typeof profile.identity !== 'string')
        throw Error('PROFILE_CHANGED');
      const selected = readProfile(profile.bytes, { executable, appPath, powershell });
      if (!selected) throw Error('PROFILE_CHANGED');
      // A modified profile cannot nominate an arbitrary file for inspection.
      // The owner reselects the exact policy through a native file dialog.
      const choice = await dialog.showOpenDialog(getWindow(), {
        title: 'Confirm Codex action policy',
        properties: ['openFile'],
        filters: [{ name: 'AEGIS action policy', extensions: ['json'] }],
      });
      if (!owned() || closed || choice.canceled || choice.filePaths?.length !== 1)
        throw Error('CANCELLED');
      if (
        nativePath(choice.filePaths[0]).toLowerCase() !== nativePath(selected.policy).toLowerCase()
      )
        throw Error('POLICY_CHANGED');
      policyIO = await openFactory(makeReadIO, {
        selectedPolicy: true,
        targetPath: nativePath(selected.policy),
        assets,
        requestMs: 1500,
        sessionMs: 180000,
        cleanupMs: 1000,
      });
      if (!owned() || closed) throw Error('CANCELLED');
      policy = await policyIO.readTarget();
      if (!Buffer.isBuffer(policy?.bytes) || typeof policy.identity !== 'string')
        throw Error('INVALID_POLICY');
      const parsed = selectedPolicy(policy.bytes);
      if (!parsed || typeof parsed.cwd !== 'string') throw Error('INVALID_POLICY');
      const executableChoice = await dialog.showOpenDialog(getWindow(), {
        title: 'Select codex.exe',
        properties: ['openFile'],
        filters: [{ name: 'Executable', extensions: ['exe'] }],
      });
      if (
        !owned() ||
        closed ||
        executableChoice.canceled ||
        executableChoice.filePaths?.length !== 1
      )
        throw Error('CANCELLED');
      const codex = await verifyExecutable(executableChoice.filePaths[0]);
      if (!owned() || closed) throw Error('CANCELLED');
      const sessionCommand = hookCommand(
        executable,
        appPath,
        selected.policy,
        powershell,
        parsed.digest,
      );
      const detail = `Selected Codex executable:\n${codex.codexPath}\nFile identity: ${codex.codexIdentity}\nSHA-256: ${codex.codexSha256}\n\nAEGIS-owned Codex hook profile:\n${target}\n\nExact session hook command:\n${sessionCommand}\n\nDecoded command script:\n${hookScript(executable, appPath, selected.policy, parsed.digest)}\n\nSelected policy:\n${selected.policy}\nSHA-256: ${parsed.digest}\n\nExact policy:\n${parsed.content}\n\nThe session hook denies if its policy bytes change. The launch derives a session-only hook override. Existing user, project and managed layers remain active. Codex does not support PreToolUse ask; AEGIS emits deny for ask. Review and trust the hook manually in Codex. The installed version is unverified; hook failures, timeouts or malformed responses may continue the tool. This does not cover write_stdin or establish blocking. Executable identity checks are point-in-time and replacement can occur before launch.`;
      if (Buffer.byteLength(detail) > 8192) throw Error('PREVIEW_TOO_LARGE');
      const started = now();
      if (!Number.isFinite(started) || started < 0) throw Error('EXPIRED');
      const answer = await dialog.showMessageBox(getWindow(), {
        type: 'question',
        title: 'Review Codex launch',
        message: 'Prepare this reviewed Codex session override?',
        detail,
        buttons: ['Cancel', 'Prepare launch'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (!owned() || closed) throw Error('CANCELLED');
      const finished = now();
      if (!Number.isFinite(finished) || finished < started || finished - started > 90000)
        throw Error('EXPIRED');
      if (answer.response !== 1) throw Error('CANCELLED');
      currentProfile = await profileIO.readTarget();
      currentPolicy = await policyIO.readTarget();
      const currentCodex = await verifyExecutable(codex.codexPath);
      if (!owned() || closed) throw Error('CANCELLED');
      if (
        currentCodex.codexPath !== codex.codexPath ||
        currentCodex.codexIdentity !== codex.codexIdentity ||
        currentCodex.codexSha256 !== codex.codexSha256
      )
        throw Error('CODEX_CHANGED');
      if (
        !Buffer.isBuffer(currentProfile?.bytes) ||
        currentProfile.identity !== profile.identity ||
        !currentProfile.bytes.equals(profile.bytes)
      )
        throw Error('PROFILE_CHANGED');
      if (
        !Buffer.isBuffer(currentPolicy?.bytes) ||
        currentPolicy.identity !== policy.identity ||
        !currentPolicy.bytes.equals(policy.bytes)
      )
        throw Error('POLICY_CHANGED');
      const verified = now();
      if (!Number.isFinite(verified) || verified < finished || verified - started > 90000)
        throw Error('EXPIRED');
      result = {
        ok: true,
        ...codex,
        profilePath: nativePath(target),
        profileIdentity: profile.identity,
        profileSha256: hash(profile.bytes),
        policyPath: nativePath(selected.policy),
        policyIdentity: policy.identity,
        policySha256: hash(policy.bytes),
        cwd: parsed.cwd,
      };
    } catch (error) {
      const codes = [
        'UNAVAILABLE',
        'CANCELLED',
        'PROFILE_CHANGED',
        'INVALID_POLICY',
        'POLICY_CHANGED',
        'CODEX_INVALID',
        'CODEX_CHANGED',
        'PREVIEW_TOO_LARGE',
        'EXPIRED',
      ];
      result = {
        ok: false,
        code: codes.includes(error?.message) ? error.message : 'OPERATION_FAILED',
      };
    } finally {
      profile?.bytes?.fill(0);
      policy?.bytes?.fill(0);
      currentProfile?.bytes?.fill(0);
      currentPolicy?.bytes?.fill(0);
      if (policyIO && !(await release(policyIO))) retained = true;
      if (profileIO && !(await release(profileIO))) retained = true;
    }
    if (retained) return { ok: false, code: 'RETAINED_UNKNOWN' };
    if (!owned() || closed) return { ok: false, code: 'CANCELLED' };
    return result;
  }

  /** Prepare a private, post-confirmation launch binding for a trusted caller.
   * @param {Function} owned Current renderer ownership check.
   * @returns {Promise<object>} Private handoff or fixed refusal. @since v0.21.0 */
  function reviewLaunch(owned) {
    if (typeof owned !== 'function' || busy) return Promise.resolve({ ok: false, code: 'BUSY' });
    busy = true;
    active = reviewLaunchWork(owned).finally(() => {
      busy = false;
      active = null;
    });
    return active;
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
  return { handle, reviewLaunch, close, hasPending: () => busy };
}

module.exports = { createCodexHookApp, verifyCodexExecutable };
