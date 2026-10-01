import { expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildSealedImportFixture } from '../../../scripts/qualification/sealed-import-build.mjs';
import { validateSealedImportReport } from '../../../scripts/qualification/sealed-import-report.mjs';

/**
 * Own one bounded compilation and disposable native test receipt set.
 * @returns {object} Fixed setup, corpus, invocation, refusal and receipt helpers.
 * @since v0.17.0
 */
export function createSealedImportHarness() {
  const scratch = process.env.AEGIS_SEALED_IMPORT_TEST_TMP || os.tmpdir();
  const receipts = [];
  const corpora = new Set();
  let build;
  function setup() {
    fs.mkdirSync(scratch, { recursive: true });
    build = buildSealedImportFixture(scratch);
    corpora.add(path.resolve(build.scratch));
  }
  function corpus(name) {
    const root = fs.mkdtempSync(path.join(scratch, `aegis-sealed-${name}-`));
    corpora.add(path.resolve(root));
    const source = path.join(root, 'source');
    const output = path.join(root, 'output');
    fs.mkdirSync(source);
    fs.writeFileSync(path.join(source, 'readme.txt'), 'DISPOSABLE_CLEAN_CORPUS\n');
    return { root, source, output };
  }
  function run(fixture, seam = 'none') {
    const result = spawnSync(build.executable, [fixture.source, fixture.output, seam], {
      cwd: build.scratch,
      timeout: 30000,
      maxBuffer: 65536,
      windowsHide: true,
      encoding: 'utf8',
      env: { ...process.env, TEMP: scratch, TMP: scratch },
    });
    if (result.error) throw result.error;
    const report = validateSealedImportReport(result.stdout);
    receipts.push({
      scenario: path.basename(fixture.root).replace(/-[^-]+$/, ''),
      seam,
      exitCode: result.status,
      report,
    });
    expect(result.stderr).toBe('');
    expect(JSON.stringify(report)).not.toContain(fixture.root);
    expect(JSON.stringify(report)).not.toContain('DISPOSABLE_');
    return { ...result, report };
  }
  function rejected(fixture, seam, code) {
    const result = run(fixture, seam);
    expect(result.status).toBe(2);
    expect(result.report).toMatchObject({ sealed: false, code });
    expect(fs.existsSync(path.join(fixture.output, 'bundle.aegis'))).toBe(false);
    return result;
  }
  function writeReceipt() {
    const destination = process.env.AEGIS_SEALED_IMPORT_TEST_RECEIPT;
    if (!destination || !build) return;
    const sourceFiles = [
      'tests/main/sealed-import-windows.test.js',
      'tests/main/sealed-import-contract.test.js',
      'tests/fixtures/sealed-import/harness.mjs',
      'scripts/qualification/qualify-sealed-import.mjs',
      'scripts/qualification/sealed-import-build.mjs',
      'scripts/qualification/sealed-import-oracle.mjs',
      'scripts/qualification/sealed-import-report.mjs',
    ];
    const project = path.resolve(import.meta.dirname, '../../..');
    const receipt = {
      schemaVersion: 1,
      checkedAt: new Date().toISOString(),
      provenance: build.provenance,
      nativeCases: receipts,
      launchAllowed: false,
      developerOnly: true,
      testSources: sourceFiles.map((name) => ({
        name,
        sha256: createHash('sha256')
          .update(fs.readFileSync(path.join(project, name)))
          .digest('hex'),
      })),
    };
    const bytes = Buffer.from(JSON.stringify(receipt, null, 2) + '\n');
    expect(bytes.length).toBeLessThanOrEqual(131072);
    const fd = fs.openSync(destination, 'wx');
    try {
      fs.writeFileSync(fd, bytes);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  }
  async function removeOwned(entry, root) {
    if (path.dirname(root) !== path.resolve(scratch)) {
      throw new Error('Disposable corpus must be a direct child of the test scratch directory');
    }
    if (entry !== root && !entry.startsWith(root + path.sep)) {
      throw new Error('Disposable corpus cleanup escaped its owned root');
    }
    try {
      const stat = await fs.promises.lstat(entry);
      if (stat.isSymbolicLink()) return;
      if (stat.isDirectory()) {
        for (const name of await fs.promises.readdir(entry)) {
          await removeOwned(path.join(entry, name), root);
        }
        await fs.promises.rmdir(entry);
      } else {
        await fs.promises.unlink(entry);
      }
    } catch (error) {
      if (!['ENOENT', 'ENOTEMPTY', 'EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error;
    }
  }
  async function finish() {
    try {
      writeReceipt();
    } finally {
      for (const root of corpora) {
        await removeOwned(root, root);
      }
      corpora.clear();
    }
  }
  return { setup, corpus, run, rejected, finish };
}
