import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

/** Locate the requested installed package, including npm aliases with a different metadata name.
 * Containment and link refusal remain the staging caller's responsibility.
 * @param {string} request Dependency key. @param {string} owner Owning package directory.
 * @returns {string} Resolved package directory. @since v0.23.0-beta */
export function resolveCloudPackageRoot(request, owner) {
  assert(/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/i.test(request), 'Invalid dependency key');
  const require = createRequire(path.join(owner, 'package.json'));
  try {
    const manifest = require.resolve(request + '/package.json');
    assert(path.basename(manifest) === 'package.json', 'Canonical package metadata required');
    return path.dirname(manifest);
  } catch (error) {
    if (error.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED' && error.code !== 'MODULE_NOT_FOUND')
      throw error;
  }
  const entry = require.resolve(request);
  const candidates = (require.resolve.paths(request) ?? []).map((base) => path.join(base, request));
  for (
    let folder = path.dirname(entry);
    folder !== path.dirname(folder);
    folder = path.dirname(folder)
  ) {
    const metadata = path.join(folder, 'package.json');
    if (!fs.existsSync(metadata)) continue;
    if (
      candidates.some(
        (candidate) =>
          fs.existsSync(candidate) && path.relative(fs.realpathSync(candidate), folder) === '',
      )
    )
      return folder;
  }
  throw Error('Package root unavailable');
}
