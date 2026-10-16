'use strict';

const fs = require('node:fs');
const path = require('node:path');
const FLAG = '--aegis-owned-gui-profile';
const refused = () => {
  throw Error('owned-gui-profile-refused');
};

/** Detect the reserved storage selector, including malformed spellings to reject.
 * @param {string[]} argv Startup arguments after the executable.
 * @returns {boolean} Whether isolated profile validation is required. @since v0.19.2 */
function hasOwnedGuiProfileSelector(argv) {
  return argv.some((value) => typeof value === 'string' && value.toLowerCase().startsWith(FLAG));
}

/** Configure ordinary isolated storage before settings, CLI or singleton dispatch.
 * The selector carries no process ownership, enrollment or operation authority.
 * @param {string[]} argv Startup arguments after the packaged executable.
 * @param {object} app Electron application whose paths have not been consumed.
 * @returns {boolean} Whether a profile was configured. @since v0.19.2 */
function configureOwnedGuiProfile(argv, app) {
  if (!hasOwnedGuiProfileSelector(argv)) return false;
  try {
    if (
      argv.length !== 2 ||
      argv[0] !== FLAG ||
      typeof argv[1] !== 'string' ||
      !argv[1] ||
      argv[1].length > 2048 ||
      argv[1].includes('\0') ||
      !path.isAbsolute(argv[1])
    )
      refused();
    const selected = path.resolve(argv[1]);
    const stat = fs.lstatSync(selected);
    if (!stat.isDirectory() || stat.isSymbolicLink()) refused();
    const actual = fs.realpathSync(selected);
    const same =
      process.platform === 'win32'
        ? actual.toLowerCase() === selected.toLowerCase()
        : actual === selected;
    if (!same || selected !== argv[1]) refused();
    app.setPath('userData', selected);
    app.setPath('sessionData', selected);
    return true;
  } catch {
    refused();
  }
}

module.exports = { hasOwnedGuiProfileSelector, configureOwnedGuiProfile };
