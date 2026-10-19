'use strict';
const fs = require('node:fs');
const path = require('node:path');

/** Validate a bounded local folder scope; whole drives and alternate namespaces fail.
 * @param {unknown} root Proposed lexical retention root.
 * @returns {boolean} Whether native FileScope can represent it. @since v0.19.2
 */
function validRoot(root) {
  return (
    typeof root === 'string' &&
    /^[A-Za-z]:\\[^\\]/.test(root) &&
    root.length <= 1024 &&
    !/[\p{Cc}/]/u.test(root) &&
    !root.slice(3).includes(':') &&
    root
      .split('\\')
      .slice(1)
      .every((part) => part !== '.' && part !== '..' && !/[. ]$/.test(part))
  );
}

/** Require an existing ordinary folder, without adopting a reparse-root alias.
 * This is a launch-time scope check, not a resolved identity claim for later reads.
 * @param {string} root Selected local folder.
 * @returns {boolean} Whether the current root is usable. @since v0.19.2
 */
function checkRoot(root) {
  if (!validRoot(root)) return false;
  try {
    const entry = fs.lstatSync(root);
    const canonical = (value) => path.win32.normalize(value).replace(/\\$/, '').toLowerCase();
    return (
      entry.isDirectory() &&
      !entry.isSymbolicLink() &&
      canonical(fs.realpathSync.native(root)) === canonical(root)
    );
  } catch {
    return false;
  }
}
module.exports = { validRoot, checkRoot };
