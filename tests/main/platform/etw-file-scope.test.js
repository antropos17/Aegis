import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import scope from '../../../src/main/platform/etw-file-scope.js';

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
describe.skipIf(process.platform !== 'win32')('ordinary folder launch scope', () => {
  it('accepts an existing folder and refuses files, missing paths and whole drives', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-etw-scope-'));
    roots.push(root);
    const file = path.join(root, 'file');
    fs.writeFileSync(file, 'fixture');
    expect(scope.checkRoot(root)).toBe(true);
    expect(scope.checkRoot(root + path.sep)).toBe(true);
    for (const target of [file, path.join(root, 'missing'), path.parse(root).root])
      expect(scope.checkRoot(target)).toBe(false);
  });
  it('refuses a junction root and an ordinary child reached through that alias', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-etw-scope-'));
    roots.push(root);
    const target = path.join(root, 'target'),
      alias = path.join(root, 'alias');
    fs.mkdirSync(path.join(target, 'child'), { recursive: true });
    fs.symlinkSync(target, alias, 'junction');
    expect(scope.checkRoot(alias)).toBe(false);
    expect(scope.checkRoot(path.join(alias, 'child'))).toBe(false);
    expect(scope.checkRoot(path.join(target, 'child'))).toBe(true);
  });
});
