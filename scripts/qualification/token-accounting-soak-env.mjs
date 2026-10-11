import path from 'node:path';
import { lstatSync, realpathSync } from 'node:fs';

/**
 * Build a credential-free Windows launch environment with disposable user paths.
 * @param {Record<string, string | undefined>} _parent Parent environment (never inherited).
 * @param {{home: string, profile: string, temp: string}} directories Isolated paths.
 * @returns {Record<string, string>} Explicit child environment.
 * @since 0.19.2
 */
export function createLaunchEnvironment(_parent, { home, profile, temp }) {
  // Match the harness's fixed, validated taskkill root; never trust parent SystemRoot.
  const systemRoot = 'C:\\Windows';
  const system32 = path.win32.join(systemRoot, 'System32');
  const searchDirectories = [
    system32,
    systemRoot,
    path.win32.join(system32, 'Wbem'),
    path.win32.join(system32, 'WindowsPowerShell', 'v1.0'),
  ];
  // Portable unit tests build the same object; actual launches are Windows-only.
  if (process.platform === 'win32') {
    try {
      for (const directory of searchDirectories) {
        const info = lstatSync(directory);
        if (
          !info.isDirectory() ||
          info.isSymbolicLink() ||
          realpathSync(directory).toLowerCase() !== directory.toLowerCase()
        )
          throw Error('trusted-windows-directory-required');
      }
    } catch {
      throw Error('trusted-windows-directory-required');
    }
  }
  return {
    SystemRoot: systemRoot,
    WINDIR: systemRoot,
    COMSPEC: path.win32.join(system32, 'cmd.exe'),
    PATH: searchDirectories.join(';'),
    PATHEXT: '.COM;.EXE;.BAT;.CMD',
    USERPROFILE: home,
    HOME: home,
    APPDATA: profile,
    LOCALAPPDATA: profile,
    TEMP: temp,
    TMP: temp,
  };
}
