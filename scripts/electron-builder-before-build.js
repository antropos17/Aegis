/**
 * @file scripts/electron-builder-before-build.js
 * @description electron-builder `beforeBuild` hook — builds the production
 *   renderer for every target and the native helpers for Windows.
 *
 *   Wired here rather than as a step in the release workflow so that BOTH paths get
 *   it: `npm run dist` on a developer machine and `npx electron-builder --win` in
 *   `.github/workflows/release-build.yml`. Two mechanisms would drift; a missing
 *   binary in a shipped installer is invisible at run time, because the app falls
 *   back to the CIM observation and keeps working — slowly, and silently.
 *
 *   A build failure here fails the packaging run. That is deliberate: an installer
 *   without the sidecar is not the artefact anyone asked for.
 */
'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

/** Build fresh runtime artifacts before packaging; propagate any build failure.
 * @param {{platform?: {name?: string}}} context electron-builder target context.
 * @returns {boolean} Continue electron-builder's dependency step after success.
 * @since 0.18.0
 */
module.exports = function beforeBuild(context) {
  const projectRoot = path.resolve(__dirname, '..');
  const viteCli = path.join(path.dirname(require.resolve('vite/package.json')), 'bin/vite.js');
  console.log('[before-build] building the production desktop renderer');
  execFileSync(
    process.execPath,
    [
      viteCli,
      'build',
      '--config',
      path.join(projectRoot, 'vite.frontend.config.ts'),
      '--mode',
      'production',
    ],
    { cwd: projectRoot, env: { ...process.env, NODE_ENV: 'production' }, stdio: 'inherit' },
  );
  const target = context && context.platform && context.platform.name;
  if (target !== 'windows') {
    console.log(`[before-build] target "${target}" needs no sidecar — skipping`);
    return true;
  }
  console.log('[before-build] building the process-snapshot and resource-counter helpers');
  execFileSync(process.execPath, [path.join(__dirname, 'build-sidecar.js')], {
    cwd: projectRoot,
    stdio: 'inherit',
  });
  return true;
};
