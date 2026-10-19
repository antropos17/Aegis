'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

/** Publish the Windows x64 read sensor with its runtime for ordinary packages.
 * Missing SDK, restore/build errors and incomplete output stop packaging.
 * @param {string} root Project root.
 * @param {Function} execute Bounded native command seam.
 * @returns {string} Published directory. @since v0.19.2
 */
function buildEtwSidecar(root, execute = execFileSync) {
  const output = path.join(root, 'build/etw-file');
  execute(
    'dotnet',
    [
      'publish',
      path.join(root, 'sidecar/etw-file/EtwFile.csproj'),
      '-c',
      'Release',
      '-r',
      'win-x64',
      '--self-contained',
      'true',
      '-p:PublishSingleFile=false',
      '-o',
      output,
      '--nologo',
    ],
    { cwd: root, timeout: 240000, stdio: 'inherit', windowsHide: true },
  );
  for (const name of ['EtwFile.exe', 'EtwFile.dll', 'coreclr.dll', 'EtwFile.runtimeconfig.json'])
    if (!fs.statSync(path.join(output, name)).isFile())
      throw new Error('Incomplete ETW helper publish');
  return output;
}

if (require.main === module) buildEtwSidecar(path.resolve(__dirname, '..'));
module.exports = { buildEtwSidecar };
