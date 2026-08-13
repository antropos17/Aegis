/**
 * @file scripts/electron-builder-before-build.js
 * @description electron-builder `beforeBuild` hook — compiles the process-snapshot
 *   sidecar so it exists before the Windows target is packed.
 *
 *   Wired here rather than as a step in the release workflow so that BOTH paths get
 *   it: `npm run dist` on a developer machine and `npx electron-builder --win` in
 *   `.github/workflows/release-build.yml`. Two mechanisms would drift; a missing
 *   binary in a shipped installer is invisible at run time, because the app falls
 *   back to the CIM observation and keeps working — slowly, and silently.
 *
 *   A build failure here fails the packaging run. That is deliberate: an installer
 *   without the sidecar is not the artefact anyone asked for.
 * @returns {boolean} true — carry on with electron-builder's own dependency step.
 */
'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

module.exports = function beforeBuild(context) {
  const target = context && context.platform && context.platform.name;
  if (target !== 'windows') {
    console.log(`[before-build] target "${target}" needs no sidecar — skipping`);
    return true;
  }
  console.log('[before-build] building the process-snapshot sidecar');
  execFileSync(process.execPath, [path.join(__dirname, 'build-sidecar.js')], { stdio: 'inherit' });
  return true;
};
