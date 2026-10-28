'use strict';

const path = require('node:path');
const { scanJson, previewEdits, edited } = require('./claude-hook-json');

const ORDINARY_PATH = /^[A-Za-z]:[\\/][A-Za-z0-9 _./\\-]+$/;
const APPLICATION_PATH = /^[A-Za-z]:[\\/][A-Za-z0-9 _&./\\-]+$/;
const SYSTEM_PATH = /^[A-Za-z]:[\\/][A-Za-z0-9_.\\/-]+$/;
const exact = (value, names) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).length === names.length &&
  names.every((name) => Object.hasOwn(value, name));

function safePath(value, kind = 'ordinary') {
  const pattern =
    kind === 'system' ? SYSTEM_PATH : kind === 'application' ? APPLICATION_PATH : ORDINARY_PATH;
  if (
    typeof value !== 'string' ||
    value.length > 1024 ||
    !pattern.test(value) ||
    value.split(/[\\/]/).some((part) => part === '.' || part === '..')
  )
    throw Error('unsupported-path');
  return path.win32.normalize(value).replaceAll('\\', '/');
}

/** Fixed absolute Windows PowerShell and strictly literal application inputs.
 * @param {string} executable AEGIS executable. @param {string} appPath AEGIS app archive.
 * @param {string} policy Selected policy. @param {string} [policyDigest] Reviewed session digest.
 * @returns {string} Native review script. @since v0.21.0 */
function hookScript(executable, appPath, policy, policyDigest) {
  const exe = safePath(executable, 'application');
  const app = safePath(appPath, 'application');
  const file = safePath(policy);
  if (policyDigest !== undefined && !/^[a-f0-9]{64}$/.test(policyDigest))
    throw Error('unsupported-policy-digest');
  const denial = JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: 'AEGIS could not evaluate this request.',
    },
  });
  const binding = policyDigest === undefined ? '' : ` '${policyDigest}'`;
  return `$ErrorActionPreference='Stop'\ntry { & '${exe}' '${app}' '--codex-pretool-hook' '${file}'${binding}; exit $LASTEXITCODE } catch { [Console]::Out.WriteLine('${denial}'); exit 0 }`;
}

/** Build a shell-independent command containing no renderer-selected bytes.
 * @param {string} executable AEGIS executable. @param {string} appPath AEGIS archive.
 * @param {string} policy Selected policy. @param {string} powershell Fixed system PowerShell.
 * @param {string} [policyDigest] Reviewed session digest.
 * @returns {string} Encoded fixed command. @since v0.21.0 */
function hookCommand(executable, appPath, policy, powershell, policyDigest) {
  const shell = safePath(powershell, 'system');
  if (!/\/System32\/WindowsPowerShell\/v1\.0\/powershell\.exe$/i.test(shell))
    throw Error('unsupported-path');
  const script = hookScript(executable, appPath, policy, policyDigest);
  return `${shell} -NoLogo -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(script, 'utf16le').toString('base64')}`;
}

/** Recover only a command generated from these fixed trusted application paths.
 * @param {unknown} value Private command. @param {string} executable AEGIS executable.
 * @param {string} appPath AEGIS archive. @param {string} powershell Fixed system PowerShell.
 * @returns {string|null} Selected policy or refusal. @since v0.21.0 */
function policyFromCommand(value, executable, appPath, powershell) {
  try {
    if (typeof value !== 'string' || value.length > 8192) return null;
    const prefix = `${safePath(powershell, 'system')} -NoLogo -NoProfile -NonInteractive -EncodedCommand `;
    if (!value.startsWith(prefix)) return null;
    const encoded = value.slice(prefix.length);
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))
      return null;
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.toString('base64') !== encoded || bytes.length % 2) return null;
    const script = bytes.toString('utf16le');
    const placeholder = 'C:/AEGIS-policy-placeholder.json';
    const parts = hookScript(executable, appPath, placeholder).split(placeholder);
    if (parts.length !== 2 || !script.startsWith(parts[0]) || !script.endsWith(parts[1]))
      return null;
    const selected = script.slice(parts[0].length, script.length - parts[1].length);
    return hookCommand(executable, appPath, selected, powershell) === value ? selected : null;
  } catch {
    return null;
  }
}

/** Validate the complete app-owned file; no foreign or multiple hooks are adopted.
 * @param {Buffer} bytes Profile bytes. @param {object} options Trusted application paths.
 * @returns {object|null} Fixed command and policy or refusal. @since v0.21.0 */
function readProfile(bytes, { executable, appPath, powershell }) {
  let source;
  try {
    source = scanJson(bytes);
    const value = JSON.parse(source.text);
    if (
      !exact(value, ['hooks']) ||
      !exact(value.hooks, ['PreToolUse']) ||
      !Array.isArray(value.hooks.PreToolUse) ||
      value.hooks.PreToolUse.length !== 1
    )
      return null;
    const group = value.hooks.PreToolUse[0];
    if (
      !exact(group, ['matcher', 'hooks']) ||
      group.matcher !== '^Bash$' ||
      !Array.isArray(group.hooks) ||
      group.hooks.length !== 1
    )
      return null;
    const hook = group.hooks[0];
    if (
      !exact(hook, ['type', 'command', 'timeout']) ||
      hook.type !== 'command' ||
      hook.timeout !== 5
    )
      return null;
    const policy = policyFromCommand(hook.command, executable, appPath, powershell);
    return policy ? { command: hook.command, policy } : null;
  } catch {
    return null;
  } finally {
    source?.bytes.fill(0);
  }
}

/** Plan a complete fixed-profile edit, requiring an empty draft or exact owned entry.
 * @param {Buffer} bytes Current bytes. @param {object} options Trusted selections and action.
 * @returns {object|null} Exact after bytes and fragments. @since v0.21.0 */
function planProfileChange(bytes, options) {
  let source;
  try {
    source = scanJson(bytes);
    let replacement;
    if (options.action === 'install') {
      if (
        source.root.kind !== 'object' ||
        source.root.members.size !== 0 ||
        !policyFromCommand(options.command, options.executable, options.appPath, options.powershell)
      )
        return null;
      replacement = JSON.stringify({
        hooks: {
          PreToolUse: [
            {
              matcher: '^Bash$',
              hooks: [{ type: 'command', command: options.command, timeout: 5 }],
            },
          ],
        },
      });
    } else if (options.action === 'remove') {
      if (!readProfile(bytes, options)) return null;
      replacement = '{}';
    } else return null;
    const review = previewEdits(source, options.target, [
      { start: source.root.start, end: source.root.end, text: replacement },
    ]);
    return { after: edited(bytes, review), fragments: review.changedFragments };
  } catch {
    return null;
  } finally {
    source?.bytes.fill(0);
  }
}

module.exports = { hookScript, hookCommand, policyFromCommand, readProfile, planProfileChange };
