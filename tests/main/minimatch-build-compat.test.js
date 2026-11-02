import { afterEach, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const roots = [];
const consumer = (name) => createRequire(require.resolve(name));
const fixture = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-minimatch-'));
  roots.push(root);
  return root;
};
const write = (root, file, value = file) => {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, value);
  return target;
};

afterEach(() => {
  for (const root of roots.splice(0)) {
    expect(path.dirname(root)).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(root)).toMatch(/^aegis-minimatch-/);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

it.each([
  'eslint',
  '@eslint/config-array',
  '@typescript-eslint/typescript-estree',
  'app-builder-lib',
  '@electron/universal',
])('%s resolves the patched modern matcher', (name) => {
  const selected = consumer(name);
  const adapter = createRequire(selected.resolve('minimatch'));
  expect(adapter('minimatch-engine/package.json').version).toBe('11.0.3');
  const { minimatch, Minimatch } = selected('minimatch');
  expect(minimatch('src/main.js', '**/*.js')).toBe(true);
  expect(minimatch('src/private.txt', '**/*.js')).toBe(false);
  expect(new Minimatch('**/*.js', { dot: true }).match('.cache/main.js')).toBe(true);
});

it.each(['@electron/asar', 'dir-compare', 'filelist', 'glob'])(
  '%s retains its callable API using only the patched engine',
  (name) => {
    const selected = consumer(name);
    const matcher = selected('minimatch');
    expect(typeof matcher).toBe('function');
    const adapter = createRequire(selected.resolve('minimatch'));
    expect(adapter('minimatch-engine/package.json').version).toBe('11.0.3');
    expect(matcher('main.js', '*.js')).toBe(true);
    expect(matcher('main.txt', '*.js')).toBe(false);
    expect(matcher.match(['main.js', 'private.txt'], '*.js')).toEqual(['main.js']);
    expect(matcher.defaults({ dot: true })('.hidden.js', '*.js')).toBe(true);
    const parsed = new matcher.Minimatch('**/*.js', { dot: true });
    expect(parsed.match('src/main.js')).toBe(true);
    expect(parsed.match('src/private.txt')).toBe(false);
  },
);

it('preserves actual electron-builder inclusion and exclusion filters', () => {
  const { FileMatcher } = require('app-builder-lib/out/fileMatcher');
  const root = fixture();
  const filter = new FileMatcher(root, root, (value) => value, [
    '**/*',
    '!**/*.pdb',
    '!private/**',
  ]).createFilter();
  for (const [file, included] of [
    ['src/main.js', true],
    ['.hidden.json', true],
    ['native/helper.pdb', false],
    ['private/token.txt', false],
  ]) {
    const target = write(root, file);
    expect(filter(target, fs.statSync(target)), file).toBe(included);
  }
});

it('preserves legacy glob and filelist traversal and exclusions', () => {
  const root = fixture();
  write(root, 'public.txt');
  write(root, 'nested/also.txt');
  write(root, 'private.txt');
  write(root, 'unrelated.bin');
  const results = require('glob').sync('**/*.txt', {
    cwd: root,
    nodir: true,
    ignore: '**/private*',
  });
  expect(results.sort()).toEqual(['nested/also.txt', 'public.txt']);
  const { FileList } = require('filelist');
  const list = new FileList(path.join(root, '**/*.txt').replaceAll('\\', '/'), {
    allowWindowsEscape: false,
  });
  list.exclude(path.join(root, 'private.txt').replaceAll('\\', '/'));
  expect(
    list
      .toArray()
      .map((file) => path.relative(root, file).replaceAll('\\', '/'))
      .sort(),
  ).toEqual(['nested/also.txt', 'public.txt']);
});

it('compares directories with include/exclude patterns through dir-compare', () => {
  const root = fixture();
  const left = path.join(root, 'left');
  const right = path.join(root, 'right');
  write(left, 'public.txt', 'same');
  write(right, 'public.txt', 'same');
  write(left, 'private.txt', 'left secret');
  write(right, 'private.txt', 'different secret');
  const result = require('dir-compare').compareSync(left, right, {
    compareContent: true,
    includeFilter: '*.txt',
    excludeFilter: 'private*',
  });
  expect(result.same).toBe(true);
  expect(result.equalFiles).toBe(1);
});

it('creates a real ASAR with exact packed bytes, excluded files and an unpacked native fixture', async () => {
  const root = fixture();
  const app = path.join(root, 'app');
  write(app, 'src/main.js', 'module.exports = 42;');
  write(app, '.hidden.json', '{}');
  write(app, 'native/helper.node', 'inert native fixture');
  write(app, 'private.secret', 'PRIVATE_CANARY');
  const asar = require('@electron/asar');
  const archive = path.join(root, 'app.asar');
  await asar.createPackageWithOptions(app, archive, {
    unpack: '**/*.node',
    globOptions: { ignore: ['**/*.secret'] },
  });
  expect(
    asar
      .listPackage(archive)
      .map((file) => file.replaceAll('\\', '/'))
      .sort(),
  ).toEqual(['/.hidden.json', '/native', '/native/helper.node', '/src', '/src/main.js']);
  expect(asar.extractFile(archive, 'src/main.js').toString()).toBe('module.exports = 42;');
  expect(asar.statFile(archive, 'native/helper.node').unpacked).toBe(true);
  expect(fs.readFileSync(path.join(root, 'app.asar.unpacked/native/helper.node'), 'utf8')).toBe(
    'inert native fixture',
  );
  asar.uncache(archive);
});

it('bounds the advisory-shaped level-2 glob preprocessing in a disposable child', () => {
  const result = spawnSync(
    process.execPath,
    [
      '-e',
      `
    const {Minimatch} = require('minimatch');
    const matcher = new Minimatch('segment/**/../'.repeat(12) + 'target.txt', {optimizationLevel: 2});
    process.stdout.write(JSON.stringify({matched: matcher.match('unrelated.bin')}));
  `,
    ],
    { encoding: 'utf8', timeout: 3000, maxBuffer: 4096, windowsHide: true },
  );
  expect(result.status, result.stderr || result.error?.message).toBe(0);
  const output = JSON.parse(result.stdout);
  expect(output.matched).toBe(false);
});

it('preserves native ES module named imports', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import {minimatch, Minimatch} from 'minimatch';
    process.stdout.write(JSON.stringify([minimatch('main.js', '*.js'), new Minimatch('*.js').match('private.txt')]));
  `,
    ],
    { encoding: 'utf8', timeout: 3000, maxBuffer: 4096, windowsHide: true },
  );
  expect(result.status, result.stderr || result.error?.message).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual([true, false]);
});

it('retains no older matcher implementation in the lockfile', () => {
  const lock = JSON.parse(
    fs.readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8'),
  );
  const semver = require('semver');
  const matchers = Object.entries(lock.packages).filter(
    ([key, value]) => key.endsWith('/minimatch') || value.name === 'minimatch',
  );
  expect(matchers.length).toBeGreaterThan(0);
  for (const [key, value] of matchers) {
    if (!value.link) expect(semver.gte(value.version, '11.0.1'), key).toBe(true);
  }
});
