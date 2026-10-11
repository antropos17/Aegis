import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createPodmanDiscovery, resolvePodmanConfigPath } = require('../../src/main/podman-scanner');
const firstId = 'a'.repeat(64);
const secondId = 'b'.repeat(64);
const row = (
  Image = 'agent0ai/agent-zero:latest',
  ID = firstId,
  Names = 'agent-zero',
  State = 'running',
) => JSON.stringify({ ID, Image, Names, State });
const resourceContent = '[engine]\nremote = false\nenv = [{append = false}]\n';
const remoteKeys = [
  'CONTAINER_HOST',
  'CONTAINER_CONNECTION',
  'CONTAINER_SSHKEY',
  'CONTAINER_PROXY',
  'PODMAN_CONNECTIONS_CONF',
];
let fixture;

function harness(replies = [], options = {}) {
  let time = 1000;
  const kill = vi.fn();
  const onUpdate = vi.fn();
  const execFile = vi.fn((file, args, settings, callback) => {
    const reply = args.includes('inspect')
      ? new Error('configuration unavailable')
      : replies.shift();
    if (reply !== undefined)
      queueMicrotask(() =>
        callback(reply instanceof Error ? reply : null, reply, 'private stderr'),
      );
    return { kill };
  });
  const discovery = createPodmanDiscovery({
    execFile,
    now: () => time,
    platform: 'linux',
    onUpdate,
    ...options,
  });
  return {
    discovery,
    execFile,
    kill,
    onUpdate,
    advance: (value) => {
      time = value;
    },
  };
}

beforeEach(() => {
  for (const key of remoteKeys) vi.stubEnv(key, '');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  if (fixture) {
    const file = path.join(fixture, 'podman-local.conf');
    if (fs.existsSync(file)) fs.unlinkSync(file);
    fs.rmdirSync(fixture);
    fixture = undefined;
  }
});

describe('Podman metadata discovery', () => {
  it('keeps snapshot passive and copies only metadata candidate fields', async () => {
    const { discovery, execFile, onUpdate } = harness([row()]);
    expect(discovery.snapshot()).toEqual({
      status: 'pending',
      reason: null,
      observedAt: null,
      attemptedAt: null,
      stale: true,
      candidates: [],
    });
    expect(execFile).not.toHaveBeenCalled();
    await discovery.refresh();
    const candidate = {
      id: `podman:${firstId}`,
      containerId: firstId,
      name: 'agent-zero',
      image: 'agent0ai/agent-zero:latest',
      agent: 'Agent Zero',
      match: 'image',
      runtime: 'podman',
      configuration: { status: 'unavailable', observedAt: null },
    };
    expect(discovery.snapshot().candidates).toEqual([candidate]);
    discovery.snapshot().candidates[0].name = 'mutated';
    onUpdate.mock.calls[0][0].candidates[0].name = 'mutated callback';
    expect(discovery.snapshot().candidates).toEqual([candidate]);
    expect(JSON.stringify(discovery.snapshot())).not.toMatch(/private|Pid|pid|risk|kill|State/);
  });

  it.each([
    ['agent0ai/agent-zero', 'Agent Zero'],
    ['docker.io/agent0ai/agent-zero:v2.0', 'Agent Zero'],
    ['index.docker.io/agent0ai/agent-zero:v2.0', 'Agent Zero'],
    ['ghcr.io/openclaw/openclaw:latest-browser', 'OpenClaw'],
    ['openclaw/openclaw@sha256:' + '1'.repeat(64), 'OpenClaw'],
    ['ghcr.io/openhands/agent-canvas:1.24.0', 'OpenHands'],
  ])('recognizes official repository %s', async (image, agent) => {
    const { discovery } = harness([row(image)]);
    await discovery.refresh();
    expect(discovery.snapshot()).toMatchObject({
      status: 'ready',
      stale: false,
      candidates: [{ image, agent }],
    });
  });

  it.each([
    'other/agent-zero',
    'agent0ai/agent-zero-base',
    'ghcr.io/openhands/agent-canvas-spoof:latest',
    'ghcr.io/openhands/agent-server:latest',
    'ollama/ollama',
    'vllm/vllm-openai',
    'registry.example:5000/agent0ai/agent-zero',
    'docker.io/ghcr.io/openclaw/openclaw:latest',
    'index.docker.io/ghcr.io/openhands/agent-canvas:1.0',
    'openclaw:local',
    'agent0ai/agent-zero@sha256:invalid',
    'agent0ai/agent-zero:',
    'Agent0ai/agent-zero',
  ])('does not infer activity or an agent from %s', async (image) => {
    const { discovery } = harness([row(image)]);
    await discovery.refresh();
    expect(discovery.snapshot()).toMatchObject({ status: 'ready', candidates: [] });
  });

  it('sorts distinct full IDs and ignores stopped/paused rows even if CLI filtering races', async () => {
    const { discovery } = harness([
      row(undefined, secondId) +
        '\n' +
        row() +
        '\n' +
        row(undefined, 'c'.repeat(64), 'paused', 'paused') +
        '\n' +
        row(undefined, 'd'.repeat(64), 'stopped', 'stopped'),
    ]);
    await discovery.refresh();
    expect(discovery.snapshot().candidates.map((candidate) => candidate.id)).toEqual([
      `podman:${firstId}`,
      `podman:${secondId}`,
    ]);
  });

  it('uses only the fixed native executable, local engine guards and narrow projection', async () => {
    for (const key of remoteKeys) vi.stubEnv(key.toLowerCase(), '');
    for (const key of [
      'CONTAINERS_CONF_OVERRIDE',
      'containers_conf_override',
      'OTEL_EXPORTER_OTLP_ENDPOINT',
      'PODMAN_OTEL_ENDPOINT',
      'PODMAN_TRACE',
      'JAEGER_ENDPOINT',
      'DOCKER_CLI_OTEL_ENDPOINT',
      'TRACEPARENT',
      'TRACESTATE',
    ])
      vi.stubEnv(key, 'private');
    vi.stubEnv('CONTAINERS_CONF', '/existing/local-storage.conf');
    const { discovery, execFile } = harness(['']);
    await discovery.refresh();
    const [file, args, settings] = execFile.mock.calls[0];
    expect(file).toBe('/usr/bin/podman');
    expect(args).toEqual([
      '--remote=false',
      '--events-backend=none',
      '--trace=false',
      'ps',
      '--no-trunc',
      '--filter',
      'status=running',
      '--format',
      '{"ID":{{json .ID}},"Image":{{json .Image}},"Names":{{json .Names}},"State":{{json .State}}}',
    ]);
    expect(args.join(' ')).not.toMatch(
      /Pid|Command|Labels|Mounts|Networks|inspect|exec|start|machine|ssh|sync/,
    );
    expect(settings).toMatchObject({
      timeout: 3000,
      killSignal: 'SIGKILL',
      maxBuffer: 524288,
      windowsHide: true,
      shell: false,
      encoding: 'utf8',
    });
    expect(settings.env.CONTAINERS_CONF_OVERRIDE).toBe(resolvePodmanConfigPath());
    expect(
      fs.readFileSync(settings.env.CONTAINERS_CONF_OVERRIDE, 'utf8').replace(/\r\n/g, '\n'),
    ).toBe(resourceContent);
    expect(settings.env.CONTAINERS_CONF).toBe('/existing/local-storage.conf');
    for (const key of Object.keys(settings.env))
      if (key !== 'CONTAINERS_CONF_OVERRIDE')
        expect(key).not.toMatch(
          /^(?:CONTAINER_(?:HOST|CONNECTION|SSHKEY|PROXY)$|PODMAN_CONNECTIONS_CONF$|CONTAINERS_CONF_OVERRIDE$|PODMAN_(?:OTEL_|TRACE)|DOCKER_CLI_OTEL_|OTEL_|TRACEPARENT$|TRACESTATE$|JAEGER_)/i,
        );
    expect(process.env.CONTAINERS_CONF_OVERRIDE).toBe('private');
  });

  it.each(['win32', 'darwin', 'freebsd'])(
    'never starts a VM, remote client or CLI on %s',
    async (platform) => {
      const { discovery, execFile } = harness([row()], { platform });
      await discovery.refresh();
      expect(execFile).not.toHaveBeenCalled();
      expect(discovery.snapshot()).toMatchObject({
        status: 'unavailable',
        reason: 'unsupported-platform',
        observedAt: null,
        stale: true,
      });
    },
  );

  it.each([...remoteKeys, 'container_host', 'container_connection'])(
    'refuses explicit remote selector %s before spawn',
    async (key) => {
      vi.stubEnv(key, 'private remote config');
      const { discovery, execFile } = harness([row()]);
      await discovery.refresh();
      expect(execFile).not.toHaveBeenCalled();
      expect(discovery.snapshot()).toMatchObject({
        status: 'unavailable',
        reason: 'remote-config',
        observedAt: null,
        candidates: [],
      });
      expect(JSON.stringify(discovery.snapshot())).not.toContain('private');
    },
  );

  it.each([
    [Object.assign(new Error('private missing'), { code: 'ENOENT' }), 'cli-missing'],
    [Object.assign(new Error('private timeout'), { killed: true }), 'timeout'],
    [Object.assign(new Error('private timeout'), { code: 'ETIMEDOUT' }), 'timeout'],
    [
      Object.assign(new Error('private oversized'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }),
      'invalid-output',
    ],
    [Object.assign(new Error('private runtime'), { code: 125 }), 'runtime-unavailable'],
  ])('sanitizes failures into fixed reasons', async (error, reason) => {
    const { discovery, execFile } = harness([error]);
    await discovery.refresh();
    expect(execFile).toHaveBeenCalledTimes(1);
    expect(discovery.snapshot()).toMatchObject({ status: 'unavailable', reason, stale: true });
    expect(JSON.stringify(discovery.snapshot())).not.toContain('private');
  });

  it.each([
    'not JSON',
    '[]',
    'null',
    '{"ID":"abc"}',
    row(undefined, 'a'.repeat(12)),
    row(undefined, 'A'.repeat(64)),
    row(undefined, firstId + '\n'),
    row() + '\n' + row(),
    row() + '\nnot JSON',
    row(undefined, firstId, 'bad\nname'),
    row(undefined, firstId, 'agent\n'),
    row(undefined, firstId, 'agent\r'),
    row(undefined, firstId, ['array-name']),
    row(undefined, firstId, 'agent,alias'),
    row(undefined, firstId, 'web/agent'),
    row(undefined, firstId, 'a'.repeat(256)),
    row('agent0ai/agent-zero\n'),
    row('', firstId),
    row('a'.repeat(513)),
    row(undefined, firstId, 'agent', 'unexpected-state'),
    row(undefined, firstId, 'agent', ['running']),
    JSON.stringify({ ID: firstId, Image: 'agent0ai/agent-zero', Names: 'agent' }),
    JSON.stringify({
      ID: firstId,
      Image: 'agent0ai/agent-zero',
      Names: 'agent',
      State: 'running',
      Pid: 123,
    }),
    JSON.stringify({
      ID: firstId,
      Image: 'agent0ai/agent-zero',
      Names: 'agent',
      State: 'running',
      Command: 'private',
    }),
    ' '.repeat(524289),
    Array.from({ length: 1025 }, (_, index) =>
      row('other/image', index.toString(16).padStart(64, '0')),
    ).join('\n'),
    ['full JSON array'],
    null,
  ])('fails the entire malformed or oversized observation', async (output) => {
    const { discovery } = harness([output]);
    await discovery.refresh();
    expect(discovery.snapshot()).toMatchObject({
      status: 'unavailable',
      reason: 'invalid-output',
      observedAt: null,
      candidates: [],
    });
  });

  it('accepts the 1024-row limit without relaxing the projection', async () => {
    const output = Array.from({ length: 1024 }, (_, index) =>
      row('other/image', index.toString(16).padStart(64, '0')),
    ).join('\n');
    const { discovery } = harness([output]);
    await discovery.refresh();
    expect(discovery.snapshot()).toMatchObject({ status: 'ready', candidates: [] });
  });

  it('coalesces refreshes and leaves snapshot reads synchronous', async () => {
    const { discovery, execFile } = harness();
    const first = discovery.refresh();
    expect(discovery.refresh()).toBe(first);
    expect(discovery.snapshot()).toMatchObject({ status: 'pending', attemptedAt: 1000 });
    await Promise.resolve();
    expect(execFile).toHaveBeenCalledTimes(1);
    execFile.mock.calls[0][3](null, row());
    await first;
    expect(discovery.snapshot().status).toBe('ready');
  });

  it('throttles at 30s, retains stale rows on failure and clears on successful empty', async () => {
    const { discovery, execFile, advance, onUpdate } = harness([
      row(),
      Object.assign(new Error('private'), { code: 125 }),
      '',
    ]);
    await discovery.refresh();
    advance(30999);
    await discovery.refresh();
    expect(execFile).toHaveBeenCalledTimes(2);
    advance(31000);
    await discovery.refresh();
    expect(discovery.snapshot()).toMatchObject({
      status: 'unavailable',
      reason: 'runtime-unavailable',
      observedAt: 1000,
      attemptedAt: 31000,
      stale: true,
      candidates: [{ containerId: firstId }],
    });
    advance(61000);
    await discovery.refresh();
    expect(discovery.snapshot()).toEqual({
      status: 'ready',
      reason: null,
      observedAt: 61000,
      attemptedAt: 61000,
      stale: false,
      candidates: [],
    });
    expect(onUpdate).toHaveBeenCalledTimes(3);
  });

  it('retains prior rows if remote configuration appears after local success', async () => {
    const { discovery, execFile, advance } = harness([row()]);
    await discovery.refresh();
    vi.stubEnv('CONTAINER_HOST', 'ssh://private');
    advance(31000);
    await discovery.refresh();
    expect(execFile).toHaveBeenCalledTimes(2);
    expect(discovery.snapshot()).toMatchObject({
      status: 'unavailable',
      reason: 'remote-config',
      observedAt: 1000,
      stale: true,
      candidates: [{ containerId: firstId }],
    });
  });

  it('expires observations at 90s and marks clock rollback stale', async () => {
    const { discovery, advance } = harness([row()]);
    await discovery.refresh();
    advance(90999);
    expect(discovery.snapshot().stale).toBe(false);
    advance(91000);
    expect(discovery.snapshot().stale).toBe(true);
    advance(999);
    expect(discovery.snapshot().stale).toBe(true);
  });

  it('never rejects synchronous spawn or observer callback errors', async () => {
    const { discovery } = harness([], {
      execFile: () => {
        throw new Error('private');
      },
      onUpdate: () => {
        throw new Error('private');
      },
    });
    await expect(discovery.refresh()).resolves.toMatchObject({
      status: 'unavailable',
      reason: 'runtime-unavailable',
    });
    expect(JSON.stringify(discovery.snapshot())).not.toContain('private');
  });

  it('supports a synchronous CLI callback without keeping an already settled child', async () => {
    vi.useFakeTimers();
    const kill = vi.fn();
    const { discovery } = harness([], {
      execFile: (file, args, settings, callback) => {
        callback(null, row());
        return { kill };
      },
    });
    await discovery.refresh();
    discovery.stop();
    expect(kill).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('settles the deadline for a CLI ignoring SIGTERM, ignores late results and allows retry', async () => {
    vi.useFakeTimers();
    const { discovery, execFile, kill, onUpdate, advance } = harness([row(), undefined, '']);
    // This simulated child never invokes its exit callback and ignores the
    // default signal; only explicit SIGKILL terminates it.
    kill.mockImplementation((signal = 'SIGTERM') => signal === 'SIGKILL');
    await discovery.refresh();
    expect(vi.getTimerCount()).toBe(0);
    advance(31000);
    const pending = discovery.refresh();
    let settled = false;
    pending.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(2999);
    expect(settled).toBe(false);
    expect(kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toMatchObject({
      status: 'unavailable',
      reason: 'timeout',
      observedAt: 1000,
      stale: true,
      candidates: [{ containerId: firstId }],
    });
    expect(kill).toHaveBeenCalledExactlyOnceWith('SIGKILL');
    expect(vi.getTimerCount()).toBe(0);
    execFile.mock.calls[2][3](null, row(undefined, secondId));
    expect(discovery.snapshot()).toMatchObject({
      reason: 'timeout',
      candidates: [{ containerId: firstId }],
    });
    expect(onUpdate).toHaveBeenCalledTimes(2);
    advance(61000);
    await discovery.refresh();
    expect(execFile).toHaveBeenCalledTimes(4);
    expect(discovery.snapshot()).toMatchObject({ status: 'ready', candidates: [] });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('settles timeout even if killing its owned CLI throws', async () => {
    vi.useFakeTimers();
    const { discovery, kill, execFile } = harness();
    kill.mockImplementation(() => {
      throw new Error('private termination error');
    });
    const pending = discovery.refresh();
    await vi.advanceTimersByTimeAsync(3000);
    await expect(pending).resolves.toMatchObject({ status: 'unavailable', reason: 'timeout' });
    execFile.mock.calls[0][3](null, row());
    expect(discovery.snapshot().candidates).toEqual([]);
    expect(JSON.stringify(discovery.snapshot())).not.toContain('private');
  });

  it('a deadline kills only its own CLI while another observer remains active', async () => {
    vi.useFakeTimers();
    const processKill = vi.spyOn(process, 'kill');
    const first = harness();
    const firstPending = first.discovery.refresh();
    await vi.advanceTimersByTimeAsync(1000);
    const second = harness();
    const secondPending = second.discovery.refresh();
    await vi.advanceTimersByTimeAsync(2000);
    await firstPending;
    expect(first.kill).toHaveBeenCalledExactlyOnceWith('SIGKILL');
    expect(second.kill).not.toHaveBeenCalled();
    expect(processKill).not.toHaveBeenCalled();
    second.execFile.mock.calls[0][3](null, row());
    await secondPending;
    expect(second.discovery.snapshot().status).toBe('ready');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stop cancels only its owned CLI and suppresses late results', async () => {
    vi.useFakeTimers();
    const { discovery, execFile, kill, onUpdate } = harness();
    const pending = discovery.refresh();
    await Promise.resolve();
    discovery.stop();
    discovery.stop();
    await pending;
    execFile.mock.calls[0][3](null, row());
    await discovery.refresh();
    expect(kill).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledWith('SIGKILL');
    expect(onUpdate).not.toHaveBeenCalled();
    expect(execFile).toHaveBeenCalledTimes(1);
    expect(discovery.snapshot().candidates).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(3000);
    expect(kill).toHaveBeenCalledTimes(1);
  });

  it('stop before the queued refresh prevents any spawn', async () => {
    const { discovery, execFile, onUpdate } = harness([row()]);
    const pending = discovery.refresh();
    discovery.stop();
    await pending;
    expect(execFile).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();
  });
});

describe('Podman local configuration resource', () => {
  it('packages the overlay as a real Linux extraResource', () => {
    const pkg = require('../../package.json');
    expect(pkg.build.linux.extraResources).toContainEqual({
      from: 'src/main/podman-local.conf',
      to: 'podman-local.conf',
    });
    expect(resolvePodmanConfigPath()).toBe(path.resolve('src/main/podman-local.conf'));
  });

  it('uses the packaged resource beside resourcesPath and refuses missing or altered overlay', () => {
    fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-podman-'));
    const runtime = { resourcesPath: fixture, defaultApp: false };
    const file = path.join(fixture, 'podman-local.conf');
    expect(resolvePodmanConfigPath(runtime, '/app/resources/app.asar/src/main')).toBeNull();
    fs.writeFileSync(file, resourceContent);
    expect(resolvePodmanConfigPath(runtime, '/app/resources/app.asar/src/main')).toBe(file);
    fs.writeFileSync(file, '[engine]\nremote = true\n');
    expect(resolvePodmanConfigPath(runtime, '/app/resources/app.asar/src/main')).toBeNull();
  });

  it('refuses an asar or relative resource path and supports development Electron', () => {
    expect(
      resolvePodmanConfigPath(
        { resourcesPath: path.resolve('app.asar') },
        '/app/app.asar/src/main',
      ),
    ).toBeNull();
    expect(
      resolvePodmanConfigPath({ resourcesPath: 'relative/resources' }, '/app/app.asar/src/main'),
    ).toBeNull();
    expect(resolvePodmanConfigPath({}, path.resolve('app.asar/src/main'))).toBeNull();
    expect(resolvePodmanConfigPath({ resourcesPath: 'unused', defaultApp: true })).toBe(
      path.resolve('src/main/podman-local.conf'),
    );
    expect(resolvePodmanConfigPath({ resourcesPath: 'unused' })).toBe(
      path.resolve('src/main/podman-local.conf'),
    );
  });

  it('does not spawn when its verified overlay is unavailable', async () => {
    vi.spyOn(fs, 'lstatSync').mockImplementation(() => {
      throw new Error('private missing resource');
    });
    const { discovery, execFile } = harness([row()]);
    await discovery.refresh();
    expect(execFile).not.toHaveBeenCalled();
    expect(discovery.snapshot()).toMatchObject({ status: 'unavailable', reason: 'remote-config' });
  });
});
