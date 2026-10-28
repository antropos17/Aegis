'use strict';

const path = require('node:path');
const { createHash } = require('node:crypto');
const { parse } = require('smol-toml');
const { parseActionJson, validActionPolicy } = require('./action-policy');
const { readProfile, hookCommand } = require('./codex-profile-model');

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
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
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const normalized = (value) =>
  path.win32.normalize(value).replace(/^[a-z](?=:)/, (letter) => letter.toUpperCase());
const identity = (value) => typeof value === 'string' && /^[a-f0-9]{16}:[a-f0-9]{32}$/.test(value);
const digest = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

function validHandoff(value) {
  if (
    !object(value) ||
    Object.keys(value).length !== fields.length ||
    !fields.every((key) => Object.hasOwn(value, key))
  )
    return false;
  if (
    ![value.profilePath, value.policyPath, value.cwd, value.codexPath].every(
      (entry) => typeof entry === 'string' && /^[A-Za-z]:[\\/]/.test(entry) && entry.length <= 240,
    )
  )
    return false;
  if (
    path.win32.basename(value.profilePath).toLowerCase() !== 'hooks.json' ||
    path.win32.basename(path.win32.dirname(value.profilePath)).toLowerCase() !==
      'codex-hook-profile'
  )
    return false;
  return (
    identity(value.profileIdentity) &&
    identity(value.policyIdentity) &&
    digest(value.profileSha256) &&
    digest(value.policySha256) &&
    typeof value.codexIdentity === 'string' &&
    value.codexIdentity.length > 0 &&
    value.codexIdentity.length <= 256 &&
    digest(value.codexSha256) &&
    path.win32.basename(value.codexPath).toLowerCase() === 'codex.exe'
  );
}

/** Encode a private native-reviewed launch binding for terminal revalidation.
 * @param {object} value Fixed profile and policy identities/digests.
 * @returns {string} Bounded token, never sent to renderer. @since v0.21.0 */
function encodeLaunch(value) {
  if (!validHandoff(value)) throw Error('launch-unavailable');
  return Buffer.from(JSON.stringify(value)).toString('base64');
}

function decodeLaunch(token) {
  if (
    typeof token !== 'string' ||
    token.length > 4096 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(token)
  )
    throw Error('launch-unavailable');
  const bytes = Buffer.from(token, 'base64');
  try {
    if (bytes.toString('base64') !== token) throw Error('launch-unavailable');
    const result = parseActionJson(bytes);
    if (!validHandoff(result) || Buffer.from(JSON.stringify(result)).toString('base64') !== token)
      throw Error('launch-unavailable');
    return result;
  } finally {
    bytes.fill(0);
  }
}

function overrideFor(command) {
  if (
    typeof command !== 'string' ||
    command.includes("'") ||
    [...command].some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    throw Error('launch-unavailable');
  // The fixed hook command contains no apostrophes or backslashes. Literal
  // strings avoid embedded double quotes in the direct native process argv.
  if (command.includes('\\')) throw Error('launch-unavailable');
  const value = `[{matcher='^Bash$',hooks=[{type='command',command='${command}',timeout=5}]}]`;
  const parsed = parse(`hooks.PreToolUse=${value}`);
  const expected = [{ matcher: '^Bash$', hooks: [{ type: 'command', command, timeout: 5 }] }];
  if (JSON.stringify(parsed.hooks?.PreToolUse) !== JSON.stringify(expected))
    throw Error('launch-unavailable');
  return `hooks.PreToolUse=${value}`;
}

/** Recheck the reviewed profile and selected policy through native read leases.
 * This is a point-in-time check; later edits remain possible after release.
 * @param {string} token Private reviewed binding. @param {object} options Trusted runtime capabilities.
 * @returns {Promise<string>} Only the fixed inline hook override. @since v0.21.0 */
async function validatedOverride(token, options) {
  const value = decodeLaunch(token);
  const { executable, appPath, powershell, cwd, assets, makeReadIO } = options;
  if (cwd !== value.cwd) throw Error('launch-unavailable');
  const readers = [];
  let profile, policy;
  try {
    for (const [flag, filename] of [
      ['ownedProfile', value.profilePath],
      ['selectedPolicy', value.policyPath],
    ]) {
      const io = await makeReadIO({
        [flag]: true,
        targetPath: normalized(filename),
        assets,
        requestMs: 1500,
        sessionMs: 15000,
        cleanupMs: 1000,
      });
      readers.push(io);
    }
    profile = await readers[0].readTarget();
    policy = await readers[1].readTarget();
    if (
      profile.identity !== value.profileIdentity ||
      policy.identity !== value.policyIdentity ||
      hash(profile.bytes) !== value.profileSha256 ||
      hash(policy.bytes) !== value.policySha256
    )
      throw Error('launch-unavailable');
    const installed = readProfile(profile.bytes, { executable, appPath, powershell });
    const document = parseActionJson(policy.bytes);
    if (
      !installed ||
      normalized(installed.policy) !== normalized(value.policyPath) ||
      !validActionPolicy(document) ||
      document.cwd !== value.cwd
    )
      throw Error('launch-unavailable');
    for (const [index, first] of [profile, policy].entries()) {
      const again = await readers[index].readTarget();
      try {
        if (again.identity !== first.identity || !again.bytes.equals(first.bytes))
          throw Error('launch-unavailable');
      } finally {
        again.bytes.fill(0);
      }
    }
    const result = overrideFor(
      hookCommand(executable, appPath, installed.policy, powershell, value.policySha256),
    );
    for (const io of readers) {
      await io.close();
      if (io.status()?.admission !== 'closed' || io.status()?.exit !== 'confirmed')
        throw Error('launch-unavailable');
    }
    readers.length = 0;
    const verified = await (
      options.verifyCodexExecutable || require('./codex-hook-app').verifyCodexExecutable
    )(value.codexPath);
    if (
      !verified ||
      verified.codexPath !== value.codexPath ||
      verified.codexIdentity !== value.codexIdentity ||
      verified.codexSha256 !== value.codexSha256
    )
      throw Error('launch-unavailable');
    return { override: result, codexPath: verified.codexPath };
  } finally {
    profile?.bytes?.fill(0);
    policy?.bytes?.fill(0);
    for (const io of readers) await io.close().catch(() => {});
  }
}

function terminalScript(token, executable, entryPath) {
  const safe = /^[A-Za-z]:[\\/][A-Za-z0-9 _&.\\/-]+$/;
  if (!safe.test(executable) || !safe.test(entryPath) || !/^[A-Za-z0-9+/]+=*$/.test(token))
    throw Error('launch-unavailable');
  const exe = executable.replaceAll('\\', '/');
  const entry = entryPath.replaceAll('\\', '/');
  return `$ErrorActionPreference = 'Stop'
$p = $null
try {
  $info = New-Object System.Diagnostics.ProcessStartInfo
  $info.FileName = '${exe}'
  $info.Arguments = '"${entry}" --codex-launch-override ${token}'
  $info.WorkingDirectory = (Get-Location).ProviderPath
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $info.EnvironmentVariables['ELECTRON_RUN_AS_NODE'] = '1'
  $p = [System.Diagnostics.Process]::Start($info)
  if ($null -eq $p) { throw 'unavailable' }
  $clock = [System.Diagnostics.Stopwatch]::StartNew()
  $errorBuffer = New-Object char[] 1
  $errorRead = $p.StandardError.ReadAsync($errorBuffer, 0, 1)
  $buffer = New-Object char[] 8193
  $output = New-Object System.Text.StringBuilder
  while ($true) {
    $read = $p.StandardOutput.ReadAsync($buffer, 0, $buffer.Length)
    while (-not $read.Wait(50)) {
      if ($clock.ElapsedMilliseconds -gt 10000 -or ($errorRead.IsCompleted -and $errorRead.Result -ne 0)) { throw 'unavailable' }
    }
    $count = $read.Result
    if ($count -eq 0) { break }
    if ($output.Length + $count -gt 8192) { throw 'unavailable' }
    [void]$output.Append($buffer, 0, $count)
  }
  if (-not $p.WaitForExit([Math]::Max(1, 10000 - $clock.ElapsedMilliseconds))) { throw 'unavailable' }
  if (-not $errorRead.Wait(1000) -or $errorRead.Result -ne 0 -or $p.ExitCode -ne 0) { throw 'unavailable' }
  $verified = $output.ToString() | ConvertFrom-Json
  $override = $verified.override
  $codexPath = $verified.codexPath
  if ($override -isnot [string] -or -not $override.StartsWith('hooks.PreToolUse=') -or $override.Length -gt 8192 -or $override -match '["\\\r\n]') { throw 'unavailable' }
  if ($codexPath -isnot [string] -or -not [System.IO.Path]::IsPathRooted($codexPath) -or [System.IO.Path]::GetFileName($codexPath) -ine 'codex.exe') { throw 'unavailable' }
} catch {
  if ($null -ne $p) { try { if (-not $p.HasExited) { $p.Kill(); [void]$p.WaitForExit(1000) } } catch {} }
  [Console]::Error.WriteLine('AEGIS could not verify the reviewed Codex profile. Launch was not started.')
  exit 1
} finally { if ($null -ne $p) { $p.Dispose() } }
try {
  $launch = New-Object System.Diagnostics.ProcessStartInfo
  $launch.FileName = $codexPath
  $launch.Arguments = '--config "' + $override + '"'
  $launch.WorkingDirectory = (Get-Location).ProviderPath
  $launch.UseShellExecute = $false
  $child = [System.Diagnostics.Process]::Start($launch)
  if ($null -eq $child) { throw 'unavailable' }
  $child.WaitForExit()
  $code = $child.ExitCode
  $child.Dispose()
  exit $code
} catch {
  [Console]::Error.WriteLine('The native Codex launch or exit could not be confirmed.')
  exit 1
}`;
}

/** Fixed Windows PowerShell command for a user-invoked, point-in-time check.
 * @param {string} token Reviewed binding. @param {string} executable AEGIS executable.
 * @param {string} appPath Packaged app archive. @param {string} powershell Fixed system shell.
 * @returns {object} Exact command and private decoded review text. @since v0.21.0 */
function terminalCommand(token, executable, appPath, powershell) {
  decodeLaunch(token);
  const shell = powershell.replaceAll('\\', '/');
  if (
    !/^[A-Za-z]:\/[A-Za-z0-9_.\/-]+\/System32\/WindowsPowerShell\/v1\.0\/powershell\.exe$/i.test(
      shell,
    )
  )
    throw Error('launch-unavailable');
  const script = terminalScript(token, executable, path.win32.join(appPath, 'src/main/main.js'));
  const command = `${shell} -NoLogo -NoProfile -EncodedCommand ${Buffer.from(script, 'utf16le').toString('base64')}`;
  if (command.length > 30000) throw Error('launch-unavailable');
  return { command, script };
}

/** Revalidate the reviewed binding in the user's terminal immediately before launch.
 * @param {string[]} args Fixed CLI flag and binding. @param {Function} write Output sink.
 * @param {object} [deps] Private test-only runtime seams. @returns {Promise<number>} Fixed exit status.
 * @since v0.21.0 */
async function handleLaunchOverride(args, write, deps = {}) {
  try {
    if (!Array.isArray(args) || args.length !== 2 || args[0] !== '--codex-launch-override')
      throw Error('launch-unavailable');
    const runtime = deps.runtime || process;
    if (
      runtime.platform !== 'win32' ||
      !runtime.versions?.electron ||
      typeof runtime.resourcesPath !== 'string'
    )
      throw Error('launch-unavailable');
    const assets = await (
      deps.loadAssets || require('./claude-hook-app-profile').loadProfileAssets
    )(path.win32.join(runtime.resourcesPath, 'hook-review'));
    if (!assets || typeof runtime.env?.SystemRoot !== 'string') throw Error('launch-unavailable');
    const result = await validatedOverride(args[1], {
      executable: runtime.execPath,
      appPath: path.win32.join(runtime.resourcesPath, 'app.asar'),
      powershell: path.win32.join(
        runtime.env.SystemRoot,
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      ),
      cwd: runtime.cwd(),
      assets,
      makeReadIO: deps.makeReadIO || require('./claude-hook-windows-io').createWindowsHookReadIO,
      verifyCodexExecutable: deps.verifyCodexExecutable,
    });
    write(JSON.stringify(result));
    return 0;
  } catch {
    return 2;
  }
}

module.exports = {
  encodeLaunch,
  validatedOverride,
  overrideFor,
  terminalScript,
  terminalCommand,
  handleLaunchOverride,
};
