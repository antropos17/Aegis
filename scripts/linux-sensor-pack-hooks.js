/** @file Build and verify the Linux sensor across electron-builder's pack boundary. */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { Arch } = require('builder-util');
const sensor = require('./build-linux-sensor');

const prepared = new Map();

function hashFile(filename) {
  const fd = fs.openSync(filename, 'r');
  const hash = createHash('sha256');
  const buffer = Buffer.alloc(64 * 1024);
  try {
    let count;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) !== 0)
      hash.update(buffer.subarray(0, count));
    return hash.digest('hex');
  } finally {
    fs.closeSync(fd);
  }
}

function packInfo(context) {
  const arch = Arch[context.arch];
  if (!['x64', 'arm64'].includes(arch))
    throw new Error('Linux sensor packaging requires x64 or arm64');
  if (!path.isAbsolute(context.appOutDir) || !path.isAbsolute(context.packager.projectDir))
    throw new Error('Linux sensor packaging paths are unavailable');
  return { arch, key: path.resolve(context.appOutDir), root: context.packager.projectDir };
}

/** Run even when npmRebuild is disabled; never run for other platforms.
 * @param {object} context Electron-builder beforePack context.
 * @returns {void}
 * @since 0.21.0-beta
 */
function beforePack(context) {
  if (context.electronPlatformName !== 'linux') return;
  const { arch, key, root } = packInfo(context);
  prepared.delete(key);
  const staged = sensor.buildLinuxSensor({ arch, root });
  sensor.verifyElf(staged, arch);
  prepared.set(key, { arch, staged, hash: hashFile(staged) });
}

/** Require the actual copied asset to match this pack's freshly built sensor.
 * @param {object} context Electron-builder afterPack context.
 * @returns {void}
 * @since 0.21.0-beta
 */
function afterPack(context) {
  if (context.electronPlatformName !== 'linux') return;
  const { arch, key } = packInfo(context);
  const record = prepared.get(key);
  prepared.delete(key);
  if (!record || record.arch !== arch) throw new Error('Linux sensor build receipt is missing');
  const copied = path.join(key, 'resources', 'sensor', 'aegis-sensor-linux');
  sensor.verifyElf(record.staged, arch);
  sensor.verifyElf(copied, arch);
  if (hashFile(record.staged) !== record.hash || hashFile(copied) !== record.hash)
    throw new Error('Packaged Linux sensor does not match the current build');
}

module.exports = { beforePack, afterPack };
