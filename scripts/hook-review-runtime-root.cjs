'use strict';
const path = require('node:path');

/** Select the SDK installation used by the build without searching PATH.
 * @param {string|undefined} explicit Explicit --runtime-root value.
 * @param {NodeJS.ProcessEnv} env Build environment.
 * @returns {string} Absolute selected installation root. @since v0.21.0 */
function selectRuntimeRoot(explicit, env) {
  const selected =
    explicit ||
    env.DOTNET_INSTALL_DIR ||
    env.DOTNET_ROOT ||
    path.join(env.ProgramFiles || 'C:/Program Files', 'dotnet');
  if (!path.isAbsolute(selected))
    throw Error('The selected .NET installation root must be absolute');
  return path.resolve(selected);
}

module.exports = { selectRuntimeRoot };
