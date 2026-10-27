import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const windowsX64 = process.platform === 'win32' && process.arch === 'x64';
let output;
let executable;
let temporaryRoot;

describe.skipIf(!windowsX64)('native process snapshot structural integrity', () => {
  beforeAll(() => {
    temporaryRoot = fs.realpathSync(os.tmpdir());
    output = fs.mkdtempSync(path.join(temporaryRoot, 'aegis-procsnap-structure-'));
    executable = path.join(output, 'snapshot-controls.exe');
    const compiler = path.join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
    execFileSync(
      compiler,
      [
        '/nologo',
        '/optimize+',
        '/platform:x64',
        '/main:SnapshotStructureControls',
        '/out:' + executable,
        ...['Program.cs', 'NtSnapshot.cs', 'Json.cs'].map((name) =>
          path.join(root, 'sidecar/procsnap', name),
        ),
        path.join(root, 'tests/fixtures/procsnap/SnapshotStructureControls.cs'),
      ],
      { timeout: 15000, maxBuffer: 16384, windowsHide: true },
    );
  }, 20000);

  afterAll(() => {
    if (!output || !fs.existsSync(output)) return;
    const resolved = fs.realpathSync(output);
    if (
      resolved !== output ||
      path.dirname(resolved) !== temporaryRoot ||
      !path.basename(resolved).startsWith('aegis-procsnap-structure-') ||
      fs.lstatSync(output).isSymbolicLink()
    )
      throw new Error('snapshot-control-cleanup-boundary');
    fs.rmSync(resolved, { recursive: true, force: true });
  });

  function control(name) {
    const result = execFileSync(executable, [name], {
      encoding: 'utf8',
      timeout: 10000,
      maxBuffer: 4096,
      windowsHide: true,
    });
    expect(JSON.parse(result)).toEqual({ case: name, passed: true });
  }

  it.each([
    'empty-return',
    'short-first',
    'truncated-later',
    'oversized-next',
    'negative-next',
    'overlapping-next',
    'chain-limit',
  ])('rejects malformed %s without publishing a partial native population', control);

  it.each(['exact-births', 'unknown-birth', 'terminal-row', 'chain-boundary'])(
    'preserves valid %s output',
    control,
  );

  it('matches the current host process full birth against independent GetProcessTimes', () => {
    control('live-self');
  });
});
