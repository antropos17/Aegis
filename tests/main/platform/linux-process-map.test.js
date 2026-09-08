import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import readerModule from '../../../src/main/platform/linux-process-map.js';
import scanner from '../../../src/main/process-scanner.js';
import utils from '../../../src/main/process-utils.js';
import sessions from '../../../src/main/session-tracker.js';

const BOOT_ID = '11111111-1111-4111-8111-111111111111';
const BOOT_PATH = '/proc/sys/kernel/random/boot_id';
const BOOT_SECONDS = 1700000000;

function stat(pid, name, ppid, ticks) {
  const fields = Array(20).fill('0');
  fields[0] = 'S';
  fields[1] = String(ppid);
  fields[19] = String(ticks);
  return `${pid} (${name}) ${fields.join(' ')}\n`;
}

describe('Linux procfs birth observations', () => {
  let files;
  let fs;
  let exec;
  let reader;

  beforeEach(() => {
    files = new Map([
      [BOOT_PATH, BOOT_ID],
      ['/proc/stat', `cpu 1 2 3\nbtime ${BOOT_SECONDS}\n`],
      ['/proc/100/stat', stat(100, 'claude', 200, 12345)],
      ['/proc/200/stat', stat(200, 'node', 1, 10000)],
    ]);
    fs = {
      readdirSync: vi.fn(() => ['100', '200', 'self', 'stat']),
      readFileSync: vi.fn((file) => {
        if (!files.has(file)) throw Object.assign(Error('gone'), { code: 'ENOENT' });
        const value = files.get(file);
        if (value instanceof Error) throw value;
        return value;
      }),
    };
    exec = vi.fn((cmd, _args, _opts, cb) => {
      cb(null, cmd === 'getconf' ? '100\n' : '100 200 claude\n200 1 node\n');
    });
    reader = readerModule.createProcessMapReader({ fs, execFile: exec });
  });

  it('uses the observed CLK_TCK and field 22 rather than an assumed frequency', async () => {
    exec.mockImplementation((_cmd, _args, _opts, cb) => cb(null, '250\n'));
    expect(reader.getSnapshotHealth().state).toBe('STARTING');
    const map = await reader.getParentProcessMap();
    expect(map.get(100)).toEqual({
      name: 'claude',
      ppid: 200,
      startTime: BOOT_SECONDS * 1000 + 49380,
      witness: `${BOOT_ID}:12345`,
      witnessSource: 'linuxStartTicks',
    });
    expect(exec).toHaveBeenCalledWith(
      'getconf',
      ['CLK_TCK'],
      expect.objectContaining({ timeout: 5000 }),
      expect.any(Function),
    );
    expect(reader.getSnapshotHealth().state).toBe('HEALTHY');
  });

  afterEach(() => {
    scanner._resetForTest();
    utils._resetForTest();
    sessions._resetForTest();
  });

  it('stamps real scan identities, freezes an outage and observes replacement after recovery', async () => {
    scanner._resetForTest();
    utils._resetForTest();
    sessions._resetForTest();
    scanner._setPlatformForTest({ providesStartTime: true, ...reader });
    utils._setPlatformForTest({ providesStartTime: true });
    async function pass() {
      const result = await scanner.scanProcesses({ sharedObservation: true });
      await utils.enrichWithParentChains(result.agents, { processMap: result.processMap });
      return result.agents;
    }
    const first = await pass();
    expect(first[0]).toMatchObject({
      instanceIdSource: 'os',
      generationWitnessSource: 'linuxStartTicks',
    });
    expect(sessions.reconcile(first).entered).toHaveLength(1);
    const original = files.get('/proc/100/stat');
    files.set('/proc/100/stat', 'invalid');
    const outage = await pass();
    expect(outage[0].startTime).toBeNull();
    expect(scanner.isIdentityDegraded()).toBe(true);
    expect(sessions.reconcile(outage, { identityDegraded: scanner.isIdentityDegraded() })).toEqual({
      entered: [],
      exited: [],
    });
    files.set('/proc/100/stat', original);
    const recovered = await pass();
    expect(scanner.isIdentityDegraded()).toBe(false);
    expect(recovered[0].instanceId).toBe(first[0].instanceId);
    expect(sessions.reconcile(recovered)).toEqual({ entered: [], exited: [] });
    files.set('/proc/100/stat', stat(100, 'claude', 200, 12346));
    const replacement = await pass();
    expect(replacement[0].instanceId).not.toBe(first[0].instanceId);
    expect(sessions.reconcile(replacement).entered).toHaveLength(1);
  });

  it('re-observes PID reuse inside the cache TTL and cannot serve a mutated old map', async () => {
    const first = await reader.getParentProcessMap();
    first.get(100).name = 'poisoned';
    files.set('/proc/100/stat', stat(100, 'claude', 200, 12346));
    const second = await reader.getParentProcessMap();
    expect(second.get(100)).toMatchObject({
      name: 'claude',
      startTime: BOOT_SECONDS * 1000 + 123460,
      witness: `${BOOT_ID}:12346`,
    });
    expect(exec).toHaveBeenCalledTimes(1);
    expect(fs.readFileSync.mock.calls.filter(([p]) => p === '/proc/100/stat')).toHaveLength(2);
  });

  it('parses comm containing parentheses, a state-looking substring and a newline', async () => {
    files.set('/proc/100/stat', stat(100, 'a) R 99\n (b)', 200, 12345));
    expect((await reader.getParentProcessMap()).get(100)).toMatchObject({
      name: 'a) R 99\n (b)',
      ppid: 200,
      startTime: BOOT_SECONDS * 1000 + 123450,
    });
  });

  it('keeps the same boot reference over a wall-clock adjustment', async () => {
    const first = await reader.getParentProcessMap();
    files.set('/proc/stat', `btime ${BOOT_SECONDS + 3600}\n`);
    const second = await reader.getParentProcessMap();
    expect(second.get(100)).toEqual(first.get(100));
  });

  it('binds the reference and witness to the observed boot ID', async () => {
    const first = await reader.getParentProcessMap();
    const nextBoot = '22222222-2222-4222-8222-222222222222';
    files.set(BOOT_PATH, nextBoot);
    files.set('/proc/stat', `btime ${BOOT_SECONDS + 10000}\n`);
    const second = await reader.getParentProcessMap();
    expect(second.get(100).witness).toBe(`${nextBoot}:12345`);
    expect(second.get(100).startTime).toBe(first.get(100).startTime + 10000000);
  });

  it('skips a PID that exits during enumeration without losing valid peers', async () => {
    files.delete('/proc/100/stat');
    expect([...(await reader.getParentProcessMap()).keys()]).toEqual([200]);
    expect(reader.getSnapshotHealth().state).toBe('HEALTHY');
  });

  it.each([
    ['denied stat', '/proc/100/stat', Object.assign(Error('private path'), { code: 'EACCES' })],
    ['truncated stat', '/proc/100/stat', '100 (claude) S 200'],
    ['wrong PID', '/proc/100/stat', stat(101, 'claude', 200, 12345)],
    ['unsafe birth time', '/proc/100/stat', stat(100, 'claude', 200, '999999999999999999999')],
    ['invalid boot time', '/proc/stat', 'btime 1e9\n'],
    ['invalid boot ID', BOOT_PATH, 'not-a-boot-id'],
  ])(
    '%s yields population-only fallback and failed identity, then recovers',
    async (_label, file, value) => {
      const original = files.get(file);
      const first = await reader.getParentProcessMap();
      files.set(file, value);
      const failed = await reader.getParentProcessMap();
      expect(
        [...failed.values()].every((p) => p.startTime === null && p.witness === undefined),
      ).toBe(true);
      expect(reader.getSnapshotHealth()).toMatchObject({
        state: 'FAILED',
        lastError: 'linux-proc-identity-unavailable',
      });
      expect(JSON.stringify(reader.getSnapshotHealth())).not.toContain('private path');
      files.set(file, original);
      expect((await reader.getParentProcessMap()).get(100)).toEqual(first.get(100));
      expect(reader.getSnapshotHealth().state).toBe('HEALTHY');
    },
  );

  it('retries an unavailable clock-frequency probe and never assumes 100', async () => {
    exec.mockImplementationOnce((_cmd, _args, _opts, cb) => cb(Error('missing')));
    const failed = await reader.getParentProcessMap();
    expect(failed.get(100).startTime).toBeNull();
    expect(reader.getSnapshotHealth().state).toBe('FAILED');
    expect((await reader.getParentProcessMap()).get(100).startTime).toBe(
      BOOT_SECONDS * 1000 + 123450,
    );
    expect(exec.mock.calls.filter(([cmd]) => cmd === 'getconf')).toHaveLength(2);
  });

  it('returns an empty failed observation when procfs and ps both fail', async () => {
    fs.readdirSync.mockImplementation(() => {
      throw Error('proc unavailable');
    });
    exec.mockImplementation((cmd, _args, _opts, cb) =>
      cmd === 'getconf' ? cb(null, '100') : cb(Error('ps unavailable')),
    );
    expect((await reader.getParentProcessMap()).size).toBe(0);
    expect(reader.getSnapshotHealth().state).toBe('FAILED');
  });
});
