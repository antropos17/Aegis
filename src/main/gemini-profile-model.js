'use strict';

const path = require('node:path');

const SHELL_PATH = /^[A-Za-z]:[\\/][A-Za-z0-9 _./\\-]+$/;
const APP_SHELL_PATH = /^[A-Za-z]:[\\/][A-Za-z0-9 _&./\\-]+$/;

/** Format a Windows path as a strictly bounded PowerShell literal.
 * @param {string} input Absolute Windows path. @param {boolean} [appPath] Permit the packaged app's literal ampersand.
 * @returns {string} Safe literal for a command hook.
 * @since v0.21.0
 */
function shellPath(input, appPath = false) {
  if (typeof input !== 'string' || input.length > 1024 || !(appPath ? APP_SHELL_PATH : SHELL_PATH).test(input))
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
  return `[Environment]::SetEnvironmentVariable('ELECTRON_RUN_AS_NODE','1','Process'); exit ((Start-Process -FilePath ${shellPath(executable, true)} -ArgumentList @(${arg(entry, true)}, '--gemini-beforetool-hook', ${arg(policy)}) -NoNewWindow -Wait -PassThru).ExitCode)`;
}

/** Make the only supported application-owned settings shape.
 * @param {string} command Reviewed command.
 * @returns {Buffer} Canonical exact settings bytes.
 * @since v0.21.0
 */
function settingsBytes(command) {
  return Buffer.from(
    JSON.stringify(
      {
        hooks: {
          BeforeTool: [
            {
              matcher: '^run_shell_command$',
              hooks: [{ type: 'command', name: 'aegis-gemini-exact-deny', command, timeout: 5000 }],
            },
          ],
        },
      },
      null,
      2,
    ) + '\n',
  );
}

/** Recognize only unchanged canonical settings for the currently running packaged app.
 * @param {Buffer} bytes Current settings bytes.
 * @param {string} executable Packaged app executable.
 * @param {string} appPath Packaged app archive.
 * @returns {boolean} Whether fresh review can remove this exact owned shape.
 * @since v0.21.0
 */
function removable(bytes, executable, appPath) {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const parsed = JSON.parse(text);
    const command = parsed?.hooks?.BeforeTool?.[0]?.hooks?.[0]?.command;
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
    if (hookCommand(executable, appPath, policy) !== command) return false;
    return settingsBytes(command).equals(bytes);
  } catch {
    return false;
  }
}

module.exports = { shellPath, hookCommand, settingsBytes, removable };
