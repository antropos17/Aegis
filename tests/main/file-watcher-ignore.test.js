import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { getIgnoredDirFilter, DEFAULT_IGNORED_DIRS } = require('../../src/main/file-watcher.js');

describe('getIgnoredDirFilter()', () => {
  describe('default config (ignoreCommonBuildDirs: true)', () => {
    const filter = getIgnoredDirFilter({ ignoreCommonBuildDirs: true });

    it('filters .git paths (Unix)', () => {
      expect(filter('/home/user/project/.git/config')).toBe(true);
    });

    it('filters .git paths (Windows)', () => {
      expect(filter('C:\\Users\\dev\\project\\.git\\config')).toBe(true);
    });

    it('filters node_modules paths (Unix)', () => {
      expect(filter('/home/user/project/node_modules/lodash/index.js')).toBe(true);
    });

    it('filters node_modules paths (Windows)', () => {
      expect(filter('C:\\Users\\dev\\project\\node_modules\\lodash\\index.js')).toBe(true);
    });

    it('filters __pycache__ paths', () => {
      expect(filter('/home/user/project/__pycache__/module.pyc')).toBe(true);
    });

    it('filters dist paths', () => {
      expect(filter('/home/user/project/dist/bundle.js')).toBe(true);
    });

    it('filters path ending with ignored dir', () => {
      expect(filter('/home/user/project/.git')).toBe(true);
      expect(filter('C:\\Users\\dev\\project\\.git')).toBe(true);
    });

    it('allows normal project files', () => {
      expect(filter('/home/user/project/src/main.js')).toBe(false);
    });

    it('allows files with similar names but not exact matches', () => {
      expect(filter('/home/user/project/src/node_modules_helper.js')).toBe(false);
    });
  });

  describe('toggle OFF (ignoreCommonBuildDirs: false)', () => {
    it('does not filter defaults when toggle is off', () => {
      const filter = getIgnoredDirFilter({ ignoreCommonBuildDirs: false });
      expect(filter('/home/user/project/.git/config')).toBe(false);
      expect(filter('/home/user/project/node_modules/lodash/index.js')).toBe(false);
    });

    it('still filters custom dirs when toggle is off', () => {
      const filter = getIgnoredDirFilter({
        ignoreCommonBuildDirs: false,
        ignoredDirectories: ['vendor'],
      });
      expect(filter('/home/user/project/vendor/lib.js')).toBe(true);
      expect(filter('/home/user/project/node_modules/lodash/index.js')).toBe(false);
    });
  });

  describe('custom ignored directories', () => {
    const filter = getIgnoredDirFilter({
      ignoreCommonBuildDirs: true,
      ignoredDirectories: ['vendor', '.output'],
    });

    it('filters custom directory', () => {
      expect(filter('/home/user/project/vendor/autoload.php')).toBe(true);
    });

    it('filters custom dotdir', () => {
      expect(filter('/home/user/project/.output/server/index.mjs')).toBe(true);
    });

    it('still filters defaults alongside custom', () => {
      expect(filter('/home/user/project/node_modules/pkg/index.js')).toBe(true);
    });
  });

  describe('no config / empty config', () => {
    it('uses defaults when config is undefined', () => {
      const filter = getIgnoredDirFilter(undefined);
      expect(filter('/home/user/project/.git/config')).toBe(true);
    });

    it('uses defaults when config is empty object', () => {
      const filter = getIgnoredDirFilter({});
      expect(filter('/home/user/project/node_modules/pkg/index.js')).toBe(true);
    });

    it('returns false for everything when both disabled and no custom', () => {
      const filter = getIgnoredDirFilter({
        ignoreCommonBuildDirs: false,
        ignoredDirectories: [],
      });
      expect(filter('/home/user/project/.git/config')).toBe(false);
    });
  });

  describe('DEFAULT_IGNORED_DIRS', () => {
    it('contains .git and node_modules', () => {
      expect(DEFAULT_IGNORED_DIRS).toContain('.git');
      expect(DEFAULT_IGNORED_DIRS).toContain('node_modules');
    });

    it('contains expected build dirs', () => {
      expect(DEFAULT_IGNORED_DIRS).toContain('dist');
      expect(DEFAULT_IGNORED_DIRS).toContain('build');
      expect(DEFAULT_IGNORED_DIRS).toContain('.next');
      expect(DEFAULT_IGNORED_DIRS).toContain('.cache');
    });
  });
});
