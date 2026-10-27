'use strict';

const fs = require('node:fs');
const path = require('node:path');

/** Publish only a verified copy in an exclusively reserved output directory.
 * A partial copy has no descriptor and must be retained for inspection.
 * @param {string} source Qualified staging directory.
 * @param {string} destination Fresh exact output directory.
 * @param {(path:string)=>void} verify Destination integrity verifier.
 * @param {typeof fs.cpSync} copy Optional test seam for interrupted copies.
 * @returns {void} @since v0.21.0 */
function publishAssets(source, destination, verify, copy = fs.cpSync) {
  fs.mkdirSync(destination);
  for (const folder of ['host', 'runtime'])
    copy(path.join(source, folder), path.join(destination, folder), {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
  verify(destination);
  fs.copyFileSync(
    path.join(source, 'assets.json'),
    path.join(destination, 'assets.json'),
    fs.constants.COPYFILE_EXCL,
  );
}
module.exports = { publishAssets };
