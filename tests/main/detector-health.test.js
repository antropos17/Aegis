/**
 * Block B3 remainder — finding B-S12: health for the SECONDARY agent detectors.
 *
 * Every case here asks one question: can a reader tell "this agent is not running" from
 * "nobody managed to look"? Before this block all three detectors answered both with an
 * empty array, and a fleet assembled from those answers looked complete either way.
 *
 * The platform is pinned in every WSL case. CI runs ubuntu and the dev machine is
 * win32, so a case that reads the real `process.platform` would assert one thing here
 * and a different thing there (ai-mistakes #26). No real spawn and no real socket is
 * reachable from this file: every dependency is injected.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import { SENSOR_HEALTH_STATE as S } from '../../src/main/sensor-health.js';
import ide from '../../src/main/ide-extension-detector.js';
import wsl from '../../src/main/wsl-detector.js';
import llm from '../../src/main/llm-runtime-detector.js';

/**
 * An Error carrying a real `code`, which is what the detectors classify on.
 * @param {string|number} code
 * @returns {Error}
 */
function failWith(code) {
  const e = new Error(`failed: ${code}`);
  // @ts-ignore — test fixture mirrors a Node system error
  e.code = code;
  return e;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ide-extension
// ═══════════════════════════════════════════════════════════════════════════════

describe('ide-extension sensor health (B-S12)', () => {
  const HOME = '/home/dev';

  /** @param {string[]} names @returns {Function} */
  function procs(names) {
    return async () => names.map((name, i) => ({ name, pid: 1000 + i }));
  }

  afterEach(() => {
    ide._resetForTest();
  });

  it('starts STARTING under its own sensor id', () => {
    const h = ide.getIdeExtensionSensorHealth();
    expect(h.sensorId).toBe('ide-extension');
    expect(h.state).toBe(S.STARTING);
    expect(h.lossCount).toBe(0);
    expect(h.lastSuccessAt).toBeNull();
  });

  it('a process list that cannot be read is FAILED, not an empty extension set', async () => {
    ide._setDepsForTest({
      homedir: () => HOME,
      listProcesses: async () => {
        throw failWith('EPERM');
      },
      readdir: async () => [],
    });
    expect(await ide.detectExtensionAgents()).toEqual([]);
    const h = ide.getIdeExtensionSensorHealth();
    expect(h.state).toBe(S.FAILED);
    expect(h.detail).toBe('process-list-unavailable');
    expect(h.lastError).toBe('process-list-unavailable:EPERM');
    expect(h.consecutiveFailures).toBe(1);
    expect(h.lastSuccessAt).toBeNull();
  });

  it('ENOENT on a running editor is a definite absence → HEALTHY', async () => {
    ide._setDepsForTest({
      homedir: () => HOME,
      listProcesses: procs(['Code.exe']),
      readdir: async () => {
        throw failWith('ENOENT');
      },
    });
    expect(await ide.detectExtensionAgents()).toEqual([]);
    const h = ide.getIdeExtensionSensorHealth();
    expect(h.state).toBe(S.HEALTHY);
    expect(h.lastSuccessAt).toBeTypeOf('number');
    expect(h.lastError).toBeNull();
  });

  it('ENOTDIR is the same definite absence', async () => {
    ide._setDepsForTest({
      homedir: () => HOME,
      listProcesses: procs(['Code.exe']),
      readdir: async () => {
        throw failWith('ENOTDIR');
      },
    });
    await ide.detectExtensionAgents();
    expect(ide.getIdeExtensionSensorHealth().state).toBe(S.HEALTHY);
  });

  it('an editor that is not running is not an observation gap', async () => {
    ide._setDepsForTest({
      homedir: () => HOME,
      listProcesses: procs(['chrome.exe']),
      readdir: async () => {
        throw failWith('EACCES');
      },
    });
    expect(await ide.detectExtensionAgents()).toEqual([]);
    // No editor ran, so no extensions dir was owed a read: the pass is complete.
    expect(ide.getIdeExtensionSensorHealth().state).toBe(S.HEALTHY);
  });

  it('B-S12: an unreadable dir on a RUNNING editor is DEGRADED, not a clean empty set', async () => {
    ide._setDepsForTest({
      homedir: () => HOME,
      listProcesses: procs(['Code.exe']),
      readdir: async () => {
        throw failWith('EACCES');
      },
    });
    expect(await ide.detectExtensionAgents()).toEqual([]);
    const h = ide.getIdeExtensionSensorHealth();
    expect(h.state).toBe(S.DEGRADED);
    expect(h.detail).toBe('extensions-dir-unreadable');
    expect(h.lastError).toContain('VS Code:EACCES');
    // Nothing failed outright and nothing succeeded fully.
    expect(h.consecutiveFailures).toBe(0);
    expect(h.lastSuccessAt).toBeNull();
  });

  it('delivers what it did see AND flags what it did not, on the same pass', async () => {
    ide._setDepsForTest({
      homedir: () => HOME,
      listProcesses: procs(['Code.exe', 'Cursor.exe']),
      readdir: async (dir) => {
        if (dir.includes('.cursor')) throw failWith('EMFILE');
        return ['kilocode.kilo-code-4.0.0'];
      },
    });
    const agents = await ide.detectExtensionAgents();
    // The evidence that WAS observed still ships — a degraded sensor must not suppress
    // an observation, only refuse to call the gap clean.
    expect(agents.map((a) => a.agent)).toEqual(['Kilo Code']);
    const h = ide.getIdeExtensionSensorHealth();
    expect(h.state).toBe(S.DEGRADED);
    expect(h.lastError).toContain('Cursor:EMFILE');
  });

  it('recovery: a later complete pass returns to HEALTHY and clears the error', async () => {
    let fail = true;
    ide._setDepsForTest({
      homedir: () => HOME,
      listProcesses: procs(['Code.exe']),
      readdir: async () => {
        if (fail) throw failWith('EACCES');
        return ['kilocode.kilo-code-4.0.0'];
      },
    });
    await ide.detectExtensionAgents();
    expect(ide.getIdeExtensionSensorHealth().state).toBe(S.DEGRADED);
    fail = false;
    await ide.detectExtensionAgents();
    const h = ide.getIdeExtensionSensorHealth();
    expect(h.state).toBe(S.HEALTHY);
    expect(h.lastError).toBeNull();
    expect(h.lastSuccessAt).toBeTypeOf('number');
  });

  it('a throw escaping the background refresh is FAILED, not a silent stale cache', async () => {
    ide._setDepsForTest({
      homedir: () => {
        throw failWith('EIO');
      },
      listProcesses: procs(['Code.exe']),
      readdir: async () => [],
    });
    // `_homedir()` runs outside the detector's own try, so this rejection reaches the
    // refresh `.catch` — the path that used to swallow everything.
    expect(ide.getCachedExtensionAgents()).toEqual([]);
    await vi.waitFor(() => {
      expect(ide.getIdeExtensionSensorHealth().state).toBe(S.FAILED);
    });
    expect(ide.getIdeExtensionSensorHealth().detail).toBe('refresh-threw');
  });

  it('the snapshot is plain JSON data', async () => {
    ide._setDepsForTest({
      homedir: () => HOME,
      listProcesses: procs(['Code.exe']),
      readdir: async () => ['kilocode.kilo-code-4.0.0'],
    });
    await ide.detectExtensionAgents();
    const h = ide.getIdeExtensionSensorHealth();
    expect(JSON.parse(JSON.stringify(h))).toEqual(h);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// wsl
// ═══════════════════════════════════════════════════════════════════════════════

describe('wsl sensor health (B-S12)', () => {
  const LIST_KEY = '-l -q';
  const PS_KEY = '-e ps -eo pid=,args=';

  /**
   * execFile mock keyed by joined args, recording every spawn it is asked for.
   *
   * A response is one of: `{stdout}` (exit 0), `{code}` (a string errno = the spawn
   * never ran, or a number = the binary ran and exited non-zero), `{timeout: true}`
   * (killed by the timeout, no `code` at all).
   * @param {Record<string, object>} responses
   * @param {string[]} [calls]
   * @returns {Function}
   */
  function mockExec(responses, calls) {
    return (_cmd, args, _opts, cb) => {
      const key = args.join(' ');
      if (calls) calls.push(key);
      const r = responses[key];
      if (!r) {
        cb(new Error(`unexpected spawn: ${key}`), '');
        return;
      }
      if (r.code !== undefined) {
        cb(failWith(r.code), '');
        return;
      }
      if (r.timeout) {
        const e = new Error('timed out');
        // @ts-ignore — execFile marks a timeout kill this way, with no `code`
        e.killed = true;
        cb(e, '');
        return;
      }
      cb(null, r.stdout || '');
    };
  }

  afterEach(() => {
    wsl._resetForTest();
  });

  it('is UNSUPPORTED off win32 and spawns nothing', async () => {
    const calls = [];
    wsl._setDepsForTest({ platform: 'linux', execFile: mockExec({}, calls) });
    expect(await wsl.detectWslAgents()).toEqual([]);
    expect(calls).toEqual([]);
    const h = wsl.getWslSensorHealth();
    expect(h.sensorId).toBe('wsl');
    expect(h.state).toBe(S.UNSUPPORTED);
    expect(h.detail).toBe('platform-no-wsl');
  });

  it('no wsl.exe at all (ENOENT) is UNSUPPORTED, and is cached', async () => {
    const calls = [];
    wsl._setDepsForTest({
      platform: 'win32',
      execFile: mockExec({ [LIST_KEY]: { code: 'ENOENT' } }, calls),
    });
    expect(await wsl.detectWslAgents()).toEqual([]);
    expect(await wsl.detectWslAgents()).toEqual([]);
    // A definite, permanent answer: asked once, not once per cycle.
    expect(calls.filter((k) => k === LIST_KEY)).toHaveLength(1);
    const h = wsl.getWslSensorHealth();
    expect(h.state).toBe(S.UNSUPPORTED);
    expect(h.detail).toBe('wsl-not-installed');
    expect(h.consecutiveFailures).toBe(0);
  });

  it('wsl.exe that RAN and exited non-zero is UNSUPPORTED (no distro), not degraded', async () => {
    // The stock Windows shape: the binary ships in System32 whether or not WSL was set
    // up, and answers `-l -q` with a non-zero exit. Reading that as degradation would
    // hold every such machine permanently DEGRADED.
    wsl._setDepsForTest({
      platform: 'win32',
      execFile: mockExec({ [LIST_KEY]: { code: 1 } }),
    });
    expect(await wsl.detectWslAgents()).toEqual([]);
    const h = wsl.getWslSensorHealth();
    expect(h.state).toBe(S.UNSUPPORTED);
    expect(h.detail).toBe('wsl-no-distro');
  });

  it('an empty distro list is UNSUPPORTED (no distro)', async () => {
    wsl._setDepsForTest({
      platform: 'win32',
      execFile: mockExec({ [LIST_KEY]: { stdout: ' \n' } }),
    });
    expect(await wsl.isWslAvailable()).toBe(false);
    expect(wsl.getWslSensorHealth().detail).toBe('wsl-no-distro');
  });

  it('a probe that produced NO verdict is DEGRADED and is not cached', async () => {
    const calls = [];
    wsl._setDepsForTest({
      platform: 'win32',
      execFile: mockExec({ [LIST_KEY]: { timeout: true } }, calls),
    });
    expect(await wsl.detectWslAgents()).toEqual([]);
    const h = wsl.getWslSensorHealth();
    expect(h.state).toBe(S.DEGRADED);
    expect(h.detail).toBe('wsl-probe-failed');
    expect(h.lastError).toBe('wsl-probe-failed:timeout');
    // The approved behaviour change: a transient probe failure must not be cached as
    // "no WSL here" for the rest of the process life, so the next cycle asks again.
    await wsl.detectWslAgents();
    expect(calls.filter((k) => k === LIST_KEY)).toHaveLength(2);
  });

  it('WSL present but its process list unreadable is DEGRADED, not an empty distro', async () => {
    wsl._setDepsForTest({
      platform: 'win32',
      execFile: mockExec({
        [LIST_KEY]: { stdout: 'Ubuntu\n' },
        [PS_KEY]: { code: 'ENOENT' },
      }),
    });
    expect(await wsl.detectWslAgents()).toEqual([]);
    const h = wsl.getWslSensorHealth();
    expect(h.state).toBe(S.DEGRADED);
    expect(h.detail).toBe('wsl-enumeration-unavailable');
    expect(h.lastError).toBe('wsl-enumeration-unavailable:ENOENT');
    expect(h.lastSuccessAt).toBeNull();
  });

  it('a ps that exits 0 and prints nothing is an unread list, not an empty one', async () => {
    wsl._setDepsForTest({
      platform: 'win32',
      execFile: mockExec({
        [LIST_KEY]: { stdout: 'Ubuntu\n' },
        [PS_KEY]: { stdout: '   \n' },
      }),
    });
    expect(await wsl.detectWslAgents()).toEqual([]);
    const h = wsl.getWslSensorHealth();
    expect(h.state).toBe(S.DEGRADED);
    expect(h.detail).toBe('wsl-enumeration-empty');
  });

  it('a list that WAS read is HEALTHY even when it holds no agent', async () => {
    wsl._setDepsForTest({
      platform: 'win32',
      execFile: mockExec({
        [LIST_KEY]: { stdout: 'Ubuntu\n' },
        [PS_KEY]: { stdout: '  1 /sbin/init\n  2 /usr/bin/bash' },
      }),
    });
    expect(await wsl.detectWslAgents()).toEqual([]);
    const h = wsl.getWslSensorHealth();
    expect(h.state).toBe(S.HEALTHY);
    expect(h.lastSuccessAt).toBeTypeOf('number');
  });

  it('recovery: an unreadable enumeration then a readable one → HEALTHY', async () => {
    let broken = true;
    wsl._setDepsForTest({
      platform: 'win32',
      execFile: (_cmd, args, _opts, cb) => {
        const key = args.join(' ');
        if (key === LIST_KEY) return cb(null, 'Ubuntu\n');
        if (broken) return cb(failWith('ENOENT'), '');
        return cb(null, '  42 /usr/bin/opencode serve');
      },
    });
    await wsl.detectWslAgents();
    expect(wsl.getWslSensorHealth().state).toBe(S.DEGRADED);
    broken = false;
    const agents = await wsl.detectWslAgents();
    expect(agents.map((a) => a.agent)).toEqual(['opencode']);
    const h = wsl.getWslSensorHealth();
    expect(h.state).toBe(S.HEALTHY);
    expect(h.lastError).toBeNull();
  });

  it('the snapshot is plain JSON data', async () => {
    wsl._setDepsForTest({
      platform: 'win32',
      execFile: mockExec({
        [LIST_KEY]: { stdout: 'Ubuntu\n' },
        [PS_KEY]: { stdout: '  42 /usr/bin/opencode serve' },
      }),
    });
    await wsl.detectWslAgents();
    const h = wsl.getWslSensorHealth();
    expect(JSON.parse(JSON.stringify(h))).toEqual(h);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// llm-ollama / llm-lmstudio
// ═══════════════════════════════════════════════════════════════════════════════

describe('local-runtime probe health (B-S12)', () => {
  const OLLAMA_PORT = 11434;
  const LM_STUDIO_PORT = 1234;

  /**
   * One http mock whose behaviour is chosen per PORT, so both probes can be given
   * different outcomes on the same tick — which is how scan-loop runs them.
   *
   * A plan is one of: `{body}` (JSON), `{raw}` (a body that is not JSON),
   * `{errorCode}` (a socket error) or `{timeout: true}`.
   * @param {Record<number, object>} byPort
   * @returns {{request: Function}}
   */
  function httpByPort(byPort) {
    return {
      request: (opts, cb) => {
        const plan = byPort[opts.port] || { errorCode: 'ECONNREFUSED' };
        const req = new EventEmitter();
        // @ts-ignore — minimal ClientRequest surface
        req.destroy = vi.fn();
        // @ts-ignore
        req.end = vi.fn(() => {
          process.nextTick(() => {
            if (plan.timeout) {
              req.emit('timeout');
              return;
            }
            if (plan.errorCode) {
              req.emit('error', failWith(plan.errorCode));
              return;
            }
            const res = new EventEmitter();
            cb(res);
            res.emit('data', plan.raw !== undefined ? plan.raw : JSON.stringify(plan.body));
            res.emit('end');
          });
        });
        return req;
      },
    };
  }

  beforeEach(() => {
    llm._resetForTest();
  });

  afterEach(() => {
    llm._resetForTest();
  });

  it('both records start STARTING under their own ids', () => {
    const h = llm.getLlmRuntimeSensorHealth();
    expect(Object.keys(h).sort()).toEqual(['llm-lmstudio', 'llm-ollama']);
    expect(h['llm-ollama'].state).toBe(S.STARTING);
    expect(h['llm-lmstudio'].state).toBe(S.STARTING);
  });

  it('ECONNREFUSED is a real negative observation → HEALTHY, running false', async () => {
    llm._setDepsForTest({ http: httpByPort({ [OLLAMA_PORT]: { errorCode: 'ECONNREFUSED' } }) });
    expect(await llm.detectOllamaModels()).toEqual({ running: false, models: [] });
    const h = llm.getLlmRuntimeSensorHealth()['llm-ollama'];
    expect(h.state).toBe(S.HEALTHY);
    expect(h.lastSuccessAt).toBeTypeOf('number');
  });

  it('a foreign body on the port is also a definite answer → HEALTHY', async () => {
    // Port 1234 is a stock dev-server port. Something answered and it is not LM Studio,
    // which is a verdict about LM Studio, not an unknown.
    llm._setDepsForTest({ http: httpByPort({ [LM_STUDIO_PORT]: { raw: '<html>hello</html>' } }) });
    expect(await llm.detectLMStudioModels()).toEqual({ running: false, models: [] });
    expect(llm.getLlmRuntimeSensorHealth()['llm-lmstudio'].state).toBe(S.HEALTHY);
  });

  it('B-S12: a timeout is NOT an observation → DEGRADED, no success recorded', async () => {
    llm._setDepsForTest({ http: httpByPort({ [OLLAMA_PORT]: { timeout: true } }) });
    expect(await llm.detectOllamaModels()).toEqual({ running: false, models: [] });
    const h = llm.getLlmRuntimeSensorHealth()['llm-ollama'];
    expect(h.state).toBe(S.DEGRADED);
    expect(h.detail).toBe('probe-unreachable');
    expect(h.lastError).toBe('probe-unreachable:timeout');
    expect(h.lastSuccessAt).toBeNull();
    expect(h.consecutiveFailures).toBe(0);
  });

  it('a broken transport carries its code into the record', async () => {
    llm._setDepsForTest({ http: httpByPort({ [OLLAMA_PORT]: { errorCode: 'ECONNRESET' } }) });
    await llm.detectOllamaModels();
    const h = llm.getLlmRuntimeSensorHealth()['llm-ollama'];
    expect(h.state).toBe(S.DEGRADED);
    expect(h.lastError).toBe('probe-unreachable:ECONNRESET');
  });

  it('a live runtime is HEALTHY and its models still ride the compat shape', async () => {
    llm._setDepsForTest({
      http: httpByPort({ [OLLAMA_PORT]: { body: { models: [{ name: 'llama3' }] } } }),
    });
    expect(await llm.detectOllamaModels()).toEqual({ running: true, models: ['llama3'] });
    expect(llm.getLlmRuntimeSensorHealth()['llm-ollama'].state).toBe(S.HEALTHY);
  });

  it("one probe's uncertainty is not erased by the other probe's answer", async () => {
    llm._setDepsForTest({
      http: httpByPort({
        [OLLAMA_PORT]: { timeout: true },
        [LM_STUDIO_PORT]: { errorCode: 'ECONNREFUSED' },
      }),
    });
    // Concurrently, exactly as scan-loop's enrichWithLocalModels runs them. One shared
    // record would be written twice in an order nobody controls, and the definite
    // answer would overwrite the uncertain one.
    await Promise.all([llm.detectOllamaModels(), llm.detectLMStudioModels()]);
    const h = llm.getLlmRuntimeSensorHealth();
    expect(h['llm-ollama'].state).toBe(S.DEGRADED);
    expect(h['llm-lmstudio'].state).toBe(S.HEALTHY);
  });

  it('recovery: a timeout then a real answer → HEALTHY', async () => {
    llm._setDepsForTest({ http: httpByPort({ [OLLAMA_PORT]: { timeout: true } }) });
    await llm.detectOllamaModels();
    expect(llm.getLlmRuntimeSensorHealth()['llm-ollama'].state).toBe(S.DEGRADED);
    llm._setDepsForTest({
      http: httpByPort({ [OLLAMA_PORT]: { body: { models: [{ model: 'qwen' }] } } }),
    });
    await llm.detectOllamaModels();
    const h = llm.getLlmRuntimeSensorHealth()['llm-ollama'];
    expect(h.state).toBe(S.HEALTHY);
    expect(h.lastError).toBeNull();
  });

  it('the snapshots are plain JSON data', async () => {
    llm._setDepsForTest({ http: httpByPort({}) });
    await llm.detectLMStudioModels();
    const h = llm.getLlmRuntimeSensorHealth();
    expect(JSON.parse(JSON.stringify(h))).toEqual(h);
  });
});
