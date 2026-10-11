import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {
  parseConfiguration,
  CONFIGURATION_FORMAT,
} = require('../../src/main/container-configuration');
const { createDockerDiscovery } = require('../../src/main/container-scanner');
const id = 'a'.repeat(64);
const projected = (ID = id, extra = {}) =>
  JSON.stringify({
    ID,
    Running: true,
    Privileged: false,
    ReadonlyRootfs: true,
    NetworkMode: 'bridge',
    PidMode: '',
    ...extra,
  });
const ps = (ids = [id]) =>
  ids
    .map((ID) =>
      JSON.stringify({
        ID,
        Image: 'agent0ai/agent-zero',
        Names: 'agent-zero',
      }),
    )
    .join('\n');
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('Docker configuration observations', () => {
  it('retains only normalized configuration fields and never projects secrets', () => {
    expect(parseConfiguration(projected(), id, 42)).toEqual({
      status: 'observed',
      observedAt: 42,
      running: true,
      privileged: false,
      readOnlyRootFilesystem: true,
      networkMode: 'bridge',
      pidMode: 'private',
    });
    const result = parseConfiguration(
      projected(id, {
        NetworkMode: 'private-network',
        PidMode: `container:${'b'.repeat(64)}`,
      }),
      id,
      42,
    );
    expect(result).toMatchObject({ networkMode: 'other', pidMode: 'container' });
    expect(JSON.stringify(result)).not.toMatch(/private-network|bbbb/);
    expect(CONFIGURATION_FORMAT).not.toMatch(/Env|Args|Mounts|Path|Config\.Cmd/);
  });
  it.each([
    projected('b'.repeat(64)),
    projected(id, { Env: ['SECRET=private'] }),
    projected(id, { Privileged: 'false' }),
    projected(id, { PidMode: 'host\nsecret' }),
    projected() + '\n' + projected(),
    ' '.repeat(4097),
    '{}',
  ])('rejects malformed, mismatched or expanded projection', (output) => {
    expect(parseConfiguration(output, id, 42)).toBeNull();
  });
  it('bounds candidate inspection and keeps independent partial results on the selected endpoint', async () => {
    vi.stubEnv('DOCKER_HOST', '');
    vi.stubEnv('DOCKER_CONTEXT', 'remote');
    const ids = Array.from({ length: 10 }, (_, index) => index.toString(16).padStart(64, '0'));
    const calls = [];
    const discovery = createDockerDiscovery({
      platform: 'linux',
      now: () => 42,
      execFile: (file, args, options, callback) => {
        calls.push({ args, options });
        queueMicrotask(() => {
          if (args[2] === 'ps') callback(null, ps(ids));
          else if (args.at(-1) === ids[1]) callback(new Error('SECRET private path'));
          else callback(null, projected(args.at(-1)));
        });
        return { kill: vi.fn() };
      },
    });
    const result = await discovery.refresh();
    expect(result.status).toBe('ready');
    expect(calls).toHaveLength(9);
    expect(result.candidates[0].configuration.status).toBe('observed');
    expect(result.candidates[1].configuration).toEqual({ status: 'unavailable', observedAt: null });
    expect(result.candidates[8].configuration.status).toBe('unavailable');
    for (const { args, options } of calls.slice(1)) {
      expect(args.slice(0, 5)).toEqual([
        '--host',
        'unix:///var/run/docker.sock',
        'container',
        'inspect',
        '--format',
      ]);
      expect(options.maxBuffer).toBe(4096);
      expect(options.env.DOCKER_CONTEXT).toBeUndefined();
    }
    result.candidates[0].configuration.privileged = true;
    expect(discovery.snapshot().candidates[0].configuration.privileged).toBe(false);
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });
  it.each(['timeout', 'stop'])('settles and suppresses late inspection on %s', async (action) => {
    vi.stubEnv('DOCKER_HOST', '');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let late;
    const kill = vi.fn();
    const onUpdate = vi.fn();
    const discovery = createDockerDiscovery({
      platform: 'linux',
      onUpdate,
      execFile: (file, args, options, callback) => {
        if (args[2] === 'ps') callback(null, ps([id, 'b'.repeat(64)]));
        else late = callback;
        return { kill };
      },
    });
    const pending = discovery.refresh();
    await Promise.resolve();
    await Promise.resolve();
    if (action === 'stop') discovery.stop();
    else await vi.advanceTimersByTimeAsync(3000);
    const result = await pending;
    expect(kill).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    late(null, projected());
    if (action === 'stop') {
      expect(result.candidates).toEqual([]);
      expect(onUpdate).not.toHaveBeenCalled();
    } else {
      expect(result.status).toBe('ready');
      expect(
        result.candidates.every((candidate) => candidate.configuration.status === 'unavailable'),
      ).toBe(true);
      expect(onUpdate).toHaveBeenCalledOnce();
    }
  });
});
