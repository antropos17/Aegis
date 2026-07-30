/**
 * @file tsconfig-projects.test.js
 * @description Guards the TypeScript project layout.
 *
 *   The failure being pinned here is SILENT. `exclude` filters whatever `include`
 *   picks up, and an extending config inherits the base `exclude` while overriding
 *   only `include`. So a base `exclude` of `src/renderer/**` cancels
 *   tsconfig.renderer.json's own `include` entirely: `tsc -p tsconfig.renderer.json`
 *   exits 0 having type-checked NONE of the renderer, and every script and CI job
 *   built on it reports success. Nothing in the output says the file set was empty.
 *
 *   Second pinned failure: a `module` / `moduleResolution` default in the shared
 *   base. The renderer is ESM and uses `import.meta`; the main process is CommonJS.
 *   A CJS default leaking from the base into renderer files raises TS1470
 *   ("'import.meta' is not allowed in files which will build into CommonJS output")
 *   on correct code, so each project must declare its own module system.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const BASE = 'tsconfig.base.json';
const PROJECTS = ['tsconfig.main.json', 'tsconfig.renderer.json'];

/**
 * @param {string} name - Repo-relative config file name.
 * @returns {Object} Parsed config.
 */
function readConfig(name) {
  return JSON.parse(readFileSync(path.join(ROOT, name), 'utf-8'));
}

/**
 * Leading non-glob path of a pattern: `src/renderer/**\/*` → `src/renderer`.
 * Comparing these roots is what makes an exclude-swallows-include check possible
 * without a full glob engine.
 * @param {string} pattern
 * @returns {string}
 */
function globRoot(pattern) {
  return pattern
    .replace(/\\/g, '/')
    .split('/')
    .filter((seg) => seg.length > 0 && !seg.includes('*'))
    .join('/');
}

describe('tsconfig project layout', () => {
  it('root tsconfig.json is a solution file that owns no sources', () => {
    const root = readConfig('tsconfig.json');
    // `files: []` (legal only alongside `references`) keeps a bare `npx tsc` from
    // sweeping the whole repo under one module system — the original TS1470 cause.
    expect(root.files).toEqual([]);
    expect(root.include).toBeUndefined();
    expect(root.compilerOptions).toBeUndefined();
  });

  it('root references every project, so `tsc -b` covers the whole repo', () => {
    const root = readConfig('tsconfig.json');
    const referenced = (root.references || []).map((r) => r.path.replace('./', ''));
    expect(new Set(referenced)).toEqual(new Set(PROJECTS));
  });

  it.each(PROJECTS)('%s extends the base, not the solution root', (project) => {
    // Extending the solution root would inherit `files: []` and `references`,
    // which re-breaks the file set and makes the project reference itself.
    expect(readConfig(project).extends).toBe(`./${BASE}`);
  });

  it('the shared base pins no module system', () => {
    const base = readConfig(BASE);
    expect(base.compilerOptions.module).toBeUndefined();
    expect(base.compilerOptions.moduleResolution).toBeUndefined();
  });

  it.each(PROJECTS)('%s declares its own module system', (project) => {
    const { compilerOptions } = readConfig(project);
    expect(compilerOptions.module).toBeTruthy();
    expect(compilerOptions.moduleResolution).toBeTruthy();
  });

  it.each(PROJECTS)('no inherited exclude swallows %s own include', (project) => {
    const excludeRoots = (readConfig(BASE).exclude || []).map(globRoot);
    const includeRoots = (readConfig(project).include || []).map(globRoot);

    expect(includeRoots.length).toBeGreaterThan(0);

    for (const inc of includeRoots) {
      for (const exc of excludeRoots) {
        const swallowed = inc === exc || inc.startsWith(`${exc}/`);
        expect(
          swallowed,
          `${project} includes "${inc}" but ${BASE} excludes "${exc}" — ` +
            'the project would type-check zero files and still exit 0',
        ).toBe(false);
      }
    }
  });

  it.each(PROJECTS)('%s keeps noEmit on via the base', (project) => {
    // These are check-only projects; an accidental emit would write .js next to
    // sources and be picked up by the Vite build.
    const effective = {
      ...readConfig(BASE).compilerOptions,
      ...readConfig(project).compilerOptions,
    };
    expect(effective.noEmit).toBe(true);
  });
});
