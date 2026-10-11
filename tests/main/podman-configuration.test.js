import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { createPodmanDiscovery, resolvePodmanConfigPath } = require('../../src/main/podman-scanner');
const { PODMAN_CONFIGURATION_FORMAT } = require('../../src/main/container-configuration');
const id = 'a'.repeat(64);
const metadata = (ids = [id]) =>
  ids
    .map((ID) =>
      JSON.stringify({ ID, Image: 'agent0ai/agent-zero', Names: 'agent', State: 'running' }),
    )
    .join('\n');
const projected = (ID = id, extra = {}) =>
  JSON.stringify({
    ID,
    Running: false,
    Privileged: false,
    ReadonlyRootfs: true,
    NetworkMode: 'bridge',
    PidMode: '',
    ...extra,
  });
const remoteKeys = [
  'CONTAINER_HOST',
  'CONTAINER_CONNECTION',
  'CONTAINER_SSHKEY',
  'CONTAINER_PROXY',
  'PODMAN_CONNECTIONS_CONF',
];
beforeEach(() => {
  for (const key of remoteKeys) vi.stubEnv(key, '');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('Podman bounded configuration observations', () => {
  it('inspects only freshly matched full IDs, at most eight, with native-local guards and no secret projection', async () => {
    vi.stubEnv('CONTAINERS_CONF_OVERRIDE', 'private');
    vi.stubEnv('PODMAN_TRACE', 'private');
    vi.stubEnv('OTEL_ENDPOINT', 'private');
    const ids = Array.from({ length: 10 }, (_, i) => i.toString(16).padStart(64, '0'));
    const calls = [];
    const onUpdate = vi.fn();
    let time = 100;
    const owner = createPodmanDiscovery({
      platform: 'linux',
      now: () => time,
      onUpdate,
      execFile: (file, args, options, callback) => {
        calls.push({ file, args, options });
        queueMicrotask(() => {
          if (args[3] === 'ps') callback(null, metadata(ids));
          else {
            time += 1;
            callback(null, projected(args.at(-1)));
          }
        });
        return { kill: vi.fn() };
      },
    });
    const result = await owner.refresh();
    expect(result).toMatchObject({ status: 'ready', observedAt: 100, stale: false });
    expect(calls).toHaveLength(9);
    expect(result.candidates[0].configuration).toMatchObject({
      status: 'observed',
      observedAt: 101,
      running: false,
      privileged: false,
    });
    expect(result.candidates[8].configuration).toEqual({ status: 'unavailable', observedAt: null });
    expect(PODMAN_CONFIGURATION_FORMAT).toContain('{{json .ID}}');
    expect(PODMAN_CONFIGURATION_FORMAT).not.toMatch(/\.Id|Env|Args|Mounts|Path|Config\.Cmd/);
    for (const { file, args, options } of calls.slice(1)) {
      expect(file).toBe('/usr/bin/podman');
      expect(args).toEqual([
        '--remote=false',
        '--events-backend=none',
        '--trace=false',
        'container',
        'inspect',
        '--format',
        PODMAN_CONFIGURATION_FORMAT,
        args.at(-1),
      ]);
      expect(ids.slice(0, 8)).toContain(args.at(-1));
      expect(options).toMatchObject({ maxBuffer: 4096, shell: false, killSignal: 'SIGKILL' });
      expect(options.timeout).toBeGreaterThan(0);
      expect(options.timeout).toBeLessThanOrEqual(3000);
      expect(options.env.CONTAINERS_CONF_OVERRIDE).toBe(resolvePodmanConfigPath());
      expect(options.env.PODMAN_TRACE).toBeUndefined();
      expect(options.env.OTEL_ENDPOINT).toBeUndefined();
    }
    result.candidates[0].configuration.privileged = true;
    onUpdate.mock.calls[0][0].candidates[1].configuration.running = true;
    expect(owner.snapshot().candidates[0].configuration.privileged).toBe(false);
    expect(owner.snapshot().candidates[1].configuration.running).toBe(false);
    owner.stop();
    expect(owner.snapshot().stale).toBe(true);
  });

  it.each([
    projected('b'.repeat(64)),
    projected(id, { Env: ['SECRET'] }),
    projected(id, { Privileged: 'false' }),
    projected(id, { NetworkMode: 'bad\nname' }),
    projected() + '\n' + projected(),
    ' '.repeat(4097),
    new Error('SECRET path'),
  ])(
    'keeps candidate metadata while invalid/failed inspection is unavailable',
    async (inspection) => {
      const owner = createPodmanDiscovery({
        platform: 'linux',
        execFile: (file, args, options, cb) => {
          cb(
            inspection instanceof Error && args.includes('inspect') ? inspection : null,
            args[3] === 'ps' ? metadata() : inspection,
          );
          return { kill: vi.fn() };
        },
      });
      const result = await owner.refresh();
      expect(result).toMatchObject({
        status: 'ready',
        candidates: [{ configuration: { status: 'unavailable', observedAt: null } }],
      });
      expect(JSON.stringify(result)).not.toContain('SECRET');
    },
  );

  it.each(['remote-selector', 'overlay'])(
    'revalidates %s before each inspect and stops the batch on change',
    async (change) => {
      const read = fs.readFileSync.bind(fs);
      let inspections = 0;
      if (change === 'overlay')
        vi.spyOn(fs, 'readFileSync').mockImplementation((file, ...args) =>
          inspections && file === resolvePath ? '[engine]\nremote = true\n' : read(file, ...args),
        );
      const resolvePath = resolvePodmanConfigPath();
      const owner = createPodmanDiscovery({
        platform: 'linux',
        execFile: (file, args, options, cb) => {
          if (args[3] === 'ps') cb(null, metadata([id, 'b'.repeat(64)]));
          else {
            inspections += 1;
            if (change === 'remote-selector') vi.stubEnv('CONTAINER_CONNECTION', 'private');
            cb(null, projected(args.at(-1)));
          }
          return { kill: vi.fn() };
        },
      });
      const result = await owner.refresh();
      expect(inspections).toBe(1);
      expect(result.candidates.map((row) => row.configuration.status)).toEqual([
        'observed',
        'unavailable',
      ]);
    },
  );

  it.each(['timeout', 'stop'])(
    'bounds stalled inspection and suppresses late callback on %s',
    async (action) => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      let late;
      const kill = vi.fn();
      const onUpdate = vi.fn();
      const execFile = vi.fn((file, args, options, cb) => {
        if (args[3] === 'ps') cb(null, metadata([id, 'b'.repeat(64)]));
        else late = cb;
        return { kill };
      });
      const owner = createPodmanDiscovery({ platform: 'linux', execFile, onUpdate });
      const pending = owner.refresh();
      await Promise.resolve();
      await Promise.resolve();
      if (action === 'stop') owner.stop();
      else await vi.advanceTimersByTimeAsync(3000);
      const result = await pending;
      expect(execFile).toHaveBeenCalledTimes(2);
      expect(kill).toHaveBeenCalledExactlyOnceWith('SIGKILL');
      expect(vi.getTimerCount()).toBe(0);
      late(null, projected());
      if (action === 'stop') {
        expect(result.candidates).toEqual([]);
        expect(onUpdate).not.toHaveBeenCalled();
      } else {
        expect(result.status).toBe('ready');
        expect(result.candidates.every((row) => row.configuration.status === 'unavailable')).toBe(
          true,
        );
        expect(onUpdate).toHaveBeenCalledOnce();
      }
    },
  );
});

it('shares one monotonic 3s budget across serial inspections', async () => {
  let clock = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
  const calls = [];
  const owner = createPodmanDiscovery({
    platform: 'linux',
    execFile: (file, args, options, cb) => {
      if (args[3] === 'ps')
        cb(null, metadata([id, 'b'.repeat(64), 'c'.repeat(64), 'd'.repeat(64)]));
      else {
        calls.push(options.timeout);
        clock += 1100;
        cb(null, projected(args.at(-1)));
      }
      return { kill: vi.fn() };
    },
  });
  const result = await owner.refresh();
  expect(calls).toEqual([3000, 1900, 800]);
  expect(result.candidates[3].configuration).toEqual({ status: 'unavailable', observedAt: null });
});
