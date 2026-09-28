import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarizeVmReport } from './vm-report.mjs';
import { GUID } from './vm-contract.mjs';

const project = fileURLToPath(new URL('../../', import.meta.url));
const source = path.join(project, 'tests/fixtures/vm-inspection-probe.cs');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sha256 = (file) => digest(fs.readFileSync(file));

/**
 * Compile/run a fixed read-only WMI subset probe without host provisioning.
 * @param {string|null} vmId Optional canonical exact selector.
 * @returns {object} Diagnostic provenance and a strictly non-authorizing summary.
 * @since v0.17.0
 */
export function collectVmInspection(vmId = null) {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('vm-inspection-windows-x64-required');
  }
  if (vmId !== null && (typeof vmId !== 'string' || !GUID.test(vmId)))
    throw new Error('vm-inspection-selector-invalid');
  const compiler = path.join(
    process.env.WINDIR || 'C:\\Windows',
    'Microsoft.NET/Framework64/v4.0.30319/csc.exe',
  );
  const parent = fs.realpathSync(os.tmpdir());
  const scratch = fs.mkdtempSync(path.join(parent, 'aegis-vm-inspection-'));
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
        '/r:System.Management.dll',
        `/out:${executable}`,
        stagedSource,
      ],
      { cwd: project, timeout: 30000, maxBuffer: 16384, windowsHide: true, stdio: 'pipe' },
    );
    const executableHash = sha256(executable);
    const output = execFileSync(executable, vmId === null ? [] : [vmId], {
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
      throw new Error('vm-inspection-provenance-changed');
    }
    const summary = summarizeVmReport(output, vmId !== null);
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
      throw new Error('vm-inspection-cleanup-unsafe');
    }
    for (const file of [executable, stagedSource]) {
      if (fs.existsSync(file)) {
        if (fs.lstatSync(file).isSymbolicLink()) throw new Error('vm-inspection-cleanup-unsafe');
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
    if (![4, 6].includes(process.argv.length) || process.argv[2] !== '--receipt') {
      throw new Error('vm-inspection-receipt-required');
    }
    const selected = process.argv[3];
    if (!path.isAbsolute(selected) || path.extname(selected) !== '.json') {
      throw new Error('vm-inspection-receipt-invalid');
    }
    if (fs.existsSync(selected)) throw new Error('vm-inspection-receipt-exists');
    if (process.argv.length === 6 && process.argv[4] !== '--vm-id')
      throw new Error('vm-inspection-selector-invalid');
    const receipt = collectVmInspection(process.argv.length === 6 ? process.argv[5] : null);
    fs.writeFileSync(selected, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
    process.stdout.write(JSON.stringify(receipt.summary) + '\n');
  } catch {
    process.stderr.write('vm-inspection-unavailable\n');
    process.exitCode = 2;
  }
}
