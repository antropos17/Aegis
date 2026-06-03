import { describe, it, expect, afterEach } from 'vitest';
import detector from '../../src/main/ide-extension-detector.js';

const HOME = '/home/dev';

/** Build a readdir mock from a map of editor-dir-fragment -> entries. */
function makeReaddir(map) {
  return async (dir) => {
    // Order matters: '.vscode-insiders' also contains '.vscode'.
    if (dir.includes('.vscode-insiders')) return map.insiders || throwEnoent();
    if (dir.includes('.vscode')) return map.vscode || throwEnoent();
    if (dir.includes('.cursor')) return map.cursor || throwEnoent();
    if (dir.includes('.windsurf')) return map.windsurf || throwEnoent();
    return throwEnoent();
  };
}
function throwEnoent() {
  const e = new Error('ENOENT');
  // @ts-ignore
  e.code = 'ENOENT';
  throw e;
}

/** Mock listProcesses returning the given lowercase-able names. */
function procs(names) {
  return async () => names.map((name, i) => ({ name, pid: 1000 + i }));
}

afterEach(() => {
  detector._resetForTest();
});

describe('ide-extension-detector', () => {
  describe('detectExtensionAgents()', () => {
    it('detects Kilo Code when VS Code runs and the extension is installed', async () => {
      detector._setDepsForTest({
        homedir: () => HOME,
        listProcesses: procs(['Code.exe']),
        readdir: makeReaddir({ vscode: ['kilocode.kilo-code-4.0.0', 'ms-python.python-2024.1'] }),
      });
      const result = await detector.detectExtensionAgents();
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        agent: 'Kilo Code',
        pid: 0,
        category: 'ai',
        parentEditor: 'VS Code',
        displayLabel: 'Kilo Code (via VS Code)',
        detectionMethod: 'ide-extension',
      });
    });

    it('detects Cline via saoudrizwan.claude-dev', async () => {
      detector._setDepsForTest({
        homedir: () => HOME,
        listProcesses: procs(['code']),
        readdir: makeReaddir({ vscode: ['saoudrizwan.claude-dev-3.1.0'] }),
      });
      const result = await detector.detectExtensionAgents();
      expect(result).toHaveLength(1);
      expect(result[0].agent).toBe('Cline');
    });

    it('returns nothing when the editor is NOT running (idle extension is not an active agent)', async () => {
      detector._setDepsForTest({
        homedir: () => HOME,
        listProcesses: procs(['chrome.exe', 'explorer.exe']),
        readdir: makeReaddir({ vscode: ['kilocode.kilo-code-4.0.0'] }),
      });
      const result = await detector.detectExtensionAgents();
      expect(result).toEqual([]);
    });

    it('returns nothing when the editor runs but the extension is not installed', async () => {
      detector._setDepsForTest({
        homedir: () => HOME,
        listProcesses: procs(['Code.exe']),
        readdir: makeReaddir({
          vscode: ['ms-python.python-2024.1', 'esbenp.prettier-vscode-10.1.0'],
        }),
      });
      const result = await detector.detectExtensionAgents();
      expect(result).toEqual([]);
    });

    it('detects Cursor host with its own extensions dir', async () => {
      detector._setDepsForTest({
        homedir: () => HOME,
        listProcesses: procs(['Cursor.exe']),
        readdir: makeReaddir({ cursor: ['kilocode.kilo-code-4.0.0'] }),
      });
      const result = await detector.detectExtensionAgents();
      expect(result).toHaveLength(1);
      expect(result[0].parentEditor).toBe('Cursor');
    });

    it('detects Windsurf host', async () => {
      detector._setDepsForTest({
        homedir: () => HOME,
        listProcesses: procs(['Windsurf.exe']),
        readdir: makeReaddir({ windsurf: ['saoudrizwan.claude-dev-3.1.0'] }),
      });
      const result = await detector.detectExtensionAgents();
      expect(result[0].parentEditor).toBe('Windsurf');
    });

    it('does not false-match a similarly named extension (boundary check)', async () => {
      detector._setDepsForTest({
        homedir: () => HOME,
        listProcesses: procs(['Code.exe']),
        // "kilocode.kilo-coder" must NOT match "kilocode.kilo-code"
        readdir: makeReaddir({ vscode: ['kilocode.kilo-coder-1.0.0'] }),
      });
      const result = await detector.detectExtensionAgents();
      expect(result).toEqual([]);
    });

    it('matches an exact, version-less extension folder', async () => {
      detector._setDepsForTest({
        homedir: () => HOME,
        listProcesses: procs(['Code.exe']),
        readdir: makeReaddir({ vscode: ['kilocode.kilo-code'] }),
      });
      const result = await detector.detectExtensionAgents();
      expect(result).toHaveLength(1);
    });

    it('dedups the same agent across multiple running editors', async () => {
      detector._setDepsForTest({
        homedir: () => HOME,
        listProcesses: procs(['Code.exe', 'Cursor.exe']),
        readdir: makeReaddir({
          vscode: ['kilocode.kilo-code-4.0.0'],
          cursor: ['kilocode.kilo-code-4.0.0'],
        }),
      });
      const result = await detector.detectExtensionAgents();
      expect(result.filter((a) => a.agent === 'Kilo Code')).toHaveLength(1);
    });

    it('returns [] when listProcesses throws', async () => {
      detector._setDepsForTest({
        homedir: () => HOME,
        listProcesses: async () => {
          throw new Error('EPERM');
        },
        readdir: makeReaddir({ vscode: ['kilocode.kilo-code-4.0.0'] }),
      });
      const result = await detector.detectExtensionAgents();
      expect(result).toEqual([]);
    });

    it('skips an editor whose extensions dir is absent (readdir throws)', async () => {
      detector._setDepsForTest({
        homedir: () => HOME,
        listProcesses: procs(['Code.exe']),
        readdir: async () => throwEnoent(),
      });
      const result = await detector.detectExtensionAgents();
      expect(result).toEqual([]);
    });

    it('detects both Kilo and Cline when both are installed', async () => {
      detector._setDepsForTest({
        homedir: () => HOME,
        listProcesses: procs(['Code.exe']),
        readdir: makeReaddir({
          vscode: ['kilocode.kilo-code-4.0.0', 'saoudrizwan.claude-dev-3.1.0'],
        }),
      });
      const result = await detector.detectExtensionAgents();
      expect(result.map((a) => a.agent).sort()).toEqual(['Cline', 'Kilo Code']);
    });
  });

  describe('getCachedExtensionAgents()', () => {
    it('returns [] immediately, then caches after the background refresh', async () => {
      detector._setDepsForTest({
        homedir: () => HOME,
        listProcesses: procs(['Code.exe']),
        readdir: makeReaddir({ vscode: ['kilocode.kilo-code-4.0.0'] }),
      });
      // Cold cache: synchronous read returns empty while refresh runs in bg.
      expect(detector.getCachedExtensionAgents()).toEqual([]);
      await new Promise((r) => setTimeout(r, 20));
      const cached = detector.getCachedExtensionAgents();
      expect(cached).toHaveLength(1);
      expect(cached[0].agent).toBe('Kilo Code');
    });
  });
});
