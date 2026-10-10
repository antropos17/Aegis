import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createDockerDiscovery } = require('../../src/main/container-scanner');
const firstId = 'a'.repeat(64);
const secondId = 'b'.repeat(64);
const row = (image = 'agent0ai/agent-zero:latest', ID = firstId, Names = 'agent-zero') =>
  JSON.stringify({ ID, Image: image, Names });

function harness(replies = [], options = {}) {
  let time = 1000;
  const kill = vi.fn();
  const onUpdate = vi.fn();
  const execFile = vi.fn((file, args, settings, callback) => {
    const reply = replies.shift();
    if (reply !== undefined)
      queueMicrotask(() => callback(reply instanceof Error ? reply : null, reply));
    return { kill };
  });
  const discovery = createDockerDiscovery({
    execFile,
    now: () => time,
    platform: 'linux',
    onUpdate,
    ...options,
  });
  return {
    discovery,
    execFile,
    onUpdate,
    kill,
    advance: (value) => {
      time = value;
    },
  };
}

beforeEach(() => vi.stubEnv('DOCKER_HOST', ''));
afterEach(() => vi.unstubAllEnvs());

describe('Docker metadata discovery', () => {
  it('has a passive pending snapshot and returns independent copies', async () => {
    const { discovery, execFile } = harness([row()]);
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
    const snapshot = discovery.snapshot();
    snapshot.candidates[0].agent = 'mutated';
    snapshot.candidates.push({ id: 'other' });
    expect(discovery.snapshot().candidates).toEqual([
      {
        id: `docker:${firstId}`,
        containerId: firstId,
        name: 'agent-zero',
        image: 'agent0ai/agent-zero:latest',
        agent: 'Agent Zero',
        match: 'image',
        runtime: 'docker',
      },
    ]);
  });

  it.each([
    ['agent0ai/agent-zero', 'Agent Zero'],
    ['docker.io/agent0ai/agent-zero:v2.0', 'Agent Zero'],
    ['index.docker.io/agent0ai/agent-zero:v2.0', 'Agent Zero'],
    ['ghcr.io/openclaw/openclaw:latest-browser', 'OpenClaw'],
    ['openclaw/openclaw@sha256:' + '1'.repeat(64), 'OpenClaw'],
    ['ghcr.io/openhands/agent-canvas:1.24.0', 'OpenHands'],
  ])('recognizes the exact official repository %s', async (image, agent) => {
    const { discovery } = harness([row(image)]);
    await discovery.refresh();
    expect(discovery.snapshot()).toMatchObject({
      status: 'ready',
      stale: false,
      candidates: [{ agent, image }],
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
    'docker.io/ghcr.io/openhands/agent-canvas:latest',
    'index.docker.io/ghcr.io/openclaw/openclaw:1.0',
    'openclaw:local',
  ])('does not infer an agent from %s', async (image) => {
    const { discovery } = harness([row(image)]);
    await discovery.refresh();
    expect(discovery.snapshot()).toMatchObject({ status: 'ready', candidates: [] });
  });

  it('keeps two matching containers distinct and sorts their IDs', async () => {
    const { discovery } = harness([row(undefined, secondId, 'second') + '\n' + row()]);
    await discovery.refresh();
    expect(discovery.snapshot().candidates.map((candidate) => candidate.id)).toEqual([
      `docker:${firstId}`,
      `docker:${secondId}`,
    ]);
  });

  it('does not hide a matched agent when an unrelated container has a legacy link alias', async () => {
    const { discovery } = harness([row('postgres:17', secondId, 'db,web/db') + '\n' + row()]);
    await discovery.refresh();
    expect(discovery.snapshot()).toMatchObject({
      status: 'ready',
      candidates: [{ containerId: firstId, name: 'agent-zero' }],
    });
    expect(discovery.snapshot().candidates).toHaveLength(1);
  });

  it.each(['agent-zero,web/agent', 'web/agent,agent-zero', 'agent-zero,other-agent'])(
    'keeps only the canonical name from %s',
    async (names) => {
      const { discovery } = harness([row(undefined, firstId, names)]);
      await discovery.refresh();
      expect(discovery.snapshot()).toMatchObject({
        status: 'ready',
        candidates: [{ name: 'agent-zero' }],
      });
      expect(JSON.stringify(discovery.snapshot())).not.toContain('web/agent');
    },
  );

  it.each([
    'agent-zero,',
    'agent-zero,,web/agent',
    'web/agent',
    'agent-zero,web/\nagent',
    'agent-zero,web/../agent',
    Array(34).fill('agent-zero').join(','),
  ])('rejects malformed or over-limit name lists %s', async (names) => {
    const { discovery } = harness([row(undefined, firstId, names)]);
    await discovery.refresh();
    expect(discovery.snapshot()).toMatchObject({
      status: 'unavailable',
      reason: 'invalid-output',
      candidates: [],
    });
  });

  it('uses a projected bounded local query and scrubs inherited Docker overrides', async () => {
    vi.stubEnv('DOCKER_CONTEXT', 'remote-production');
    vi.stubEnv('DOCKER_TLS_VERIFY', '1');
    vi.stubEnv('DOCKER_TLS', '1');
    vi.stubEnv('DOCKER_CERT_PATH', '/private/certs');
    vi.stubEnv('DOCKER_API_VERSION', '999');
    vi.stubEnv('DOCKER_CLI_OTEL_EXPORTER_OTLP_ENDPOINT', 'https://private-telemetry.example');
    vi.stubEnv('DOCKER_CLI_OTEL_EXPORTER_OTLP_HEADERS', 'authorization=private');
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', 'https://generic-telemetry.example');
    vi.stubEnv('OTEL_EXPORTER_OTLP_HEADERS', 'authorization=private');
    vi.stubEnv('OTEL_TRACES_EXPORTER', 'otlp');
    vi.stubEnv('TRACEPARENT', 'private-trace-context');
    vi.stubEnv('TRACESTATE', 'private-trace-state');
    const { discovery, execFile } = harness(['']);
    await discovery.refresh();
    const [file, args, settings] = execFile.mock.calls[0];
    expect(file).toBe('docker');
    expect(args).toEqual([
      '--host',
      'unix:///var/run/docker.sock',
      'ps',
      '--no-trunc',
      '--filter',
      'status=running',
      '--format',
      '{"ID":{{json .ID}},"Image":{{json .Image}},"Names":{{json .Names}}}',
    ]);
    expect(settings).toMatchObject({
      timeout: 3000,
      maxBuffer: 524288,
      windowsHide: true,
      shell: false,
      encoding: 'utf8',
    });
    for (const key of Object.keys(settings.env))
      expect(key).not.toMatch(
        /^(?:DOCKER_(?:HOST|CONTEXT|TLS|TLS_VERIFY|CERT_PATH|API_VERSION)$|DOCKER_CLI_OTEL_|OTEL_|TRACEPARENT$|TRACESTATE$)/i,
      );
    expect(process.env.DOCKER_CLI_OTEL_EXPORTER_OTLP_ENDPOINT).toBe(
      'https://private-telemetry.example',
    );
    expect(args.join(' ')).not.toMatch(/Command|Labels|Mounts|Networks|inspect|exec|start/);
  });

  it('tries the Desktop Linux pipe before the standard Windows local pipe', async () => {
    const error = Object.assign(new Error('private daemon message'), { code: 1 });
    const { discovery, execFile } = harness([error, row()], { platform: 'win32' });
    await discovery.refresh();
    expect(execFile.mock.calls.map((call) => [call[0], call[1][1]])).toEqual([
      ['docker.exe', 'npipe:////./pipe/dockerDesktopLinuxEngine'],
      ['docker.exe', 'npipe:////./pipe/docker_engine'],
    ]);
    expect(discovery.snapshot().status).toBe('ready');
  });

  it.each(['ENOENT', 'ETIMEDOUT', 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'])(
    'never multiplies Windows attempts after %s',
    async (code) => {
      const { discovery, execFile } = harness([Object.assign(new Error('private'), { code })], {
        platform: 'win32',
      });
      await discovery.refresh();
      expect(execFile).toHaveBeenCalledTimes(1);
      expect(discovery.snapshot().status).toBe('unavailable');
    },
  );

  it.each(['tcp://remote:2375', 'ssh://user@remote', 'npipe:////remote/pipe/docker_engine'])(
    'refuses remote inherited DOCKER_HOST %s',
    async (host) => {
      vi.stubEnv('DOCKER_HOST', host);
      const { discovery, execFile } = harness([row()]);
      await discovery.refresh();
      expect(execFile).not.toHaveBeenCalled();
      expect(discovery.snapshot()).toMatchObject({
        status: 'unavailable',
        reason: 'remote-endpoint',
        observedAt: null,
        stale: true,
      });
    },
  );

  it.each([
    [Object.assign(new Error('private missing executable'), { code: 'ENOENT' }), 'cli-missing'],
    [Object.assign(new Error('private timeout'), { killed: true }), 'timeout'],
    [
      Object.assign(new Error('private oversize output'), {
        code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
      }),
      'invalid-output',
    ],
    [Object.assign(new Error('private daemon failure'), { code: 1 }), 'daemon-unavailable'],
  ])('sanitizes failed transport into %s', async (error, reason) => {
    const { discovery } = harness([error]);
    await discovery.refresh();
    expect(discovery.snapshot()).toMatchObject({ status: 'unavailable', reason, stale: true });
    expect(JSON.stringify(discovery.snapshot())).not.toContain('private');
  });

  it.each([
    'not JSON',
    '{"ID": "abc"}',
    JSON.stringify({
      ID: firstId,
      Image: 'agent0ai/agent-zero',
      Names: 'valid',
      Command: 'private command',
    }),
    row(undefined, 'a'.repeat(12)),
    row(undefined, firstId, 'invalid\nname'),
    row() + '\n' + row(),
    row() + '\nnot JSON',
    ' '.repeat(524289),
    Array.from({ length: 1025 }, (_, index) =>
      row('other/image', index.toString(16).padStart(64, '0')),
    ).join('\n'),
  ])('fails the entire malformed/oversized observation', async (output) => {
    const { discovery } = harness([output]);
    await discovery.refresh();
    expect(discovery.snapshot()).toMatchObject({
      status: 'unavailable',
      reason: 'invalid-output',
      observedAt: null,
      candidates: [],
    });
  });

  it('coalesces in-flight refreshes and never makes the scan path wait', async () => {
    const { discovery, execFile } = harness();
    const first = discovery.refresh();
    const second = discovery.refresh();
    expect(first).toBe(second);
    expect(discovery.snapshot()).toMatchObject({ status: 'pending', attemptedAt: 1000 });
    await Promise.resolve();
    expect(execFile).toHaveBeenCalledTimes(1);
    execFile.mock.calls[0][3](null, row());
    await first;
    expect(discovery.snapshot().status).toBe('ready');
  });

  it('throttles attempts for 30s, preserves stale success on outage, and retires it on a successful empty list', async () => {
    const failure = Object.assign(new Error('private unavailable'), { code: 1 });
    const { discovery, execFile, advance, onUpdate } = harness([row(), failure, '']);
    await discovery.refresh();
    advance(30999);
    await discovery.refresh();
    expect(execFile).toHaveBeenCalledTimes(1);
    advance(31000);
    await discovery.refresh();
    expect(discovery.snapshot()).toMatchObject({
      status: 'unavailable',
      reason: 'daemon-unavailable',
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
    onUpdate.mock.calls[0][0].candidates[0].name = 'mutated';
    expect(discovery.snapshot().candidates).toEqual([]);
  });

  it('marks ready observations stale at exactly 90s and on clock rollback', async () => {
    const { discovery, advance } = harness([row()]);
    await discovery.refresh();
    advance(90999);
    expect(discovery.snapshot().stale).toBe(false);
    advance(91000);
    expect(discovery.snapshot()).toMatchObject({ status: 'ready', stale: true, observedAt: 1000 });
    advance(999);
    expect(discovery.snapshot().stale).toBe(true);
  });

  it('never rejects for synchronous spawn or update callback errors', async () => {
    const discovery = createDockerDiscovery({
      platform: 'linux',
      execFile: () => {
        throw new Error('private spawn error');
      },
      onUpdate: () => {
        throw new Error('private callback error');
      },
    });
    await expect(discovery.refresh()).resolves.toMatchObject({
      status: 'unavailable',
      reason: 'daemon-unavailable',
    });
    expect(JSON.stringify(discovery.snapshot())).not.toContain('private');
  });

  it('stop kills only the owned CLI, resolves pending refresh and suppresses late updates', async () => {
    const { discovery, execFile, kill, onUpdate } = harness();
    const pending = discovery.refresh();
    await Promise.resolve();
    discovery.stop();
    discovery.stop();
    await pending;
    execFile.mock.calls[0][3](null, row());
    await discovery.refresh();
    expect(kill).toHaveBeenCalledTimes(1);
    expect(onUpdate).not.toHaveBeenCalled();
    expect(discovery.snapshot().candidates).toEqual([]);
    expect(execFile).toHaveBeenCalledTimes(1);
  });
});
