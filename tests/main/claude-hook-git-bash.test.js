import { expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { profileCommand, profileAfterCommand } = require('../../src/main/claude-hook-app-profile');
let gitBash;
if (process.platform === 'win32') {
  try {
    const git = execFileSync('where.exe', ['git.exe'], { encoding: 'utf8' }).split(/\r?\n/)[0];
    const candidate = path.resolve(path.dirname(git), '..', 'bin', 'bash.exe');
    if (existsSync(candidate)) gitBash = candidate;
  } catch {
    // This optional native regression only applies when Git Bash is available.
  }
}

it.skipIf(!gitBash)(
  'Git Bash discards only after-hook stdout and propagates stderr and exit status',
  () => {
    const parent = realpathSync(tmpdir());
    const directory = mkdtempSync(path.join(parent, 'aegis-after-stdout-'));
    if (!path.resolve(directory).startsWith(parent + path.sep)) throw Error('fixture-outside-temp');
    try {
      const stub = path.join(directory, 'stub.js');
      const policy = path.join(directory, 'policy.json');
      writeFileSync(
        stub,
        "process.stdout.write('private stdout'); process.stderr.write('stderr sentinel'); process.exitCode = 23;\n",
      );
      const after = profileAfterCommand(process.execPath, stub, policy);
      const pre = profileCommand(process.execPath, stub, policy);
      expect(pre).toBe(
        `"${process.execPath.replaceAll('\\', '/')}" "${stub.replaceAll('\\', '/')}" --action-policy-hook "${policy.replaceAll('\\', '/')}"`,
      );
      expect(after).toBe(
        `"${process.execPath.replaceAll('\\', '/')}" "${stub.replaceAll('\\', '/')}" --action-policy-after-hook "${policy.replaceAll('\\', '/')}" > /dev/null`,
      );
      const output = spawnSync(gitBash, ['-c', after], { encoding: 'utf8', windowsHide: true });
      expect(output.error).toBeUndefined();
      expect(output.status).toBe(23);
      expect(output.stdout).toBe('');
      expect(output.stderr).toBe('stderr sentinel');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
