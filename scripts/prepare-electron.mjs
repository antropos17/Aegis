import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

/** Prepare the installed Electron runtime once, before Vitest starts any workers.
 * @param {{config: {root: string}}} project Vitest root project.
 * @returns {void} Throws before test execution if installation or validation fails.
 * @since 0.19.2
 */
export default function prepareElectron(project) {
  const root = project.config.root;
  const require = createRequire(path.join(root, 'package.json'));
  try {
    const packageFile = require.resolve('electron/package.json');
    const directory = path.dirname(packageFile);
    const { version } = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
    console.log('[test-setup] Preparing Electron before test workers');
    // Use Electron's own idempotent installer and its cache/mirror/checksum policy.
    // Never import its entrypoint here: that fallback download has no deadline.
    execFileSync(process.execPath, [path.join(directory, 'install.js')], {
      cwd: root,
      stdio: 'inherit',
      windowsHide: true,
      timeout: 240000,
    });
    const installed = fs
      .readFileSync(path.join(directory, 'dist/version'), 'utf8')
      .trim()
      .replace(/^v/, '');
    const binary = fs.readFileSync(path.join(directory, 'path.txt'), 'utf8').trim();
    const distribution = process.env.ELECTRON_OVERRIDE_DIST_PATH || path.join(directory, 'dist');
    if (installed !== version || !fs.statSync(path.join(distribution, binary)).isFile()) {
      throw new Error('Electron installer did not prepare the matching binary');
    }
    console.log(`[test-setup] Electron ${version} ready`);
  } catch (cause) {
    throw new Error('Electron preparation failed before test workers started', { cause });
  }
}
