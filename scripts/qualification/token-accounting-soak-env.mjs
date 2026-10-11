import path from 'node:path';

/**
 * Build a credential-free Windows launch environment with disposable user paths.
 * @param {Record<string, string | undefined>} parent Parent environment.
 * @param {{home: string, profile: string, temp: string}} directories Isolated paths.
 * @returns {Record<string, string>} Explicit child environment.
 * @since 0.19.2
 */
export function createLaunchEnvironment(parent, { home, profile, temp }) {
  // Windows environment keys are case-insensitive. No arbitrary parent keys pass through.
  const systemRoot =
    Object.entries(parent).find(([key]) => key.toUpperCase() === 'SYSTEMROOT')?.[1] ||
    'C:\\Windows';
  const system32 = path.win32.join(systemRoot, 'System32');
  return {
    SystemRoot: systemRoot,
    WINDIR: systemRoot,
    COMSPEC: path.win32.join(system32, 'cmd.exe'),
    PATH: [system32, systemRoot, path.win32.join(system32, 'Wbem')].join(';'),
    PATHEXT: '.COM;.EXE;.BAT;.CMD',
    USERPROFILE: home,
    HOME: home,
    APPDATA: profile,
    LOCALAPPDATA: profile,
    TEMP: temp,
    TMP: temp,
  };
}
