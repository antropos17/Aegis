import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { resolveCloudPackageRoot } from '../../tools/development/cloud-node-package.mjs';

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture(alias, metadata) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-cloud-package-'));
  roots.push(root);
  fs.writeFileSync(path.join(root, 'package.json'), '{}');
  const folder = path.join(root, 'node_modules', alias);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'package.json'), JSON.stringify(metadata));
  fs.writeFileSync(path.join(folder, 'index.cjs'), 'throw Error("Package code must not execute");');
  return { root, folder };
}
it('resolves the installed alias rather than requiring its package name to equal the dependency key', () => {
  const f = fixture('minimatch-engine', {
    name: 'minimatch',
    version: '11.0.3',
    main: 'index.cjs',
  });
  expect(resolveCloudPackageRoot('minimatch-engine', f.root)).toBe(f.folder);
});
it('locates an alias with an exports-restricted package.json without executing it', () => {
  const f = fixture('minimatch-engine', {
    name: 'minimatch',
    version: '11.0.3',
    exports: { '.': './index.cjs' },
  });
  expect(resolveCloudPackageRoot('minimatch-engine', f.root)).toBe(f.folder);
});
it('resolves a copied local compatibility package whose metadata uses its own scoped name', () => {
  const f = fixture('minimatch', {
    name: '@aegis/minimatch-compat',
    version: '11.0.3-aegis.1',
    main: 'index.cjs',
  });
  expect(resolveCloudPackageRoot('minimatch', f.root)).toBe(f.folder);
});
it.each(['../outside', '/absolute', 'node:fs', '@scope/../../outside'])(
  'refuses non-package dependency key %s',
  (name) => {
    expect(() => resolveCloudPackageRoot(name, process.cwd())).toThrow('Invalid dependency key');
  },
);
