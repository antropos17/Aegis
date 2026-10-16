import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Compile real native consumers and the ordinary-process admission fixture.
 * @param {string} project Repository checkout.
 * @returns {{root: string, parser: string, native: string, cleanup: () => void}}
 * @since 1.0.0
 */
export function createHarness(project) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-fixed-operation-'));
  const identity = fs.lstatSync(root);
  const cleanup = () => {
    if (!fs.existsSync(root)) return;
    const stat = fs.lstatSync(root);
    const localTree = (directory) =>
      fs.readdirSync(directory).every((name) => {
        const target = path.join(directory, name);
        const item = fs.lstatSync(target);
        return !item.isSymbolicLink() && (!item.isDirectory() || localTree(target));
      });
    if (
      /^aegis-fixed-operation-[^\\/]+$/.test(path.relative(os.tmpdir(), root)) &&
      !stat.isSymbolicLink() &&
      stat.dev === identity.dev &&
      stat.ino === identity.ino &&
      fs.realpathSync(root).toLowerCase() === path.resolve(root).toLowerCase() &&
      path.dirname(fs.realpathSync(root)).toLowerCase() ===
        fs.realpathSync(os.tmpdir()).toLowerCase() &&
      localTree(root)
    )
      fs.rmSync(root, { recursive: true, force: true });
  };
  try {
    const source = process.env.AEGIS_MAIN_NATIVE_SOURCE || project;
    const sources = ['session', 'owner'].flatMap((directory) =>
      fs
        .readdirSync(path.join(source, 'sidecar', directory))
        .filter((name) => name.endsWith('.cs') && name !== 'Program.cs')
        .sort()
        .map((name) => path.join(source, 'sidecar', directory, name)),
    );
    sources.push(
      path.join(source, 'sidecar/mcpjob/AppContainerExecutable.cs'),
      path.join(project, 'tests/fixtures/session-caller-composition/CompositionFiles.cs'),
      path.join(project, 'tests/fixtures/session-main-admission/MainFixtureTransport.cs'),
      ...['session-installed-completion', 'session-fixed-operation'].flatMap((directory) =>
        fs
          .readdirSync(path.join(project, 'tests/fixtures', directory))
          .filter((name) => name.endsWith('.cs'))
          .sort()
          .map((name) => path.join(project, 'tests/fixtures', directory, name)),
      ),
    );
    const parser = path.join(root, 'parser.exe');
    const native = path.join(root, 'fixed-fixture.exe');
    for (const [entry, executable] of [
      ['FixedOperationParser', parser],
      ['InstalledCompletionFixture', native],
    ]) {
      try {
        execFileSync(
          path.join(
            process.env.WINDIR || 'C:/Windows',
            'Microsoft.NET/Framework64/v4.0.30319/csc.exe',
          ),
          [
            '/nologo',
            '/target:exe',
            '/platform:x64',
            '/main:' + entry,
            '/define:ENROLLMENT_LEASE_TEST,CALLER_MAIN_OPERATION_TEST',
            '/reference:System.Management.dll',
            '/reference:System.Security.dll',
            '/optimize+',
            '/warnaserror+',
            '/out:' + executable,
            ...sources,
          ],
          { timeout: 30000, maxBuffer: 32768, windowsHide: true },
        );
      } catch (error) {
        throw new Error(String(error.stdout) + String(error.stderr), { cause: error });
      }
    }
    return {
      root,
      parser,
      native,
      cleanup,
    };
  } catch (error) {
    cleanup();
    throw error;
  }
}

/**
 * Invoke a bounded native consumer or an unprivileged PowerShell producer.
 * @param {string} executable Original executable path.
 * @param {string[]} args Exact argument vector.
 * @returns {unknown} Parsed structured observation.
 * @since 1.0.0
 */
export function invoke(executable, args) {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'psmodulepath'),
  );
  const result = spawnSync(executable, args, {
    windowsHide: true,
    timeout: 25000,
    maxBuffer: 131072,
    env: {
      ...inherited,
      PSModulePath: path.win32.normalize('C:/Windows/System32/WindowsPowerShell/v1.0/Modules'),
    },
  });
  if (result.error || result.status !== 0 || result.stderr.length)
    throw new Error(
      JSON.stringify({
        error: result.error?.message,
        status: result.status,
        stdout: result.stdout.toString(),
        stderr: result.stderr.toString(),
      }),
    );
  return JSON.parse(result.stdout.toString());
}
