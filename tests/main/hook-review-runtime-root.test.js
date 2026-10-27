import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { selectRuntimeRoot } = require('../../scripts/hook-review-runtime-root.cjs');

describe('hook-review SDK selection', () => {
  it('uses the release job installation instead of a different Program Files installation', () => {
    const selected = path.resolve('runner-temp', 'aegis-dotnet-10.0.403');
    const programFiles = path.resolve('other-program-files');
    expect(
      selectRuntimeRoot(undefined, {
        DOTNET_INSTALL_DIR: selected,
        DOTNET_ROOT: selected,
        ProgramFiles: programFiles,
      }),
    ).toBe(selected);
  });

  it('uses explicit, then install directory, then DOTNET_ROOT before Program Files', () => {
    const explicit = path.resolve('explicit');
    const install = path.resolve('install');
    const root = path.resolve('root');
    const programFiles = path.resolve('program-files');
    const env = { DOTNET_INSTALL_DIR: install, DOTNET_ROOT: root, ProgramFiles: programFiles };
    expect(selectRuntimeRoot(explicit, env)).toBe(explicit);
    expect(selectRuntimeRoot(undefined, env)).toBe(install);
    expect(selectRuntimeRoot(undefined, { DOTNET_ROOT: root, ProgramFiles: programFiles })).toBe(
      root,
    );
    expect(selectRuntimeRoot(undefined, { ProgramFiles: programFiles })).toBe(
      path.join(programFiles, 'dotnet'),
    );
  });

  it('rejects an invalid configured root instead of falling back', () => {
    expect(() =>
      selectRuntimeRoot(undefined, {
        DOTNET_INSTALL_DIR: 'relative-directory',
        DOTNET_ROOT: path.resolve('valid'),
      }),
    ).toThrow('must be absolute');
  });
});
