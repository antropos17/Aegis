import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { extractFile } from '@electron/asar';
import { produceGuiManifest } from '../../scripts/produce-protected-gui-manifest.mjs';
import { rebootIdentity } from './etw-reboot-contract.mjs';

const archiveRefusals = new WeakMap();
const buildRefusalCodes = new Map([
  ['Expected source SHA required', 'source-sha-invalid'],
  ['Expected source HEAD mismatch', 'source-head-mismatch'],
  ['Clean source required', 'source-dirty'],
  ['Builder configuration required', 'builder-config-required'],
  ['Source file budget', 'source-file-budget'],
  ['Reviewed marked diagnostic package/config required', 'diagnostic-marker-refused'],
  ['Builder Electron version mismatch', 'builder-electron-version-mismatch'],
  ['Invalid current input binding', 'input-binding-invalid'],
  ['Successful ordered bounded build commands required', 'build-command-evidence-invalid'],
  ['Build inputs changed', 'build-input-drift'],
  ['Invalid bounded JSON input', 'bounded-json-invalid'],
  ['Invalid Electron version', 'installed-electron-version-invalid'],
  ['Installed Electron version mismatch', 'installed-electron-version-mismatch'],
]);
const publicSourcePath = (file) =>
  typeof file === 'string' &&
  file.length <= 240 &&
  /^src\/(?:main|shared)\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.(?:js|ts|json)$/.test(file) &&
  !file.split('/').some((part) => part === '.' || part === '..');

/** Return only closed failure codes and internally tagged public source names.
 * Arbitrary errors, assertion operands, paths and source contents remain private.
 * @param {unknown} error Actual build refusal. @returns {object} Bounded diagnostic.
 * @since v0.20.1
 */
export function rebootBuildFailure(error) {
  if (error instanceof Error) {
    const tagged = archiveRefusals.get(error);
    if (tagged) return { ...tagged };
    for (const [message, code] of buildRefusalCodes)
      if (
        error.message === message ||
        (error instanceof assert.AssertionError && error.message.startsWith(message + '\n'))
      )
        return { code };
    if (error.code === 'ENOENT') return { code: 'build-input-unavailable' };
  }
  return { code: 'build-unclassified-refusal' };
}

/** Hash immutable receipt/package bytes. @param {Buffer|string} bytes
 * @returns {string} @since v0.19.2
 */
export const rebootHash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

/** Read bounded private evidence without silently accepting a link or oversized file.
 * @param {string} file @returns {object} @since v0.19.2
 */
export function readRebootReceipt(file) {
  const stat = fs.lstatSync(file);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 262144);
  const bytes = fs.readFileSync(file);
  let value;
  try {
    value = JSON.parse(bytes);
  } catch {
    throw new Error('Invalid bounded JSON input');
  }
  return { bytes, value };
}

/** Require ordinary local ancestor directories; never overwrite a previous attempt.
 * @param {string} output @param {string} root Source checkout.
 * @returns {void} @since v0.19.2
 */
export function newRebootOutput(output, root) {
  assert(path.isAbsolute(output) && !output.startsWith('\\\\'));
  const relative = path.relative(root, output);
  assert(
    relative.startsWith('..' + path.sep) || path.isAbsolute(relative),
    'Output must be outside source',
  );
  for (let cursor = path.dirname(output); ; cursor = path.dirname(cursor)) {
    const stat = fs.lstatSync(cursor);
    assert(stat.isDirectory() && !stat.isSymbolicLink(), 'Ordinary output ancestors required');
    if (cursor === path.dirname(cursor)) break;
  }
  fs.mkdirSync(output);
  fs.mkdirSync(path.join(output, 'temp'));
}

/** Read the supported OS boot timestamp directly, without a user-supplied boot override.
 * Clock changes or unavailable CIM remain unverified; this is an observation, not authority.
 * @param {object} env @returns {object} @since v0.19.2
 */
export function observeWindowsBoot(env) {
  const script =
    "$ErrorActionPreference='Stop'; $os=Get-CimInstance Win32_OperatingSystem; " +
    "[ordered]@{lastBootUtc=$os.LastBootUpTime.ToUniversalTime().ToString('o'); " +
    "observedAt=[DateTime]::UtcNow.ToString('o'); version=$os.Version} | ConvertTo-Json -Compress";
  return JSON.parse(
    execFileSync(
      path.join(process.env.WINDIR, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { env, windowsHide: true, timeout: 15000, maxBuffer: 4096, encoding: 'utf8' },
    ),
  );
}

/** Compute source/package/config metadata; never include configuration contents.
 * @param {string} root @param {string} candidate @param {string} expectedHead
 * @param {string} configFile @param {object} versions @param {object} deps Test seams.
 * @returns {object} @since v0.19.2
 */
export function rebootBuildInputs(root, candidate, expectedHead, configFile, versions, deps = {}) {
  const git =
    deps.git ??
    ((...args) =>
      execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 20000 }).trim());
  assert(/^[a-f0-9]{40}$/.test(expectedHead), 'Expected source SHA required');
  assert.equal(git('rev-parse', 'HEAD'), expectedHead, 'Expected source HEAD mismatch');
  assert.equal(
    git('status', '--porcelain', '--untracked-files=normal'),
    '',
    'Clean source required',
  );
  assert(path.isAbsolute(configFile ?? ''), 'Builder configuration required');
  const config = readRebootReceipt(configFile);
  const archive = path.join(candidate, 'resources/app.asar');
  const files = git(
    'ls-files',
    'src/main',
    'src/shared',
    'sidecar/etw-file',
    'sidecar/etw-lifecycle/Security.cs',
  )
    .split(/\r?\n/)
    .filter((file) => /\.(?:js|ts|json|cs|csproj)$/.test(file));
  const all = [],
    archived = [];
  for (const file of files) {
    const source = path.join(root, file);
    assert(fs.lstatSync(source).size <= 2 * 1024 ** 2, 'Source file budget');
    const data = fs.readFileSync(source);
    all.push([file, rebootHash(data)]);
    if (file.startsWith('src/')) {
      let bytes;
      try {
        bytes = extractFile(archive, path.normalize(file));
      } catch (error) {
        if (error instanceof Error)
          archiveRefusals.set(error, {
            code:
              error.message === `"${path.normalize(file)}" was not found in this archive`
                ? 'archive-entry-missing'
                : 'archive-read-refused',
            ...(publicSourcePath(file) ? { source: file } : {}),
          });
        throw error;
      }
      try {
        assert(data.equals(bytes), 'Archived runtime source mismatch');
      } catch (error) {
        archiveRefusals.set(error, {
          code: 'archive-source-mismatch',
          ...(publicSourcePath(file) ? { source: file } : {}),
        });
        throw error;
      }
      archived.push([file, rebootHash(data)]);
    }
  }
  const metadata = JSON.parse(extractFile(archive, 'package.json'));
  assert(
    metadata.aegisEtwDiagnostic === true && config.value.extraMetadata?.aegisEtwDiagnostic === true,
    'Reviewed marked diagnostic package/config required',
  );
  assert(
    config.value.electronVersion === undefined ||
      config.value.electronVersion === versions.electronVersion,
    'Builder Electron version mismatch',
  );
  const binding = {
    sourceHead: expectedHead,
    sourceTree: git('rev-parse', 'HEAD^{tree}'),
    lockSha256: rebootHash(fs.readFileSync(path.join(root, 'package-lock.json'))),
    packageManifestSha256: rebootHash(produceGuiManifest(candidate)),
    nativeExeSha256: rebootHash(
      fs.readFileSync(path.join(candidate, 'resources/etw-file/EtwFile.exe')),
    ),
    nativeDllSha256: rebootHash(
      fs.readFileSync(path.join(candidate, 'resources/etw-file/EtwFile.dll')),
    ),
    runtimeSourcesSha256: rebootHash(JSON.stringify(all)),
    archiveSourceSha256: rebootHash(JSON.stringify(archived)),
    harnessSha256: rebootHash(
      JSON.stringify(
        git('ls-files', 'tools/development', 'frontend/observatory/tests', 'scripts')
          .split(/\r?\n/)
          .filter((file) => /\.(?:mjs|js|cs)$/.test(file))
          .map((file) => [file, rebootHash(fs.readFileSync(path.join(root, file)))]),
      ),
    ),
    configSha256: rebootHash(config.bytes),
    publicProtocol: 'etw-file/10',
    observerContract: 'full-record-sha256-v1',
    diagnosticBuild: true,
    nodeVersion: process.versions.node,
    electronVersion: versions.electronVersion,
    dotnetSdk: versions.dotnetSdk,
    platform: deps.platform ?? process.platform,
    arch: deps.arch ?? process.arch,
  };
  assert(
    rebootIdentity({ ...binding, buildReceiptSha256: rebootHash('') }),
    'Invalid current input binding',
  );
  return binding;
}

/** Freeze the package against its supported bounded build projection before launch.
 * @param {string} root @param {string} candidate @param {string} expectedHead
 * @param {string} buildFile @param {string} configFile @param {object} deps Test seams.
 * @returns {object} @since v0.19.2
 */
export function rebootBinding(root, candidate, expectedHead, buildFile, configFile, deps = {}) {
  assert(path.isAbsolute(buildFile ?? ''), 'Build receipt required');
  const build = readRebootReceipt(buildFile);
  const binding = {
    ...rebootBuildInputs(root, candidate, expectedHead, configFile, build.value, deps),
    buildReceiptSha256: rebootHash(build.bytes),
  };
  assert(
    build.value.status === 'PASS' &&
      build.value.schemaVersion === 1 &&
      ['etw-sdk-version', 'etw-publish', 'etw-published-self-test', 'package'].every(
        (name) => build.value.commands?.filter((c) => c.name === name).length === 1,
      ) &&
      build.value.commands.every((c) => c.code === 0 && !c.error && !c.reason),
    'Successful bounded build receipt required',
  );
  for (const key of [
    'sourceHead',
    'sourceTree',
    'lockSha256',
    'packageManifestSha256',
    'nativeExeSha256',
    'nativeDllSha256',
    'runtimeSourcesSha256',
    'archiveSourceSha256',
    'configSha256',
    'harnessSha256',
    'publicProtocol',
    'observerContract',
    'diagnosticBuild',
    'nodeVersion',
    'electronVersion',
    'dotnetSdk',
    'platform',
    'arch',
  ])
    assert.equal(build.value[key], binding[key], 'Build input mismatch');
  return binding;
}

/** Emit only after real bounded publish/self-test/package commands succeeded.
 * Caller supplies observations from its actual command runner, never CLI assertions.
 * @param {string} root @param {string} candidate @param {string} expectedHead
 * @param {string} configFile @param {object} observation @param {string} file
 * @param {object} deps Test seams. @returns {object} @since v0.19.2
 */
export function writeRebootBuild(
  root,
  candidate,
  expectedHead,
  configFile,
  observation,
  file,
  deps = {},
) {
  const names = ['etw-sdk-version', 'etw-publish', 'etw-published-self-test', 'package'];
  const commands = observation.commands.filter((c) => names.includes(c.name));
  assert(
    commands.length === names.length &&
      commands.every(
        (c, i) =>
          c.name === names[i] &&
          c.code === 0 &&
          !c.error &&
          !c.reason &&
          !c.termination &&
          Number.isFinite(c.elapsedMs) &&
          c.elapsedMs >= 0 &&
          Number.isInteger(c.logBytes) &&
          c.logBytes >= 0 &&
          c.logBytes <= 2097152,
      ),
    'Successful ordered bounded build commands required',
  );
  const inputs = rebootBuildInputs(root, candidate, expectedHead, configFile, observation, deps);
  assert(
    inputs.sourceTree === observation.source.tree &&
      inputs.lockSha256 === observation.source.lockSha256 &&
      inputs.configSha256 === observation.configSha256 &&
      inputs.packageManifestSha256 === observation.packageManifestSha256,
    'Build inputs changed',
  );
  const projection = {
    schemaVersion: 1,
    status: 'PASS',
    ...inputs,
    commands: commands.map(({ name, code, elapsedMs, logBytes }) => ({
      name,
      code,
      elapsedMs,
      logBytes,
    })),
  };
  fs.writeFileSync(file, JSON.stringify(projection, null, 2) + '\n', { flag: 'wx' });
  return projection;
}

/** Await protocol-10 preparation for the fixture's observed original OS identity.
 * This never opens a PID after the event. @param {Function} snapshot Fresh diagnostic read.
 * @param {object} witness Original native fixture PID/full birth.
 * @param {object} options Bounded clock/wait seams. @returns {Promise<object>} Numeric ACK metadata.
 * @since v0.19.2
 */
export async function waitRebootIssuer(
  snapshot,
  witness,
  {
    now = () => performance.now(),
    wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    timeoutMs = 10000,
  } = {},
) {
  assert(
    Number.isSafeInteger(witness.pid) &&
      witness.pid > 0 &&
      witness.pid <= 2147483647 &&
      /^[1-9]\d{0,19}$/.test(witness.birth) &&
      BigInt(witness.birth) <= 18446744073709551615n,
  );
  assert(timeoutMs > 0 && timeoutMs <= 10000);
  const until = now() + timeoutMs;
  do {
    let timer;
    const data = await Promise.race([
      snapshot(),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(null), Math.max(1, Math.min(timeoutMs, until - now())));
      }),
    ]).finally(() => clearTimeout(timer));
    assert(data !== null, 'Exact original issuer preparation unavailable');
    assert(data.phase === 'running', 'Capture stopped before issuer preparation');
    const ack = data.issuerPreparation;
    const row =
      Array.isArray(ack?.prepared) && ack.prepared.length <= 16
        ? ack.prepared.find(
            (p) =>
              p.pid === witness.pid &&
              p.createTime100ns === witness.birth &&
              Number.isInteger(p.threads) &&
              p.threads > 0 &&
              p.threads <= 128,
          )
        : null;
    if (row && /^[1-9]\d{0,18}$/.test(ack.asOfQpc) && BigInt(ack.asOfQpc) <= 9223372036854775807n)
      return {
        pid: row.pid,
        createTime100ns: row.createTime100ns,
        threads: row.threads,
        asOfQpc: ack.asOfQpc,
      };
    await wait(100);
  } while (now() < until);
  throw new Error('Exact original issuer preparation unavailable');
}
