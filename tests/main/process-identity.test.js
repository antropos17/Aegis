import { describe, it, expect } from 'vitest';
import identity from '../../src/main/process-identity.js';

const { identify, buildInstanceId, INSTANCE_ID_SOURCES } = identity;

/** A win32-shaped agent: real pid + readable OS birth time. */
const BIRTH = 1_717_000_000_000;

describe('process-identity', () => {
  describe('space 1 — os (pid + OS birth time)', () => {
    it('binds pid to the birth time', () => {
      const res = identify({ pid: 18324, process: 'claude', startTime: BIRTH });
      expect(res.instanceId).toBe(`18324:${BIRTH}`);
      expect(res.instanceIdSource).toBe('os');
    });

    it('the SAME pid with a different birth time is a different instance', () => {
      // This is the whole point: PID reuse must not read as one process.
      const first = buildInstanceId({ pid: 18324, process: 'claude', startTime: BIRTH });
      const reused = buildInstanceId({
        pid: 18324,
        process: 'claude',
        startTime: BIRTH + 36_000_000, // +10h — the recycled pid
      });
      expect(first).not.toBe(reused);
    });

    it('is stable across calls for the same pid + birth time', () => {
      const a = buildInstanceId({ pid: 7, process: 'claude', startTime: BIRTH });
      const b = buildInstanceId({ pid: 7, process: 'claude', startTime: BIRTH });
      expect(a).toBe(b);
    });

    it('ignores the process name — identity is pid + birth time, not the exe', () => {
      // A pid cannot host two executables at one birth time, so the name adds
      // nothing here; session-tracker composes it separately where it matters.
      expect(buildInstanceId({ pid: 7, process: 'claude', startTime: BIRTH })).toBe(
        buildInstanceId({ pid: 7, process: 'cursor', startTime: BIRTH }),
      );
    });
  });

  describe('space 2 — synthetic (pid 0)', () => {
    it('keys a pid-0 agent by its process name', () => {
      const res = identify({ pid: 0, process: 'ollama', agent: 'Ollama' });
      expect(res.instanceId).toBe('0:ollama');
      expect(res.instanceIdSource).toBe('synthetic');
    });

    it('two synthetic agents with different names do NOT collapse onto one key', () => {
      // wsl-detector / ide-extension-detector / attachModels all register pid 0.
      const ollama = buildInstanceId({ pid: 0, process: 'ollama' });
      const lmStudio = buildInstanceId({ pid: 0, process: 'lm-studio' });
      const grok = buildInstanceId({ pid: 0, process: 'grok', agent: 'grok' });
      const kilo = buildInstanceId({ pid: 0, agent: 'Kilo Code' });
      const keys = new Set([ollama, lmStudio, grok, kilo]);
      expect(keys.size).toBe(4);
    });

    it('falls back to the display name, normalised', () => {
      expect(buildInstanceId({ pid: 0, agent: 'LM Studio' })).toBe('0:lm-studio');
    });

    it('prefers the process name over the display name', () => {
      expect(buildInstanceId({ pid: 0, process: 'lm-studio', agent: 'LM Studio' })).toBe(
        '0:lm-studio',
      );
    });

    it('is stable across calls (an agent card must not churn per tick)', () => {
      expect(buildInstanceId({ pid: 0, process: 'ollama' })).toBe(
        buildInstanceId({ pid: 0, process: 'ollama' }),
      );
    });

    it('ignores a birth time on pid 0 — it has no OS process', () => {
      const res = identify({ pid: 0, process: 'ollama', startTime: BIRTH });
      expect(res.instanceId).toBe('0:ollama');
      expect(res.instanceIdSource).toBe('synthetic');
    });
  });

  describe('space 3 — unknown (no readable birth time)', () => {
    it('degrades to "<pid>:u" when startTime is null (darwin/linux today)', () => {
      const res = identify({ pid: 18324, process: 'claude', startTime: null });
      expect(res.instanceId).toBe('18324:u');
      expect(res.instanceIdSource).toBe('unknown');
    });

    it('degrades when startTime is absent entirely (not yet enriched)', () => {
      expect(buildInstanceId({ pid: 18324, process: 'claude' })).toBe('18324:u');
    });

    it('rejects a non-finite or non-positive birth time', () => {
      for (const bad of [0, -1, NaN, Infinity, '1717000000000', {}]) {
        expect(buildInstanceId({ pid: 5, process: 'claude', startTime: bad })).toBe('5:u');
      }
    });

    it('an unnamed pid-0 entry has nothing to distinguish it by', () => {
      const res = identify({ pid: 0 });
      expect(res.instanceId).toBe('0:u');
      expect(res.instanceIdSource).toBe('unknown');
    });

    it('normalises an unusable pid to 0 rather than embedding NaN', () => {
      for (const bad of [undefined, null, NaN, -3, 1.5, '18324']) {
        const res = identify({ pid: bad, process: 'claude', startTime: BIRTH });
        expect(res.instanceId).toBe('0:u');
        expect(res.instanceIdSource).toBe('unknown');
      }
    });

    it('survives a missing agent object', () => {
      expect(buildInstanceId(undefined)).toBe('0:u');
      expect(buildInstanceId(null)).toBe('0:u');
    });
  });

  describe('value spaces are disjoint', () => {
    it('"<pid>:u" can never equal "<pid>:<epochMs>" for the same pid', () => {
      const os = buildInstanceId({ pid: 42, process: 'claude', startTime: BIRTH });
      const unknown = buildInstanceId({ pid: 42, process: 'claude' });
      expect(os).not.toBe(unknown);
    });

    it('the "0:" namespace belongs to synthetics alone — a real pid never enters it', () => {
      expect(buildInstanceId({ pid: 0, process: 'ollama' })).toBe('0:ollama');
      for (const pid of [1, 42, 18324]) {
        expect(buildInstanceId({ pid, process: 'ollama' }).startsWith('0:')).toBe(false);
        expect(buildInstanceId({ pid, process: 'ollama', startTime: BIRTH }).startsWith('0:')).toBe(
          false,
        );
      }
    });
  });

  describe('instanceIdSource is a closed set', () => {
    it('exposes exactly the three declared sources, frozen', () => {
      expect(INSTANCE_ID_SOURCES).toEqual(['os', 'synthetic', 'unknown']);
      expect(Object.isFrozen(INSTANCE_ID_SOURCES)).toBe(true);
    });

    it('never returns a source outside the set, for any input shape', () => {
      const inputs = [
        { pid: 1, process: 'claude', startTime: BIRTH },
        { pid: 0, process: 'ollama' },
        { pid: 0 },
        { pid: 1, process: 'claude', startTime: null },
        { pid: -1 },
        { pid: NaN, startTime: NaN },
        {},
        undefined,
      ];
      for (const input of inputs) {
        const res = identify(input);
        expect(INSTANCE_ID_SOURCES).toContain(res.instanceIdSource);
        expect(typeof res.instanceId).toBe('string');
        expect(res.instanceId.length).toBeGreaterThan(0);
      }
    });
  });
});
