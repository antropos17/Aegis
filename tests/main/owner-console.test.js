import { afterEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createOwnerConsole } = require('../../src/main/action-owner-console');
const {
  selectedProfileEnvironment,
  verifierEnvironment,
} = require('../../src/main/action-owner-console-cli');
const { selectedDeleteEnvironment } = require('../../src/main/action-delete-windows');
const broker = require('../../src/main/action-mcp-review');
const deletion = require('../../src/main/action-delete-file');
const adapters = [];
const peers = [];

function frame(value) {
  const body = Buffer.from(value, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32LE(body.length);
  return Buffer.concat([length, body]);
}

function verifier() {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.signalCode = null;
  child.kill = vi.fn(() => {
    finish();
    return true;
  });
  const received = [];
  let buffer = Buffer.alloc(0);
  let finished = false;
  let shutdownCode = 0;
  let shutdownSignal = null;
  function finish(code = 0, signal = null) {
    if (finished) return;
    finished = true;
    child.exitCode = code;
    child.signalCode = signal;
    child.stdout.end();
    child.emit('exit', code, signal);
    setImmediate(() => child.emit('close', code, signal));
  }
  child.stdin.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 4 && buffer.length >= 4 + buffer.readUInt32LE(0)) {
      const end = 4 + buffer.readUInt32LE(0);
      const value = buffer.subarray(4, end).toString('ascii');
      received.push(value);
      buffer = buffer.subarray(end);
      if (value === 'S') {
        setImmediate(() => {
          child.stdout.write(frame('B'));
          finish(shutdownCode, shutdownSignal);
        });
      }
    }
  });
  const fixture = {
    child,
    received,
    send: (value) => child.stdout.write(frame(value)),
    finish,
    shutdownResult: (code, signal) => {
      shutdownCode = code;
      shutdownSignal = signal;
    },
  };
  peers.push(fixture);
  return fixture;
}

async function open(f = verifier(), overrides = {}) {
  const ready = createOwnerConsole({
    child: f.child,
    randomBytes: () => Buffer.from('0123456789abcdef0123456789abcdef', 'hex'),
    startupMs: 250,
    reviewMs: 1000,
    cleanupMs: 250,
    ...overrides,
  });
  setImmediate(() => f.send('H 1'));
  const adapter = await ready;
  adapters.push(adapter);
  return { f, adapter };
}

async function request(f) {
  await vi.waitFor(() => expect(f.received.some((value) => value.startsWith('R '))).toBe(true));
  const value = f.received.find((item) => item.startsWith('R '));
  const match = /^R ([0-9a-f]{32}) ([A-Za-z0-9+/]+={0,2})$/.exec(value);
  expect(match).not.toBeNull();
  return { challenge: match[1], preview: Buffer.from(match[2], 'base64').toString('utf8') };
}

async function healthRequest(f) {
  await vi.waitFor(() => expect(f.received.some((value) => value.startsWith('G '))).toBe(true));
  const value = f.received.find((item) => item.startsWith('G '));
  const match = /^G ([0-9a-f]{32})$/.exec(value);
  expect(match).not.toBeNull();
  return match[1];
}

function expectDeletePreview(preview, operation) {
  const marker = 'Exact operation (JSON escapes are literal):\n';
  expect(preview).toContain('AEGIS terminal confirmation - ONE file deletion\n');
  expect(preview).toContain('A terminal response does not authenticate a human.\n');
  const parts = preview.split(marker);
  expect(parts).toHaveLength(2);
  expect(JSON.parse(parts[1])).toEqual(operation);
}

const HEARTBEAT = '1234567890abcdef1234567890abcdef';

function profileBootstrap(root = 'X:\\AEGIS\\Profile') {
  return {
    profileRoot: root,
    profileEnvironment: {
      APPDATA: `${root}\\appdata`,
      LOCALAPPDATA: `${root}\\localappdata`,
      USERPROFILE: `${root}\\userprofile`,
      HOME: `${root}\\home`,
      TEMP: `${root}\\temp`,
      TMP: `${root}\\temp`,
      EXTRA_INJECTION: 'PRIVATE_PROFILE_CANARY',
    },
  };
}

it('leaves the profile environment absent when no root is explicitly selected', () => {
  expect(selectedProfileEnvironment({})).toBeUndefined();
  expect(
    selectedProfileEnvironment({ profileEnvironment: profileBootstrap().profileEnvironment }),
  ).toBeUndefined();
});

it('selects an immutable exact six-key profile environment and removes unrelated fields', () => {
  const bootstrap = profileBootstrap();
  const selected = selectedProfileEnvironment(bootstrap);
  const { EXTRA_INJECTION, ...expected } = bootstrap.profileEnvironment;
  expect(EXTRA_INJECTION).toBe('PRIVATE_PROFILE_CANARY');
  expect(selected).toEqual(expected);
  expect(Object.isFrozen(selected)).toBe(true);
  expect(JSON.stringify(selected)).not.toContain('PRIVATE_PROFILE_CANARY');
});

it.each(['selected profile', 'no profile'])(
  'constructs a fixed verifier environment with %s',
  (mode) => {
    const bootstrap = { ...profileBootstrap(), pipe: 'fixture-pipe', secret: 'fixture-secret' };
    const source = {
      SystemRoot: 'C:\\Windows',
      WINDIR: 'C:\\Windows',
      TEMP: 'X:\\source-temp',
      TMP: 'X:\\source-tmp',
      NODE_OPTIONS: 'PRIVATE_NODE_OPTIONS',
      NODE_DEBUG: 'PRIVATE_NODE_DEBUG',
      COR_ENABLE_PROFILING: 'PRIVATE_COR',
      COMPlus_ReadyToRun: 'PRIVATE_COMPLUS',
      DOTNET_STARTUP_HOOKS: 'PRIVATE_DOTNET',
      AEGIS_EXTRA: 'PRIVATE_AEGIS_EXTRA',
      OTHER_CANARY: 'PRIVATE_OTHER_CANARY',
    };
    const selected =
      mode === 'selected profile' ? selectedProfileEnvironment(bootstrap) : undefined;
    const result = verifierEnvironment(bootstrap, selected, source);
    expect(result).toEqual({
      AEGIS_OWNER_PIPE: 'fixture-pipe',
      AEGIS_OWNER_SECRET: 'fixture-secret',
      SystemRoot: 'C:\\Windows',
      WINDIR: 'C:\\Windows',
      TEMP: 'X:\\source-temp',
      TMP: 'X:\\source-tmp',
      ...(selected || {}),
    });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_');
    expect(source.TEMP).toBe('X:\\source-temp');
    if (selected) {
      expect(result.TEMP).toBe(selected.TEMP);
      expect(result.TMP).toBe(selected.TMP);
    }
  },
);

it('selects only six profile paths while retaining the trusted helper environment', () => {
  const base = { DOTNET_ROOT: 'X:\\runtime', DOTNET_ROLL_FORWARD: 'Disable', TEMP: 'X:\\old' };
  const profile = {
    ...profileBootstrap().profileEnvironment,
    NODE_OPTIONS: '--require PRIVATE_INJECTION',
    DOTNET_STARTUP_HOOKS: 'X:\\PRIVATE_INJECTION.dll',
  };
  const expected = Object.fromEntries(
    ['APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'HOME', 'TEMP', 'TMP'].map((key) => [
      key,
      profile[key],
    ]),
  );
  expect(selectedDeleteEnvironment(base, profile)).toEqual({ ...base, ...expected });
  expect(base).toEqual({
    DOTNET_ROOT: 'X:\\runtime',
    DOTNET_ROLL_FORWARD: 'Disable',
    TEMP: 'X:\\old',
  });
  expect(JSON.stringify(selectedDeleteEnvironment(base, profile))).not.toContain(
    'PRIVATE_INJECTION',
  );
});

it('keeps the trusted helper environment unchanged when no profile is selected', () => {
  const base = { DOTNET_ROOT: 'X:\\runtime', TEMP: 'X:\\original' };
  expect(selectedDeleteEnvironment(base)).toEqual(base);
});

it.each([
  [
    'missing',
    (profile) => {
      delete profile.APPDATA;
    },
  ],
  [
    'relative',
    (profile) => {
      profile.HOME = 'relative\\home';
    },
  ],
  [
    'embedded NUL',
    (profile) => {
      profile.TMP = 'X:\\fixture\\bad\0path';
    },
  ],
])('refuses a %s selected helper path', (_kind, mutate) => {
  const profile = profileBootstrap().profileEnvironment;
  mutate(profile);
  expect(() => selectedDeleteEnvironment({ DOTNET_ROOT: 'X:\\runtime' }, profile)).toThrow();
});

it.each([
  [
    'mismatched child',
    (b) => {
      b.profileEnvironment.TEMP = 'X:\\other\\temp';
    },
  ],
  [
    'missing child',
    (b) => {
      delete b.profileEnvironment.HOME;
    },
  ],
  [
    'drive root',
    (b) => {
      b.profileRoot = 'X:\\';
    },
  ],
  [
    'relative root',
    (b) => {
      b.profileRoot = 'relative\\root';
    },
  ],
  [
    'noncanonical traversal',
    (b) => {
      b.profileRoot = 'X:\\AEGIS\\..\\Profile';
    },
  ],
  [
    'UNC root',
    (b) => {
      b.profileRoot = '\\\\server\\share\\Profile';
    },
  ],
  [
    'device root',
    (b) => {
      b.profileRoot = '\\\\?\\X:\\AEGIS\\Profile';
    },
  ],
])('rejects %s without falling back', (_kind, mutate) => {
  const bootstrap = profileBootstrap();
  mutate(bootstrap);
  expect(selectedProfileEnvironment(bootstrap)).toBe(false);
});

it('answers a fresh heartbeat while idle', async () => {
  const { f, adapter } = await open();
  f.send(`P ${HEARTBEAT}`);
  await vi.waitFor(() => expect(f.received).toContain(`Q ${HEARTBEAT}`));
  expect(adapter.isTerminalAvailable()).toBe(true);
});

it.each(['no heartbeat', 'one heartbeat then stall'])('revokes after %s', async (mode) => {
  const { f, adapter } = await open(verifier(), { heartbeatMs: 100 });
  const revoked = vi.fn();
  adapter.watchTerminalLifetime(revoked);
  if (mode === 'one heartbeat then stall') {
    f.send(`P ${HEARTBEAT}`);
    await vi.waitFor(() => expect(f.received).toContain(`Q ${HEARTBEAT}`));
  }
  await vi.waitFor(() => expect(revoked).toHaveBeenCalled(), { timeout: 1500 });
  expect(adapter.isTerminalAvailable()).toBe(false);
});

it('answers a fresh heartbeat during a review', async () => {
  const { f, adapter } = await open();
  const result = adapter.confirmInTerminal(
    { kind: 'delete-file', path: 'X:\\PRIVATE\\selected.txt' },
    { kind: 'delete-file' },
  );
  const { challenge } = await request(f);
  f.send(`P ${HEARTBEAT}`);
  await vi.waitFor(() => expect(f.received).toContain(`Q ${HEARTBEAT}`));
  f.send(`D ${challenge}`);
  expect(await result).toBe(false);
});

it('answers a fresh heartbeat while cancellation is in progress', async () => {
  const { f, adapter } = await open();
  const controller = new AbortController();
  const result = adapter.confirmInTerminal(
    { kind: 'delete-file', path: 'X:\\PRIVATE\\selected.txt' },
    { kind: 'delete-file', signal: controller.signal },
  );
  const { challenge } = await request(f);
  controller.abort();
  await vi.waitFor(() => expect(f.received).toContain(`C ${challenge}`));
  f.send(`P ${HEARTBEAT}`);
  await vi.waitFor(() => expect(f.received).toContain(`Q ${HEARTBEAT}`));
  f.send(`K ${challenge}`);
  f.finish();
  expect(await result).toBe(false);
});

it('answers a fresh heartbeat while shutdown is in progress', async () => {
  const { f, adapter } = await open();
  const closing = adapter.close();
  expect(f.received).toContain('S');
  f.send(`P ${HEARTBEAT}`);
  await vi.waitFor(() => expect(f.received).toContain(`Q ${HEARTBEAT}`));
  expect(await closing).toBe(true);
});

it('rejects a heartbeat before readiness', async () => {
  const f = verifier();
  const waiting = createOwnerConsole({ child: f.child, startupMs: 250, cleanupMs: 100 });
  f.send(`P ${HEARTBEAT}`);
  expect(await waiting).toBeNull();
  expect(f.received).not.toContain(`Q ${HEARTBEAT}`);
});

it('rejects readiness received after the monotonic startup deadline even before its timer runs', async () => {
  const f = verifier();
  let tick = 0;
  const waiting = createOwnerConsole({
    child: f.child,
    now: () => tick,
    startupMs: 1000,
    cleanupMs: 100,
  });
  tick = 1001;
  f.send('H 1');
  const adapter = await waiting;
  if (adapter) adapters.push(adapter);
  expect(adapter).toBeNull();
});

it('rejects approval after the monotonic review deadline even before its timer runs', async () => {
  let tick = 0;
  const { f, adapter } = await open(verifier(), {
    now: () => tick,
    reviewMs: 1000,
    heartbeatMs: 100000,
  });
  const result = adapter.confirmInTerminal(
    { kind: 'delete-file', path: 'X:\\PRIVATE\\selected.txt' },
    { kind: 'delete-file' },
  );
  const { challenge } = await request(f);
  tick = 1001;
  f.send(`A ${challenge}`);
  expect(await result).toBe(false);
  expect(adapter.isTerminalAvailable()).toBe(false);
});

it('rejects health confirmation after its monotonic deadline even before its timer runs', async () => {
  let tick = 0;
  const { f, adapter } = await open(verifier(), {
    now: () => tick,
    healthMs: 1000,
    heartbeatMs: 100000,
  });
  const result = adapter.confirmInTerminal(
    { kind: 'delete-file', path: 'X:\\PRIVATE\\selected.txt' },
    { kind: 'delete-file' },
  );
  const { challenge } = await request(f);
  f.send(`A ${challenge}`);
  expect(await result).toBe(true);
  const check = adapter.checkBeforeCommit();
  const nonce = await healthRequest(f);
  tick = 1001;
  f.send(`Y ${nonce}`);
  expect(await check).toBe(false);
  expect(adapter.isTerminalAvailable()).toBe(false);
});

it('expires the commit guard exactly at its monotonic freshness bound', async () => {
  let tick = 0;
  const { f, adapter } = await open(verifier(), {
    now: () => tick,
    heartbeatMs: 100000,
  });
  const review = adapter.confirmInTerminal(
    { kind: 'delete-file', path: 'X:\\PRIVATE\\selected.txt' },
    { kind: 'delete-file' },
  );
  const { challenge } = await request(f);
  f.send(`A ${challenge}`);
  expect(await review).toBe(true);
  const check = adapter.checkBeforeCommit();
  const nonce = await healthRequest(f);
  f.send(`Y ${nonce}`);
  expect(await check).toBe(true);
  expect(adapter.isCommitGuardFresh()).toBe(true);
  tick = 1499;
  expect(adapter.isCommitGuardFresh()).toBe(true);
  tick = 1500;
  expect(adapter.isCommitGuardFresh()).toBe(false);
});

it.each(['duplicate', 'short', 'uppercase', 'extra'])('revokes on a %s heartbeat', async (kind) => {
  const { f, adapter } = await open();
  const revoked = vi.fn();
  adapter.watchTerminalLifetime(revoked);
  if (kind === 'duplicate') {
    f.send(`P ${HEARTBEAT}`);
    await vi.waitFor(() => expect(f.received).toContain(`Q ${HEARTBEAT}`));
    f.send(`P ${HEARTBEAT}`);
  } else if (kind === 'short') f.send('P 1234');
  else if (kind === 'uppercase') f.send(`P ${HEARTBEAT.toUpperCase()}`);
  else f.send(`P ${HEARTBEAT} extra`);
  await vi.waitFor(() => expect(revoked).toHaveBeenCalled());
  expect(adapter.isTerminalAvailable()).toBe(false);
});

afterEach(async () => {
  await Promise.all(adapters.splice(0).map((adapter) => adapter.close().catch(() => false)));
  for (const f of peers.splice(0)) f.finish();
  vi.restoreAllMocks();
});

it.each([
  ['A', true],
  ['D', false],
  ['U', false],
])(
  'accepts only the matching fresh response %s and keeps the selected path in the preview',
  async (response, expected) => {
    const { f, adapter } = await open();
    const operation = { kind: 'delete-file', path: 'X:\\PRIVATE\\selected.txt' };
    const result = adapter.confirmInTerminal(operation, { kind: 'delete-file' });
    const { challenge, preview } = await request(f);
    expectDeletePreview(preview, operation);
    expect(preview).toContain(JSON.stringify(operation.path));
    f.send(`${response} ${challenge}`);
    expect(await result).toBe(expected);
  },
);

it('rejects an answer bound to another challenge and revokes the terminal', async () => {
  const { f, adapter } = await open();
  const revoked = vi.fn();
  adapter.watchTerminalLifetime(revoked);
  const result = adapter.confirmInTerminal(
    { kind: 'delete-file', path: 'X:\\PRIVATE\\selected.txt' },
    { kind: 'delete-file' },
  );
  await request(f);
  f.send('A ffffffffffffffffffffffffffffffff');
  expect(await result).toBe(false);
  await vi.waitFor(() => expect(revoked).toHaveBeenCalled());
  expect(adapter.isTerminalAvailable()).toBe(false);
});

it('invalidates cancellation immediately and ignores a late matching approval', async () => {
  const { f, adapter } = await open();
  const controller = new AbortController();
  const result = adapter.confirmInTerminal(
    { kind: 'delete-file', path: 'X:\\PRIVATE\\selected.txt' },
    { kind: 'delete-file', signal: controller.signal },
  );
  const { challenge } = await request(f);
  let settled = false;
  result.then(() => {
    settled = true;
  });
  controller.abort();
  await vi.waitFor(() => expect(f.received).toContain(`C ${challenge}`));
  f.send(`A ${challenge}`);
  await new Promise(setImmediate);
  expect(settled).toBe(false);
  f.send(`K ${challenge}`);
  f.finish();
  expect(await result).toBe(false);
});

it('revokes availability on an idle console-loss indication', async () => {
  const { f, adapter } = await open();
  const revoked = vi.fn();
  adapter.watchTerminalLifetime(revoked);
  f.send('L');
  await vi.waitFor(() => expect(revoked).toHaveBeenCalled());
  expect(adapter.isTerminalAvailable()).toBe(false);
});

it('revokes an already approved session when its console is subsequently lost', async () => {
  const { f, adapter } = await open();
  const revoked = vi.fn();
  adapter.monitorTerminalInput(revoked);
  const result = adapter.confirmInTerminal(
    { kind: 'delete-file', path: 'X:\\PRIVATE\\selected.txt' },
    { kind: 'delete-file' },
  );
  const { challenge } = await request(f);
  f.send(`A ${challenge}`);
  expect(await result).toBe(true);
  f.send(`V ${challenge}`);
  await vi.waitFor(() => expect(revoked).toHaveBeenCalled());
  expect(adapter.isTerminalAvailable()).toBe(false);
});

it('allows only one outstanding review', async () => {
  const { f, adapter } = await open();
  const operation = { kind: 'delete-file', path: 'X:\\PRIVATE\\selected.txt' };
  const first = adapter.confirmInTerminal(operation, { kind: 'delete-file' });
  const { challenge } = await request(f);
  expect(await adapter.confirmInTerminal(operation, { kind: 'delete-file' })).toBe(false);
  expect(f.received.filter((item) => item.startsWith('R '))).toHaveLength(1);
  f.send(`D ${challenge}`);
  expect(await first).toBe(false);
});

it('refuses a second sequential review without sending another request', async () => {
  const { f, adapter } = await open();
  const operation = { kind: 'delete-file', path: 'X:\\PRIVATE\\selected.txt' };
  const first = adapter.confirmInTerminal(operation, { kind: 'delete-file' });
  const { challenge } = await request(f);
  f.send(`D ${challenge}`);
  expect(await first).toBe(false);
  expect(await adapter.confirmInTerminal(operation, { kind: 'delete-file' })).toBe(false);
  expect(f.received.filter((item) => item.startsWith('R '))).toHaveLength(1);
});

it.each(['oversized', 'non-ascii', 'unexpected', 'duplicate'])(
  'fails closed for %s verifier data',
  async (mode) => {
    const { f, adapter } = await open();
    const revoked = vi.fn();
    adapter.watchTerminalLifetime(revoked);
    const result = adapter.confirmInTerminal(
      { kind: 'delete-file', path: 'X:\\PRIVATE\\selected.txt' },
      { kind: 'delete-file' },
    );
    const { challenge } = await request(f);
    if (mode === 'oversized') {
      const header = Buffer.alloc(4);
      header.writeUInt32LE(24577);
      f.child.stdout.write(header);
    } else if (mode === 'non-ascii') {
      f.child.stdout.write(Buffer.from([1, 0, 0, 0, 0xff]));
    } else if (mode === 'unexpected') f.send(`Z ${challenge}`);
    else {
      f.send(`D ${challenge}`);
      f.send(`A ${challenge}`);
    }
    expect(await result).toBe(false);
    await vi.waitFor(() => expect(revoked).toHaveBeenCalled());
    expect(adapter.isTerminalAvailable()).toBe(false);
  },
);

it('refuses startup if the child never signals readiness', async () => {
  const f = verifier();
  const adapter = await createOwnerConsole({ child: f.child, startupMs: 30, cleanupMs: 100 });
  expect(adapter).toBeNull();
  expect(f.child.kill).toHaveBeenCalled();
});

it.each(['invalid hello', 'child error', 'child exit'])('refuses startup on %s', async (mode) => {
  const f = verifier();
  const waiting = createOwnerConsole({ child: f.child, startupMs: 250, cleanupMs: 100 });
  if (mode === 'invalid hello') f.send('H 2');
  else if (mode === 'child error') f.child.emit('error', Error('PRIVATE_STARTUP_ERROR'));
  else f.finish(1, null);
  expect(await waiting).toBeNull();
});

it('revokes an active confirmation when the verifier output closes', async () => {
  const { f, adapter } = await open();
  const result = adapter.confirmInTerminal(
    { kind: 'delete-file', path: 'X:\\PRIVATE\\selected.txt' },
    { kind: 'delete-file' },
  );
  await request(f);
  f.child.stdout.end();
  expect(await result).toBe(false);
  expect(adapter.isTerminalAvailable()).toBe(false);
});

it.each([
  ['stdout', 'close'],
  ['stdin', 'close'],
  ['stdin', 'finish'],
])('revokes the terminal on %s %s without a preceding end event', async (stream, event) => {
  const { f, adapter } = await open();
  const result = adapter.confirmInTerminal(
    { kind: 'delete-file', path: 'X:\\PRIVATE\\selected.txt' },
    { kind: 'delete-file' },
  );
  await request(f);
  f.child[stream].emit(event);
  expect(await result).toBe(false);
  expect(adapter.isTerminalAvailable()).toBe(false);
});

it.each([
  [1, null],
  [null, 'SIGTERM'],
])(
  'does not confirm shutdown after B when child close is code %s signal %s',
  async (code, signal) => {
    const { f, adapter } = await open();
    f.shutdownResult(code, signal);
    expect(await adapter.close()).toBe(false);
  },
);

it('confirms shutdown only after B and successful child close', async () => {
  const { adapter } = await open();
  expect(await adapter.close()).toBe(true);
});

it('fails closed if the verifier input errors while a review is pending', async () => {
  const { f, adapter } = await open();
  const result = adapter.confirmInTerminal(
    { kind: 'delete-file', path: 'X:\\PRIVATE\\selected.txt' },
    { kind: 'delete-file' },
  );
  await request(f);
  f.child.stdin.destroy(Error('PRIVATE_TRANSPORT_ERROR'));
  expect(await result).toBe(false);
  expect(adapter.isTerminalAvailable()).toBe(false);
});

it('cancels on deadline and bounds an unresponsive verifier', async () => {
  const { f, adapter } = await open(verifier(), { reviewMs: 25, cleanupMs: 50 });
  const started = performance.now();
  const result = adapter.confirmInTerminal(
    { kind: 'delete-file', path: 'X:\\PRIVATE\\selected.txt' },
    { kind: 'delete-file' },
  );
  const { challenge } = await request(f);
  expect(await result).toBe(false);
  expect(f.received).toContain(`C ${challenge}`);
  expect(f.child.kill).toHaveBeenCalled();
  expect(performance.now() - started).toBeLessThan(1500);
});

it('rejects an oversized preview without sending a request', async () => {
  const { f, adapter } = await open();
  expect(
    await adapter.confirmInTerminal(
      { kind: 'delete-file', path: 'X:\\' + 'x'.repeat(16385) },
      { kind: 'delete-file' },
    ),
  ).toBe(false);
  expect(f.received.some((item) => item.startsWith('R '))).toBe(false);
});

it.each([
  'approve',
  'approve-profile',
  'cancel',
  'peer-loss',
  'console-loss',
  'health-timeout',
  'health-late',
  'health-stale-guard',
  'health-selection-mutation',
  'health-wrong',
  'health-loss',
  'health-cancel',
])(
  'handles %s through the real selected-delete broker',
  async (mode) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-owner-console-'));
    const target = path.join(root, 'PRIVATE-selected.txt');
    const neighbor = path.join(root, 'neighbor.txt');
    const policy = path.join(root, 'PRIVATE-policy.json');
    const requestPath = path.join(root, 'PRIVATE-request.json');
    const endpointPath = path.join(root, 'endpoint.json');
    const operation = { kind: 'delete-file', path: target };
    fs.writeFileSync(target, 'selected sentinel');
    fs.writeFileSync(neighbor, 'neighbor sentinel');
    fs.writeFileSync(requestPath, JSON.stringify({ schemaVersion: 1, operation }));
    fs.writeFileSync(
      policy,
      JSON.stringify({
        schemaVersion: 1,
        defaultDecision: 'deny',
        rules: [{ operation, decision: 'allow' }],
      }),
    );
    const selectedProfile = Object.fromEntries(
      ['APPDATA', 'LOCALAPPDATA', 'USERPROFILE', 'HOME', 'TEMP', 'TMP'].map((key) => [
        key,
        path.join(root, `profile-${key}`),
      ]),
    );
    let tick = 0;
    const { f, adapter } = await open(verifier(), {
      healthMs: mode === 'health-late' ? 1000 : 100,
      heartbeatMs: 100000,
      now: () => tick,
      ...(mode === 'approve-profile'
        ? {
            profileEnvironment: {
              ...selectedProfile,
              INJECTION_CANARY: 'PRIVATE_INJECTION_CANARY',
            },
          }
        : {}),
    });
    const host = new EventEmitter();
    const output = [];
    let ready;
    const readyPromise = new Promise((resolve) => {
      ready = resolve;
    });
    broker._setDepsForTest({
      process: host,
      output: {
        write: (text, done) => {
          output.push(text);
          done();
          ready();
        },
      },
    });
    // The integration asserts the broker and adapter path; native helper behavior is
    // covered separately by the Windows asset fixture.
    const commit = vi.fn(async () => {
      fs.unlinkSync(target);
      return 'deleted';
    });
    const openWindowsDelete = vi.fn(async () => ({ commit, close: async () => true }));
    deletion._setDeleteDepsForTest({
      platform: 'win32',
      openWindowsDelete,
    });
    const done = broker.handleActionMcpReview(
      ['--action-mcp-delete-review', policy, requestPath, endpointPath],
      { terminal: adapter },
    );
    let peer;
    try {
      await readyPromise;
      const endpoint = JSON.parse(fs.readFileSync(endpointPath, 'utf8'));
      peer = net.connect(endpoint.port, '127.0.0.1');
      peer.on('error', () => {});
      await new Promise((resolve, reject) => {
        peer.once('connect', resolve);
        peer.once('error', reject);
      });
      let incoming = '';
      const replies = new Map();
      peer.on('data', (bytes) => {
        incoming += bytes.toString('utf8');
        while (incoming.includes('\n')) {
          const at = incoming.indexOf('\n');
          const message = JSON.parse(incoming.slice(0, at));
          incoming = incoming.slice(at + 1);
          replies.get(message.id)?.(message);
        }
      });
      const call = (id, method, params) =>
        new Promise((resolve) => {
          replies.set(id, resolve);
          peer.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
        });
      peer.write(endpoint.token + '\n');
      await call(1, 'initialize', {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'fixture', version: '1' },
      });
      peer.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
      const pending = call(2, 'tools/call', { name: 'aegis_delete_selected_file', arguments: {} });
      const { challenge, preview } = await request(f);
      expectDeletePreview(preview, operation);
      expect(fs.existsSync(target)).toBe(true);
      expect(openWindowsDelete).toHaveBeenCalledExactlyOnceWith(target, {
        profileEnvironment: mode === 'approve-profile' ? selectedProfile : undefined,
      });
      expect(JSON.stringify(openWindowsDelete.mock.calls)).not.toContain(
        'PRIVATE_INJECTION_CANARY',
      );
      if (mode.startsWith('approve') || mode.startsWith('health-')) {
        f.send(`A ${challenge}`);
        const nonce = await healthRequest(f);
        expect(commit).not.toHaveBeenCalled();
        if (mode.startsWith('approve')) f.send(`Y ${nonce}`);
        else if (mode === 'health-stale-guard') {
          f.send(`Y ${nonce}`);
          tick = 1500;
        } else if (mode === 'health-selection-mutation') {
          fs.appendFileSync(requestPath, ' ');
          f.send(`Y ${nonce}`);
        } else if (mode === 'health-late') {
          tick = 1001;
          f.send(`Y ${nonce}`);
        } else if (mode === 'health-wrong') f.send('Y ffffffffffffffffffffffffffffffff');
        else if (mode === 'health-loss') f.child.stdout.emit('close');
        else if (mode === 'health-cancel') {
          peer.write(
            '{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":2}}\n',
          );
        }
        if (mode === 'health-selection-mutation' || mode === 'health-stale-guard') {
          const reply = await pending;
          expect(reply.result.isError).toBe(true);
          expect(commit).not.toHaveBeenCalled();
          expect(fs.readFileSync(target, 'utf8')).toBe('selected sentinel');
        } else if (!mode.startsWith('approve')) {
          await done;
          f.child.stdout.emit('data', frame(`Y ${nonce}`));
          expect(commit).not.toHaveBeenCalled();
          expect(fs.readFileSync(target, 'utf8')).toBe('selected sentinel');
        } else {
          const reply = await pending;
          expect(reply.result.structuredContent).toMatchObject({
            decision: 'allow',
            operation: { state: 'deleted' },
            control: 'selected-file-only',
          });
          expect(commit).toHaveBeenCalledOnce();
          expect(fs.existsSync(target)).toBe(false);
          for (const privateValue of [root, target, endpoint.token, 'PRIVATE']) {
            expect(JSON.stringify(reply) + output.join('')).not.toContain(privateValue);
          }
          if (mode === 'approve-profile') {
            for (const value of Object.values(selectedProfile)) {
              expect(JSON.stringify(reply) + output.join('') + f.received.join('')).not.toContain(
                value,
              );
            }
            expect(JSON.stringify(reply) + output.join('') + f.received.join('')).not.toContain(
              'PRIVATE_INJECTION_CANARY',
            );
          }
        }
      } else {
        if (mode === 'cancel') {
          peer.write(
            '{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":2}}\n',
          );
        } else if (mode === 'peer-loss') peer.destroy();
        else f.send('L');
        if (mode !== 'console-loss') {
          await vi.waitFor(() => expect(f.received).toContain(`C ${challenge}`));
          f.send(`A ${challenge}`);
          f.send(`K ${challenge}`);
          f.finish();
        }
        await done;
        expect(commit).not.toHaveBeenCalled();
        expect(fs.readFileSync(target, 'utf8')).toBe('selected sentinel');
      }
      expect(fs.readFileSync(neighbor, 'utf8')).toBe('neighbor sentinel');
    } finally {
      peer?.destroy();
      host.emit('SIGTERM');
      await done;
      broker._resetForTest();
      deletion._resetDeleteDepsForTest();
      expect(path.dirname(root)).toBe(path.resolve(os.tmpdir()));
      expect(fs.lstatSync(root).isSymbolicLink()).toBe(false);
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
  10000,
);
