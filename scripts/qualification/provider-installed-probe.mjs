import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

async function fileHashes(selected, maximum, text) {
  if (typeof selected !== 'string' || !path.isAbsolute(selected) || /^[/\\]{2}/.test(selected))
    throw Error('provider-probe-invalid');
  const absolute = path.resolve(selected);
  const before = await fs.lstat(absolute);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.size > maximum ||
    (await fs.realpath(absolute)) !== absolute
  )
    throw Error('provider-probe-invalid');
  const handle = await fs.open(absolute, 'r');
  const hash = createHash('sha256'),
    chunks = [];
  try {
    let position = 0;
    const buffer = Buffer.alloc(65536);
    while (position < before.size) {
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(buffer.length, before.size - position),
        position,
      );
      if (!bytesRead) throw Error('provider-probe-changed');
      hash.update(buffer.subarray(0, bytesRead));
      if (text) chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
      position += bytesRead;
    }
    buffer.fill(0);
    const after = await handle.stat(),
      named = await fs.lstat(absolute);
    if (
      ![after, named].every((stat) =>
        ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].every((key) => stat[key] === before[key]),
      )
    )
      throw Error('provider-probe-changed');
    const rawSha256 = hash.digest('hex');
    let lfSha256 = null;
    if (text)
      lfSha256 = createHash('sha256')
        .update(Buffer.concat(chunks).toString('utf8').replaceAll('\r\n', '\n'))
        .digest('hex');
    return { rawSha256, lfSha256, bytes: before.size };
  } finally {
    for (const chunk of chunks) chunk.fill(0);
    await handle.close();
  }
}

function versionProcess(nativePath, spawnProcess) {
  return new Promise((resolve, reject) => {
    let child,
      timer,
      killTimer,
      size = 0,
      exceeded = false,
      stderrBytes = 0;
    const chunks = [];
    const abort = () => {
      exceeded = true;
      killTimer ||= setTimeout(() => finish(), 1000);
      child?.kill('SIGKILL');
    };
    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      try {
        if (code !== 0 || exceeded || stderrBytes) throw Error('provider-probe-unavailable');
        resolve(Buffer.concat(chunks).toString('utf8').trim());
      } catch {
        reject(Error('provider-probe-unavailable'));
      } finally {
        for (const chunk of chunks) chunk.fill(0);
      }
    };
    try {
      const env = {
        TEMP: os.tmpdir(),
        TMP: os.tmpdir(),
        ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
        ...(process.env.WINDIR ? { WINDIR: process.env.WINDIR } : {}),
      };
      child = spawnProcess(nativePath, ['--version'], {
        windowsHide: true,
        shell: false,
        cwd: os.tmpdir(),
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child.on('error', () => finish());
      child.on('close', finish);
      child.stdout.on('data', (chunk) => {
        if ((size += chunk.length) > 4096) abort();
        else chunks.push(Buffer.from(chunk));
      });
      child.stderr.on('data', (chunk) => {
        stderrBytes += chunk.length;
        if ((size += chunk.length) > 4096) abort();
      });
      timer = setTimeout(abort, 2000);
    } catch {
      finish();
    }
  });
}

/** Probe only explicit selected files and one fixed native --version operation.
 * No provider configuration or auth discovery is performed by this probe.
 * @param {{provider:string,nativePath:string,wrapperPath:string,launcherPath:string}} selected Trusted explicit paths.
 * @param {{spawnProcess?:function}} dependencies Trusted test-only process seam.
 * @returns {Promise<object>} Bounded non-authorizing metadata, no selected paths/raw diagnostics. @since v0.17.0 */
export async function inspectInstalledProvider(selected, { spawnProcess = spawn } = {}) {
  try {
    if (
      !selected ||
      !['codex', 'claude'].includes(selected.provider) ||
      path.basename(selected.nativePath).toLowerCase() !== `${selected.provider}.exe` ||
      !/\.(?:cmd|ps1|js|cjs|mjs)$/.test(selected.wrapperPath) ||
      !/\.(?:js|cjs|mjs)$/.test(selected.launcherPath)
    )
      throw Error('invalid');
    const native = await fileHashes(selected.nativePath, 268435456, false);
    const wrapper = await fileHashes(selected.wrapperPath, 1048576, true),
      launcher = await fileHashes(selected.launcherPath, 1048576, true);
    const output = await versionProcess(selected.nativePath, spawnProcess);
    const match =
      selected.provider === 'codex'
        ? /^codex-cli (\d{1,4}\.\d{1,4}\.\d{1,4})$/.exec(output)
        : /^(\d{1,4}\.\d{1,4}\.\d{1,4}) \(Claude Code\)$/.exec(output);
    if (!match) throw Error('invalid');
    const rechecked = await fileHashes(selected.nativePath, 268435456, false);
    const wrapperAfter = await fileHashes(selected.wrapperPath, 1048576, true),
      launcherAfter = await fileHashes(selected.launcherPath, 1048576, true);
    if (
      JSON.stringify(native) !== JSON.stringify(rechecked) ||
      JSON.stringify(wrapper) !== JSON.stringify(wrapperAfter) ||
      JSON.stringify(launcher) !== JSON.stringify(launcherAfter)
    )
      throw Error('changed');
    return Object.freeze({
      schemaVersion: 1,
      provider: selected.provider,
      result: 'version-observed',
      version: match[1],
      native,
      wrapper,
      launcher,
      platform: process.platform,
      architecture: process.arch,
      nodeVersion: process.version,
      operation: 'native-version-only',
      spawnedProcesses: 1,
      hostHookBehavior: 'not-run',
      authentication: 'not-run',
      launchAllowed: false,
    });
  } catch {
    return Object.freeze({
      schemaVersion: 1,
      result: 'unavailable',
      hostHookBehavior: 'not-run',
      authentication: 'not-run',
      launchAllowed: false,
    });
  }
}
