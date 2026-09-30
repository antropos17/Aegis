import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../../', import.meta.url));
const names = ['ImportNative.cs', 'ImportCapture.cs', 'ImportSeal.cs', 'ImportFixture.cs'];
/**
 * Hash fixture/provenance bytes independently of native report values.
 * @param {Uint8Array} bytes Exact observed bytes.
 * @returns {string} SHA-256 hex digest.
 * @since v0.17.0
 */
export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * Compile only the checked-in developer fixture; never compile project inputs.
 * @param {string} parent Exact disposable scratch directory.
 * @returns {object} Executable path and build provenance.
 * @since v0.17.0
 */
export function buildSealedImportFixture(parent = os.tmpdir()) {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('sealed-import-windows-x64-required');
  }
  const scratch = fs.mkdtempSync(path.join(fs.realpathSync(parent), 'aegis-sealed-build-'));
  const compiler = path.join(
    process.env.WINDIR || 'C:\\Windows',
    'Microsoft.NET',
    'Framework64',
    'v4.0.30319',
    'csc.exe',
  );
  const sources = names.map((name) => {
    const bytes = fs.readFileSync(path.join(project, 'tests/fixtures/sealed-import', name));
    const staged = path.join(scratch, name);
    fs.writeFileSync(staged, bytes, { flag: 'wx' });
    return { name, staged, sha256: digest(bytes) };
  });
  const executable = path.join(scratch, 'sealed-import-fixture.exe');
  const compilerSha256 = digest(fs.readFileSync(compiler));
  const args = [
    '/nologo',
    '/target:exe',
    '/platform:x64',
    '/optimize+',
    '/warnaserror+',
    '/reference:System.Web.Extensions.dll',
    '/define:SEALED_IMPORT_TEST',
    `/out:${executable}`,
    ...sources.map((row) => row.staged),
  ];
  const result = spawnSync(compiler, args, {
    cwd: project,
    timeout: 30000,
    maxBuffer: 65536,
    windowsHide: true,
    encoding: 'utf8',
    env: { ...process.env, TEMP: parent, TMP: parent },
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `sealed-import-compile-failed: ${result.stdout || result.stderr || result.error}`,
    );
  }
  if (
    digest(fs.readFileSync(compiler)) !== compilerSha256 ||
    sources.some((row) => digest(fs.readFileSync(row.staged)) !== row.sha256)
  ) {
    throw new Error('sealed-import-build-provenance-changed');
  }
  return {
    scratch,
    executable,
    provenance: {
      command: 'csc /target:exe /platform:x64 /warnaserror+ /define:SEALED_IMPORT_TEST',
      exitCode: result.status,
      compilerSha256,
      executableSha256: digest(fs.readFileSync(executable)),
      sources: sources.map(({ name, sha256 }) => ({ name, sha256 })),
      nodeVersion: process.version,
      architecture: process.arch,
      osRelease: os.release(),
    },
  };
}
