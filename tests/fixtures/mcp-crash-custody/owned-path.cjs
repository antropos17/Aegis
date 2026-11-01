'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// The caller must select a task-owned TEMP. This is a path check, not a sandbox.
function selectFixture({
  env = process.env,
  platform = process.platform,
  arch = process.arch,
  temp = os.tmpdir(),
  verifyParent = verifyWindowsParent,
} = {}) {
  const flag = env.AEGIS_MCP_CRASH_FIXTURE;
  const selected = env.AEGIS_MCP_CRASH_ROOT;
  if (flag === undefined && selected === undefined) return null;
  if (
    flag !== '1' ||
    platform !== 'win32' ||
    arch !== 'x64' ||
    typeof selected !== 'string' ||
    !path.isAbsolute(selected) ||
    !path.isAbsolute(temp)
  )
    throw Error('fixture-selection-invalid');
  const parent = path.resolve(temp);
  const target = path.resolve(selected);
  if (
    path.dirname(target).toLowerCase() !== parent.toLowerCase() ||
    !/^aegis-mcp-crash-[A-Za-z0-9]{6,32}$/.test(path.basename(target))
  )
    throw Error('fixture-selection-invalid');
  if (!verifyParent(parent, env)) throw Error('fixture-parent-unavailable');
  return target;
}

function verifyWindowsParent(parent, env) {
  const system = env.SystemRoot || env.SYSTEMROOT;
  if (typeof system !== 'string' || !path.isAbsolute(system)) return false;
  const executable = path.join(system, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const check = spawnSync(
    executable,
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-File',
      path.join(__dirname, 'check-parent.ps1'),
      '-Parent',
      parent,
    ],
    {
      cwd: parent,
      env: {
        SystemRoot: system,
        TEMP: parent,
        TMP: parent,
        HOME: parent,
        USERPROFILE: parent,
        APPDATA: parent,
        LOCALAPPDATA: parent,
      },
      windowsHide: true,
      timeout: 5000,
      maxBuffer: 8192,
      encoding: 'utf8',
    },
  );
  return check.status === 0 && !check.error && check.stdout === '' && check.stderr === '';
}

function createFixture(target) {
  fs.mkdirSync(target); // Non-recursive, exclusive: existing evidence is never replaced.
}
module.exports = { selectFixture, createFixture, verifyWindowsParent };
