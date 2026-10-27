/** @file Trusted binary selection and pinned, host-observed D1 launch context. @since 0.19.2-beta */
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { createLinuxBirthConverter } = require('./sensor-identity');

/** Prepare one launch from fixed installation paths and a current adapter context.
 * No caller command, argument list, environment or executable path is admitted.
 * @param {object} deps Trusted platform/startup configuration and fixture seam.
 * @returns {Function} Launch returning child/context or a closed unavailable code.
 * @since 0.19.2-beta
 */
function createLauncher({ platform, packaged, getLinuxContext, test }) {
  const launch = test.spawn ?? spawn;
  const exists = test.exists ?? fs.existsSync;
  const name = platform === 'darwin' ? 'aegis-sensor-macos' : 'aegis-sensor-linux';
  const resources = test.resourcesPath ?? process.resourcesPath;
  const binary = !packaged
    ? path.resolve(__dirname, '../../..', 'sensors/target/release', name)
    : platform === 'linux'
      ? typeof resources === 'string' && path.isAbsolute(resources)
        ? path.join(resources, 'sensor', name)
        : null
      : path.join(path.dirname(process.execPath), name);
  let pinned = null;
  return () => {
    if (!['linux', 'darwin'].includes(platform)) return { error: 'unsupported' };
    let context;
    if (platform === 'linux') {
      try {
        const value = getLinuxContext?.();
        createLinuxBirthConverter(value);
        context = {
          bootId: value.bootId,
          bootTimeSeconds: value.bootTimeSeconds,
          clockTicks: value.clockTicks,
        };
        if (pinned && JSON.stringify(pinned) !== JSON.stringify(context)) throw new Error();
        pinned = context;
      } catch {
        return { error: 'identity-context-unavailable' };
      }
    }
    if (!binary || !exists(binary)) return { error: 'binary-missing' };
    try {
      const child = launch(binary, [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true,
      });
      return { child, context, error: null };
    } catch {
      return { error: 'launch-failed' };
    }
  };
}
module.exports = { createLauncher };
