import { describe, it, expect, afterEach } from 'vitest';
import detector from '../../src/main/wsl-detector.js';

/**
 * Build an execFile mock keyed by joined args.
 * @param {Record<string, {stdout?: string, err?: string}>} responses
 */
function mockExec(responses) {
  return (cmd, args, _opts, cb) => {
    const key = args.join(' ');
    const r = responses[key];
    if (!r || r.err) {
      cb(new Error(r ? r.err : 'unexpected: ' + key), '');
      return;
    }
    cb(null, r.stdout || '');
  };
}

const PS_KEY = '-e ps -eo pid=,args=';
const LIST_KEY = '-l -q';

afterEach(() => {
  detector._resetForTest();
});

describe('wsl-detector', () => {
  describe('parsePsOutput() (pure)', () => {
    it('detects opencode and grok with correct fields', () => {
      const out = ['  123 /usr/bin/opencode serve', '  456 /usr/bin/bash', '  789 grok chat'].join(
        '\n',
      );
      const result = detector.parsePsOutput(out);
      expect(result).toHaveLength(2);
      const oc = result.find((a) => a.agent === 'opencode');
      expect(oc).toMatchObject({
        agent: 'opencode',
        pid: 0,
        category: 'ai',
        parentEditor: 'WSL',
        host: 'wsl',
        wslPid: 123,
        detectionMethod: 'wsl-process',
      });
      const gr = result.find((a) => a.agent === 'grok');
      expect(gr.wslPid).toBe(789);
    });

    it('matches opencode invoked via node by path', () => {
      const result = detector.parsePsOutput('  10 node /home/u/.local/bin/opencode');
      expect(result).toHaveLength(1);
      expect(result[0].agent).toBe('opencode');
    });

    it('matches grok-cli', () => {
      const result = detector.parsePsOutput('  11 grok-cli --model grok-2');
      expect(result.map((a) => a.agent)).toContain('grok');
    });

    it('does not false-match notopencode or grokuser (boundary)', () => {
      const out = ['  1 /usr/bin/notopencode', '  2 /home/grokuser/app'].join('\n');
      expect(detector.parsePsOutput(out)).toEqual([]);
    });

    it('dedups repeated agents to a single entry', () => {
      const out = ['  1 /usr/bin/opencode', '  2 /opt/opencode/bin/opencode'].join('\n');
      const result = detector.parsePsOutput(out);
      expect(result.filter((a) => a.agent === 'opencode')).toHaveLength(1);
    });

    it('ignores malformed lines', () => {
      expect(detector.parsePsOutput('garbage\n\n   \nPID ARGS')).toEqual([]);
    });
  });

  describe('isWslAvailable()', () => {
    it('returns false on non-win32 platforms', async () => {
      detector._setDepsForTest({ platform: 'linux', execFile: mockExec({}) });
      expect(await detector.isWslAvailable()).toBe(false);
    });

    it('returns true on win32 when a distro is listed', async () => {
      detector._setDepsForTest({
        platform: 'win32',
        execFile: mockExec({ [LIST_KEY]: { stdout: 'Ubuntu\n' } }),
      });
      expect(await detector.isWslAvailable()).toBe(true);
    });

    it('strips UTF-16LE null bytes before the emptiness check', async () => {
      // Real NUL bytes interleaved, as `wsl -l -q` UTF-16LE decodes under UTF-8.
      const NUL = String.fromCharCode(0);
      const utf16ish = NUL + 'U' + NUL + 'b' + NUL + 'u' + NUL + 'n' + NUL + 't' + NUL + 'u' + NUL;
      detector._setDepsForTest({
        platform: 'win32',
        execFile: mockExec({ [LIST_KEY]: { stdout: utf16ish } }),
      });
      expect(await detector.isWslAvailable()).toBe(true);
    });

    it('treats an all-null distro list as unavailable', async () => {
      const NUL = String.fromCharCode(0);
      detector._setDepsForTest({
        platform: 'win32',
        execFile: mockExec({ [LIST_KEY]: { stdout: NUL + NUL + '\n' } }),
      });
      expect(await detector.isWslAvailable()).toBe(false);
    });

    it('returns false when wsl.exe errors (not installed)', async () => {
      detector._setDepsForTest({
        platform: 'win32',
        execFile: mockExec({ [LIST_KEY]: { err: 'ENOENT' } }),
      });
      expect(await detector.isWslAvailable()).toBe(false);
    });

    it('returns false when the distro list is empty/whitespace', async () => {
      detector._setDepsForTest({
        platform: 'win32',
        execFile: mockExec({ [LIST_KEY]: { stdout: ' \n' } }),
      });
      expect(await detector.isWslAvailable()).toBe(false);
    });
  });

  describe('detectWslAgents()', () => {
    it('returns [] on non-win32', async () => {
      detector._setDepsForTest({ platform: 'linux', execFile: mockExec({}) });
      expect(await detector.detectWslAgents()).toEqual([]);
    });

    it('returns [] on win32 when WSL is unavailable', async () => {
      detector._setDepsForTest({
        platform: 'win32',
        execFile: mockExec({ [LIST_KEY]: { err: 'ENOENT' } }),
      });
      expect(await detector.detectWslAgents()).toEqual([]);
    });

    it('enumerates and surfaces opencode/grok when available', async () => {
      detector._setDepsForTest({
        platform: 'win32',
        execFile: mockExec({
          [LIST_KEY]: { stdout: 'Ubuntu\n' },
          [PS_KEY]: { stdout: '  42 /usr/bin/opencode serve\n  99 grok chat' },
        }),
      });
      const result = await detector.detectWslAgents();
      expect(result.map((a) => a.agent).sort()).toEqual(['grok', 'opencode']);
      expect(result.every((a) => a.pid === 0)).toBe(true);
    });

    it('returns [] when ps yields no matching processes', async () => {
      detector._setDepsForTest({
        platform: 'win32',
        execFile: mockExec({
          [LIST_KEY]: { stdout: 'Ubuntu\n' },
          [PS_KEY]: { stdout: '  1 /sbin/init\n  2 /usr/bin/bash' },
        }),
      });
      expect(await detector.detectWslAgents()).toEqual([]);
    });

    it('returns [] when ps itself errors (enumeration unavailable → fallback)', async () => {
      detector._setDepsForTest({
        platform: 'win32',
        execFile: mockExec({
          [LIST_KEY]: { stdout: 'Ubuntu\n' },
          [PS_KEY]: { err: 'ps: not found' },
        }),
      });
      expect(await detector.detectWslAgents()).toEqual([]);
    });
  });

  describe('getCachedWslAgents()', () => {
    it('returns [] immediately, then caches after the background refresh', async () => {
      detector._setDepsForTest({
        platform: 'win32',
        execFile: mockExec({
          [LIST_KEY]: { stdout: 'Ubuntu\n' },
          [PS_KEY]: { stdout: '  42 /usr/bin/opencode' },
        }),
      });
      expect(detector.getCachedWslAgents()).toEqual([]);
      await new Promise((r) => setTimeout(r, 20));
      const cached = detector.getCachedWslAgents();
      expect(cached).toHaveLength(1);
      expect(cached[0].agent).toBe('opencode');
    });
  });
});
