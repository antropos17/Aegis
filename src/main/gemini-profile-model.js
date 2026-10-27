'use strict';

const path = require('node:path');
const { scanJson, previewEdits, edited } = require('./claude-hook-json');

const SHELL_PATH = /^[A-Za-z]:[\\/][A-Za-z0-9 _./\\-]+$/;
const APP_SHELL_PATH = /^[A-Za-z]:[\\/][A-Za-z0-9 _&./\\-]+$/;

/** Format a Windows path as a strictly bounded PowerShell literal.
 * @param {string} input Absolute Windows path. @param {boolean} [appPath] Permit the packaged app's literal ampersand.
 * @returns {string} Safe literal for a command hook.
 * @since v0.21.0
 */
function shellPath(input, appPath = false) {
  if (
    typeof input !== 'string' ||
    input.length > 1024 ||
    !(appPath ? APP_SHELL_PATH : SHELL_PATH).test(input)
  )
    throw Error('unsupported-path');
  if (input.split(/[\\/]/).some((part) => part === '.' || part === '..'))
    throw Error('unsupported-path');
  return `'${path.win32.normalize(input).replaceAll('\\', '/')}'`;
}

/** Produce the selected hook command with no shell or Gemini variable expansion.
 * @param {string} executable Packaged app executable.
 * @param {string} appPath Packaged app archive.
 * @param {string} policy Selected exact-deny policy.
 * @returns {string} Fixed PowerShell command.
 * @since v0.21.0
 */
function hookCommand(executable, appPath, policy) {
  const arg = (input, app = false) => `'"${shellPath(input, app).slice(1, -1)}"'`;
  const entry = path.win32.join(appPath, 'src', 'main', 'main.js');
  const deny = JSON.stringify({
    decision: 'deny',
    reason: 'AEGIS policy does not allow this tool request.',
  });
  return `try { [Environment]::SetEnvironmentVariable('ELECTRON_RUN_AS_NODE','1','Process'); Set-Variable -Name aegisCode -Value ((Start-Process -FilePath ${shellPath(executable, true)} -ArgumentList @(${arg(entry, true)}, '--gemini-beforetool-exit-code', ${arg(policy)}) -RedirectStandardOutput 'NUL' -RedirectStandardError '\\\\.\\NUL' -NoNewWindow -Wait -PassThru -ErrorAction Stop).ExitCode); if ((Get-Variable -Name aegisCode -ValueOnly) -eq 0) { [Console]::Out.WriteLine('{}') } else { [Console]::Out.WriteLine('${deny}') }; exit 0 } catch { [Console]::Out.WriteLine('${deny}'); exit 0 }`;
}

function recognizedCommand(command, executable, appPath) {
  try {
    const placeholder = 'C:/AEGIS-policy-placeholder.json';
    const example = hookCommand(executable, appPath, placeholder);
    const pieces = example.split(placeholder);
    if (
      pieces.length !== 2 ||
      typeof command !== 'string' ||
      !command.startsWith(pieces[0]) ||
      !command.endsWith(pieces[1])
    )
      return false;
    const policy = command.slice(pieces[0].length, command.length - pieces[1].length);
    return hookCommand(executable, appPath, policy) === command;
  } catch {
    return false;
  }
}

function exactEntry(node, executable, appPath) {
  const children = node?.members.get('hooks');
  const hook = children?.items[0];
  return (
    node?.kind === 'object' &&
    node.members.size === 2 &&
    node.members.get('matcher')?.value === '^run_shell_command$' &&
    children?.kind === 'array' &&
    children.items.length === 1 &&
    hook?.kind === 'object' &&
    hook.members.size === 4 &&
    hook.members.get('type')?.value === 'command' &&
    hook.members.get('name')?.value === 'aegis-gemini-exact-deny' &&
    hook.members.get('timeout')?.value === 5000 &&
    recognizedCommand(hook.members.get('command')?.value, executable, appPath)
  );
}

/** Plan exact source-preserving edits for the AEGIS-owned Gemini settings.
 * @param {Buffer} bytes Current private strict-JSON settings.
 * @param {object} selection Fixed operation, target and trusted app paths.
 * @returns {object|null} Private after bytes and complete changed fragments, or refusal.
 * @since v0.21.0
 */
function planProfileChange(bytes, { action, target, executable, appPath, command }) {
  let source;
  try {
    source = scanJson(bytes);
    const root = source.root;
    if (root.kind !== 'object') return null;
    const hooks = root.members.get('hooks');
    if (hooks && hooks.kind !== 'object') return null;
    const array = hooks?.members.get('BeforeTool');
    if (array && array.kind !== 'array') return null;
    const entries = array?.items || [];
    const named = entries.filter((entry) =>
      entry.members
        .get('hooks')
        ?.items.some(
          (hook) =>
            hook.members.get('name')?.value === 'aegis-gemini-exact-deny' ||
            recognizedCommand(hook.members.get('command')?.value, executable, appPath),
        ),
    );
    let edits;
    if (action === 'install') {
      if (named.length || typeof command !== 'string') return null;
      const entry = JSON.stringify({
        matcher: '^run_shell_command$',
        hooks: [
          {
            type: 'command',
            name: 'aegis-gemini-exact-deny',
            command,
            timeout: 5000,
          },
        ],
      });
      const parent = array || hooks || root;
      const children = parent.kind === 'array' ? parent.items : [...parent.members.values()];
      const start = children.length ? children[children.length - 1].end : parent.start + 1;
      const value = array
        ? entry
        : hooks
          ? `"BeforeTool":[${entry}]`
          : `"hooks":{"BeforeTool":[${entry}]}`;
      edits = [{ start, end: start, text: (children.length ? ',' : '') + value }];
    } else if (action === 'remove') {
      if (named.length !== 1 || !exactEntry(named[0], executable, appPath)) return null;
      const entry = named[0];
      const index = entries.indexOf(entry);
      edits = [{ start: entry.start, end: entry.end, text: '' }];
      if (entries.length > 1) {
        const comma = array.commas[index ? index - 1 : 0];
        edits.push({ start: comma, end: comma + 1, text: '' });
      }
    } else return null;
    const review = previewEdits(source, target, edits);
    return { after: edited(bytes, review), fragments: review.changedFragments };
  } catch {
    return null;
  } finally {
    source?.bytes.fill(0);
  }
}

module.exports = { shellPath, hookCommand, planProfileChange, recognizedCommand };
