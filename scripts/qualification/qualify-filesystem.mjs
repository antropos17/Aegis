import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarizeFilesystemReport } from './filesystem-report.mjs';

const project = fileURLToPath(new URL('../../', import.meta.url));
const source = path.join(project, 'tests/fixtures/filesystem-accesscheck-probe.cs');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sha256 = (file) => digest(fs.readFileSync(file));

/**
 * Compile/run an unassigned-token, in-memory probe without host provisioning.
 * @returns {object} Diagnostic provenance and a strictly non-authorizing summary.
 * @since v0.17.0
 */
export function collectFilesystemQualification() {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('filesystem-qualification-windows-x64-required');
  }
  const compiler = path.join(
    process.env.WINDIR || 'C:\\Windows',
    'Microsoft.NET/Framework64/v4.0.30319/csc.exe',
  );
  const parent = fs.realpathSync(os.tmpdir());
  const scratch = fs.mkdtempSync(path.join(parent, 'aegis-filesystem-probe-'));
  const executable = path.join(scratch, 'probe.exe');
  const stagedSource = path.join(scratch, 'probe.cs');
  let receipt;
  let failure;
  try {
    const sourceBytes = fs.readFileSync(source);
    const compilerHash = sha256(compiler);
    fs.writeFileSync(stagedSource, sourceBytes, { flag: 'wx' });
    execFileSync(
      compiler,
      [
        '/nologo',
        '/target:exe',
        '/platform:x64',
        '/optimize+',
        '/warnaserror+',
        `/out:${executable}`,
        stagedSource,
      ],
      { cwd: project, timeout: 30000, maxBuffer: 16384, windowsHide: true, stdio: 'pipe' },
    );
    const executableHash = sha256(executable);
    const output = execFileSync(executable, [], {
      cwd: scratch,
      timeout: 10000,
      maxBuffer: 16384,
      windowsHide: true,
      encoding: 'utf8',
    });
    if (
      sha256(compiler) !== compilerHash ||
      sha256(executable) !== executableHash ||
      sha256(stagedSource) !== digest(sourceBytes)
    ) {
      throw new Error('filesystem-qualification-provenance-changed');
    }
    const summary = summarizeFilesystemReport(output);
    receipt = {
      schemaVersion: 1,
      checkedAt: new Date().toISOString(),
      sourceSha256: digest(sourceBytes),
      compilerSha256: compilerHash,
      executableSha256: executableHash,
      probe: JSON.parse(output),
      summary,
    };
  } catch (error) {
    failure = error;
  }
  try {
    if (path.dirname(scratch) !== parent || fs.lstatSync(scratch).isSymbolicLink()) {
      throw new Error('filesystem-qualification-cleanup-unsafe');
    }
    for (const file of [executable, stagedSource]) {
      if (fs.existsSync(file)) {
        if (fs.lstatSync(file).isSymbolicLink())
          throw new Error('filesystem-qualification-cleanup-unsafe');
        fs.unlinkSync(file);
      }
    }
    fs.rmdirSync(scratch);
  } catch (error) {
    failure ??= error;
  }
  if (failure) throw failure;
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== '--receipt') {
      throw new Error('filesystem-qualification-receipt-required');
    }
    const selected = process.argv[3];
    if (!path.isAbsolute(selected) || path.extname(selected) !== '.json') {
      throw new Error('filesystem-qualification-receipt-invalid');
    }
    if (fs.existsSync(selected)) throw new Error('filesystem-qualification-receipt-exists');
    const receipt = collectFilesystemQualification();
    fs.writeFileSync(selected, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
    process.stdout.write(JSON.stringify(receipt.summary) + '\n');
  } catch {
    process.stderr.write('filesystem-qualification-unavailable\n');
    process.exitCode = 2;
  }
}
