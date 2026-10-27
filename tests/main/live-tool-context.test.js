import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { createLiveToolContext } = require('../../src/main/live-tool-context');
const {
  createHeldOwner,
  prepareActorSettings,
  restoreReadOverlap,
  peerComponentDiagnostic,
  seedOwnedProjectSelection,
} = require('../../scripts/qualification/live-tool-context-claude.cjs');
let home, cwd, agents, service, registry, transcript;
const start = 1792900000000;
const sessionId = '12345678-1234-4234-9234-123456789abc';
const eventId = '98765432-1234-4234-9234-123456789abc';
const secret = 'PRIVATE_PROMPT_AND_ARGUMENT_123';

it('imports qualification helpers in a child without loading Playwright or starting an app', () => {
  const source = `
    const Module = require('node:module');
    const load = Module._load;
    let playwrightRequested = false;
    Module._load = function (name, ...args) {
      if (name === 'playwright') {
        playwrightRequested = true;
        throw Error('browser-sdk-loaded-during-helper-import');
      }
      const value = load.call(this, name, ...args);
      if (name === 'node:child_process') return {
        ...value,
        spawn() { throw Error('app-spawn-during-helper-import'); },
        execFileSync() { throw Error('command-during-helper-import'); },
      };
      return value;
    };
    const helpers = require(process.argv[1]);
    const expected = ['createHeldOwner', 'prepareActorSettings', 'restoreReadOverlap',
      'peerComponentDiagnostic', 'seedOwnedProjectSelection'];
    if (expected.some((name) => typeof helpers[name] !== 'function'))
      throw Error('qualification-helper-missing');
    process.stdout.write(JSON.stringify({ playwrightRequested, helperCount: expected.length }));
  `;
  const result = execFileSync(
    process.execPath,
    ['-e', source, require.resolve('../../scripts/qualification/live-tool-context-claude.cjs')],
    { timeout: 5000, maxBuffer: 8192, windowsHide: true, encoding: 'utf8' },
  );
  expect(JSON.parse(result)).toEqual({ playwrightRequested: false, helperCount: 5 });
});

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-live-context-'));
  cwd = path.join(home, 'project');
  agents = [
    {
      agent: 'Claude Code',
      pid: 42,
      startTime: start,
      instanceId: `42:${start}`,
      instanceIdSource: 'os',
      cwd,
    },
  ];
  registry = path.join(home, '.claude', 'sessions', '42.json');
  transcript = path.join(
    home,
    '.claude',
    'projects',
    cwd.replace(/[/\\:.]/g, '-'),
    `${sessionId}.jsonl`,
  );
  await fs.mkdir(path.dirname(registry), { recursive: true });
  await fs.mkdir(path.dirname(transcript), { recursive: true });
  await fs.writeFile(registry, JSON.stringify({ sessionId, cwd, startedAt: start + 100 }));
  await fs.writeFile(
    transcript,
    [
      {
        type: 'assistant',
        sessionId,
        cwd,
        timestamp: new Date(start + 1000).toISOString(),
        message: {
          content: [
            { type: 'text', text: secret },
            {
              type: 'tool_use',
              id: 'call-1',
              name: 'Read',
              input: { file_path: path.join(cwd, '.env'), note: secret },
            },
          ],
        },
      },
      {
        type: 'user',
        sessionId,
        cwd,
        timestamp: new Date(start + 2000).toISOString(),
        message: { content: [{ type: 'tool_result', tool_use_id: 'call-1', content: secret }] },
      },
    ]
      .map((row) => JSON.stringify(row))
      .join('\n') + '\n',
  );
  service = createLiveToolContext({
    home,
    getAgents: () => agents,
    now: () => start + 3000,
    observeProcesses: async () => null,
  });
  service.record({
    eventId,
    pid: 42,
    instanceId: `42:${start}`,
    timestamp: start + 1500,
    file: path.join(cwd, '.env'),
  });
});
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (home) await fs.rm(home, { recursive: true, force: true });
});

it('stops a held peer at sixty seconds exactly once and confirms termination before hook expiry', async () => {
  vi.useFakeTimers();
  const actor = Object.assign(new EventEmitter(), {
    pid: 42,
    exitCode: null,
    signalCode: null,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  });
  const killTree = vi.fn(() => actor.emit('close', 1, null));
  const onFailure = vi.fn();
  const owner = createHeldOwner(actor, 'peer', { killTree, onFailure });
  await vi.advanceTimersByTimeAsync(59999);
  expect(killTree).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  const first = owner.stop();
  expect(owner.stop()).toBe(first);
  expect(await first).toMatchObject({
    deadlineExpired: true,
    confirmed: true,
    stoppedBeforeHookExpiry: true,
    modelRequestReleased: false,
    reportedTotalCostUsd: null,
  });
  expect(killTree).toHaveBeenCalledExactlyOnceWith(42);
  expect(onFailure).toHaveBeenCalledExactlyOnceWith('held-actor-deadline');
});

it('does not convert an uncertain held replacement kill into confirmed cleanup or retry it', async () => {
  vi.useFakeTimers();
  const actor = Object.assign(new EventEmitter(), { pid: 43, exitCode: null, signalCode: null });
  const killTree = vi.fn(() => {
    throw Error('owned-termination-unavailable');
  });
  const onFailure = vi.fn();
  const owner = createHeldOwner(actor, 'replacement', { killTree, onFailure });
  const result = owner.stop();
  await vi.advanceTimersByTimeAsync(5000);
  expect(await result).toMatchObject({
    confirmed: false,
    killSucceeded: false,
    exit: null,
    stoppedBeforeHookExpiry: false,
    modelRequestReleased: false,
  });
  await owner.stop();
  expect(killTree).toHaveBeenCalledTimes(1);
  expect(onFailure).toHaveBeenCalledExactlyOnceWith('held-actor-termination-unconfirmed');
});

it('treats an unplanned held peer exit as cancellation and never kills the already closed child', async () => {
  const actor = Object.assign(new EventEmitter(), { pid: 44, exitCode: null, signalCode: null });
  const killTree = vi.fn(),
    onFailure = vi.fn();
  const owner = createHeldOwner(actor, 'peer', { killTree, onFailure });
  actor.emit('close', 0, null);
  expect(owner.held()).toBe(false);
  expect(onFailure).toHaveBeenCalledExactlyOnceWith('held-actor-exited-before-release');
  expect((await owner.stop()).confirmed).toBe(true);
  expect(killTree).not.toHaveBeenCalled();
});

it.each([
  { code: 0, signal: null, close: true },
  { code: null, signal: 'SIGTERM', close: true },
  { code: 0, signal: null, close: false },
  { code: null, signal: 'SIGTERM', close: false },
])(
  'does not treat an exited side owner as alive or kill its PID while awaiting close: %j',
  async ({ code, signal, close }) => {
    vi.useFakeTimers();
    const actor = Object.assign(new EventEmitter(), { pid: 45, exitCode: null, signalCode: null });
    const killTree = vi.fn(),
      onFailure = vi.fn();
    const owner = createHeldOwner(actor, 'peer', { killTree, onFailure });
    actor.exitCode = code;
    actor.signalCode = signal;
    actor.emit('exit', code, signal);
    expect(owner.held()).toBe(false);
    expect(onFailure).toHaveBeenCalledExactlyOnceWith('held-actor-exited-before-release');
    const stopping = owner.stop();
    expect(killTree).not.toHaveBeenCalled();
    if (close) actor.emit('close', code, signal);
    else await vi.advanceTimersByTimeAsync(5000);
    expect(await stopping).toMatchObject({
      confirmed: close,
      killSucceeded: null,
      exit: { code, signal },
    });
    expect(vi.getTimerCount()).toBe(0);
  },
);

it('bounds Read scheduling restoration when the owned dispatcher never acknowledges it', async () => {
  vi.useFakeTimers();
  const evaluate = vi.fn(() => new Promise(() => {}));
  const result = restoreReadOverlap({ evaluate });
  await vi.advanceTimersByTimeAsync(1000);
  expect(await result).toBe(false);
  expect(evaluate).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['X:/owned/peer-project', 'x:\\OWNED\\peer-project\\'])(
  'accepts the same peer CWD spelling %s without weakening birth or population proof',
  (actualCwd) => {
    const agents = [
      { pid: 42, agent: 'Claude Code' },
      {
        pid: 43,
        agent: 'Claude Code',
        startTime: 1700000005000,
        instanceIdSource: 'os',
        instanceId: '43:1700000005000',
        createTime100ns: '133444736050000007',
        generationWitnessSource: 'createTime100ns',
        generationWitness: '133444736050000007',
        cwd: actualCwd,
      },
    ];
    const diagnostic = peerComponentDiagnostic({
      agents,
      pid: 43,
      primaryPid: 42,
      cwd: 'X:/owned/peer-project',
    });
    expect(diagnostic).toEqual({
      sameNameCount: 2,
      primaryPresent: true,
      ownedRowCount: 1,
      rowUnique: true,
      agentExpected: true,
      sourceExpected: true,
      keyCoherent: true,
      rawBirthValid: true,
      birthMatchesStart: true,
      witnessSourceEnum: 'createTime100ns',
      witnessMatchesRaw: true,
      cwdPresent: true,
      cwdMatchesExpected: true,
    });
    const serialized = JSON.stringify(diagnostic);
    expect(serialized).not.toContain(actualCwd);
    expect(serialized).not.toContain('133444736050000007');
    expect(serialized).not.toContain('43:1700000005000');
  },
);

it.each([
  { cwd: 'X:/owned/other-project', failed: 'cwdMatchesExpected' },
  { cwd: 'X:/owned/peer-project', ticks: null, failed: 'rawBirthValid' },
  { cwd: 'X:/owned/peer-project', ticks: '133444736000000007', failed: 'birthMatchesStart' },
])(
  'retains a closed negative peer condition for true CWD/birth mismatch: %j',
  ({ cwd, ticks, failed }) => {
    const raw = ticks === undefined ? '133444736050000007' : ticks;
    const diagnostic = peerComponentDiagnostic({
      pid: 43,
      primaryPid: 42,
      cwd: 'X:/owned/peer-project',
      agents: [
        { pid: 42, agent: 'Claude Code' },
        {
          pid: 43,
          agent: 'Claude Code',
          startTime: 1700000005000,
          instanceIdSource: 'os',
          instanceId: '43:1700000005000',
          createTime100ns: raw,
          generationWitnessSource: 'createTime100ns',
          generationWitness: raw,
          cwd,
        },
      ],
    });
    expect(diagnostic[failed]).toBe(false);
    expect(diagnostic.sameNameCount).toBe(2);
    expect(diagnostic.keyCoherent).toBe(true);
  },
);

it('keeps peer and resumed replacement barrier settings isolated from an already released primary', async () => {
  const roots = ['primary', 'peer', 'replacement'].map((name) => path.join(home, name));
  const commands = [];
  for (const root of roots) {
    await fs.mkdir(root);
    const settings = await prepareActorSettings(root, 'Write', path.join(root, 'unused.txt'));
    const parsed = JSON.parse(await fs.readFile(settings, 'utf8'));
    commands.push(parsed.hooks.SessionStart[0].hooks[0].command);
  }
  await fs.writeFile(path.join(roots[0], 'release-SessionStart'), 'release');
  expect(new Set(commands).size).toBe(3);
  for (const root of roots.slice(1))
    await expect(fs.stat(path.join(root, 'release-SessionStart'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  await expect(prepareActorSettings(roots[0], 'Write', 'unused')).rejects.toMatchObject({
    code: 'EEXIST',
  });
});

it('seeds and restores only an external owned profile through the production project selection owner', async () => {
  const profile = path.join(home, 'owned-profile');
  const selected = path.join(home, 'external-project');
  await fs.mkdir(selected);
  const seed = await seedOwnedProjectSelection(profile, selected, cwd);
  expect(seed).toEqual({
    authority: 'scripted-owned-profile-fixture',
    nativeOwnerConsent: false,
    fixturePersisted: true,
    appUserDataMatched: false,
    publicStatusSelected: false,
    projectRootReady: false,
  });
  const { createProjectWatchSelection } = require('../../src/main/project-watch-selection');
  const showOpenDialog = vi.fn();
  const readbackWindow = { isDestroyed: () => false };
  const owner = createProjectWatchSelection({
    userData: profile,
    getWindow: () => readbackWindow,
    dialog: { showOpenDialog },
    blockedTrees: [cwd],
  });
  try {
    expect(await owner.handle('status', () => true)).toEqual({
      success: true,
      code: 'SELECTED',
      selected: true,
      available: true,
    });
    const restored = await owner.resolveRoot();
    expect(restored.state).toBe('selected');
    expect(restored.path).toBe(await fs.realpath(selected));
    expect(restored.isCurrent()).toBe(true);
    expect(showOpenDialog).not.toHaveBeenCalled();
  } finally {
    owner.close();
  }
});

function changeDuringRead(file, change, phase = 'read', afterVerification) {
  const open = fs.open.bind(fs);
  let changed = false,
    reads = 0,
    totalBytes = 0;
  const buffers = new Set();
  vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    const handle = await open(...args);
    if (args[0] !== file) return handle;
    if (phase === 'open' && !changed) {
      changed = true;
      await change();
    }
    const read = handle.read.bind(handle);
    handle.read = async (...parameters) => {
      const result = await read(...parameters);
      reads++;
      totalBytes += result.bytesRead;
      buffers.add(parameters[0]);
      if (phase === 'read' && !changed) {
        changed = true;
        await change();
      }
      if (reads === 2 && afterVerification) await afterVerification();
      return result;
    };
    return handle;
  });
  return () => ({ changed, reads, totalBytes, buffers });
}

it('explains the stable complete prefix while a Claude transcript appends during reading', async () => {
  const initial = await fs.readFile(transcript);
  const activity = changeDuringRead(transcript, () =>
    fs.appendFile(transcript, '{"private":"' + secret),
  );
  const result = await service.explain(eventId);
  expect(result.availability).toBe('partial');
  expect(result.toolContext.candidates).toHaveLength(1);
  expect(result.toolContext.candidates[0]).toMatchObject({ toolName: 'Read', deltaMs: 500 });
  expect(result.toolContext.strength).toBe('inferred');
  expect(result.toolContext.reasons).toContain('partial-source');
  for (const raw of [secret, cwd, sessionId, 'call-1', '.env'])
    expect(JSON.stringify(result)).not.toContain(raw);
  expect(activity()).toMatchObject({ changed: true, reads: 2, totalBytes: initial.length * 2 });
  expect([...activity().buffers].every((buffer) => buffer.every((byte) => byte === 0))).toBe(true);
});

it('discards an incomplete UTF-8 suffix when the writer grows the file before the handle snapshot', async () => {
  changeDuringRead(
    transcript,
    () =>
      fs.appendFile(
        transcript,
        Buffer.concat([Buffer.from('{"private":"' + secret), Buffer.from([0xf0, 0x9f])]),
      ),
    'open',
  );
  const result = await service.explain(eventId);
  expect(result.availability).toBe('partial');
  expect(result.toolContext.candidates).toHaveLength(1);
  expect(result.toolContext.candidates[0]).toMatchObject({ toolName: 'Read', deltaMs: 500 });
  expect(result.toolContext.reasons).toContain('partial-source');
  expect(JSON.stringify(result)).not.toContain(secret);
});

it('reserves both transcript reads inside the existing total byte budget', async () => {
  const records = await fs.readFile(transcript);
  await fs.writeFile(
    transcript,
    Buffer.concat([Buffer.from(' '.repeat(512 * 1024) + '\n'), records]),
  );
  const activity = changeDuringRead(transcript, () =>
    fs.appendFile(transcript, '{"private":"' + secret),
  );
  const result = await service.explain(eventId);
  expect(result.availability).toBe('partial');
  expect(result.toolContext.candidates).toHaveLength(1);
  expect(activity().totalBytes).toBe(512 * 1024);
  expect([...activity().buffers].every((buffer) => buffer.every((byte) => byte === 0))).toBe(true);
});

it.each(['shrink', 'replace', 'rewrite-prefix'])(
  'refuses %s rather than treating it as append growth',
  async (mode) => {
    const original = await fs.readFile(transcript);
    changeDuringRead(transcript, async () => {
      if (mode === 'shrink') await fs.truncate(transcript, 1);
      else if (mode === 'replace') {
        await fs.rename(transcript, transcript + '.previous');
        await fs.writeFile(transcript, original);
      } else
        await fs.writeFile(
          transcript,
          Buffer.concat([
            Buffer.from(original.toString('utf8').replaceAll('.env', '.other')),
            Buffer.from('{"private":"' + secret),
          ]),
        );
    });
    const result = await service.explain(eventId);
    expect(result.availability).toBe('unavailable');
    expect(result.toolContext.candidates).toHaveLength(0);
    expect(result.toolContext.reasons).toContain('source-unavailable');
    expect(JSON.stringify(result)).not.toContain(secret);
  },
);

it('keeps registry metadata strict when its file grows during reading', async () => {
  changeDuringRead(registry, () => fs.appendFile(registry, ' '));
  const result = await service.explain(eventId);
  expect(result.availability).toBe('unavailable');
  expect(result.toolContext.candidates).toHaveLength(0);
  expect(result.toolContext.reasons).toContain('source-unavailable');
});

it('refuses metadata-changing in-place writes after verifying a growing window', async () => {
  const original = await fs.readFile(transcript, 'utf8');
  const suffix = '{"private":"' + secret;
  changeDuringRead(
    transcript,
    () => fs.appendFile(transcript, suffix),
    'read',
    () => fs.writeFile(transcript, original.replaceAll('.env', '.xxx') + suffix),
  );
  const result = await service.explain(eventId);
  expect(result.availability).toBe('unavailable');
  expect(result.toolContext.candidates).toHaveLength(0);
  expect(result.toolContext.reasons).toContain('source-unavailable');
});

it('explains a retained observation from a real local transcript without exposing raw content', async () => {
  const result = await service.explain(eventId);
  expect(result.success).toBe(true);
  expect(result.toolContext.strength).toBe('inferred');
  expect(result.toolContext.candidates).toHaveLength(1);
  expect(result.toolContext.candidates[0]).toMatchObject({ toolName: 'Read', deltaMs: 500 });
  for (const raw of [secret, cwd, sessionId, 'call-1', '.env'])
    expect(JSON.stringify(result)).not.toContain(raw);
  expect(result.toolContext.reasons).toContain('clock-skew-assumed-local');
});

it('confirms session ownership from matching live Windows birth, cwd and explicit launch selector without confirming the clock assumption', async () => {
  const ticks = '134373736000000000';
  agents[0].createTime100ns = ticks;
  agents[0].cwd = null;
  const observeProcesses = async () => [
    { ProcessId: 42, CreateTime100ns: ticks, Cwd: cwd + path.sep, SessionId: sessionId },
  ];
  service = createLiveToolContext({
    home,
    getAgents: () => agents,
    now: () => start + 3000,
    observeProcesses,
  });
  service.record({
    eventId,
    pid: 42,
    instanceId: `42:${start}`,
    timestamp: start + 1500,
    file: path.join(cwd, '.env'),
    createTime100ns: ticks,
  });
  const result = await service.explain(eventId);
  expect(result.toolContext.sessionBinding).toBe('confirmed');
  expect(result.toolContext.strength).toBe('inferred');
  expect(result.toolContext.reasons).toContain('exact-session-binding');
  expect(result.toolContext.reasons).toContain('clock-skew-assumed-local');
  expect(JSON.stringify(result)).not.toContain(cwd);
});

it.each(['birth', 'selector', 'drift', 'new-peer', 'same-ms-event', 'missing-event'])(
  'does not confirm uncertain native evidence: %s',
  async (failure) => {
    const ticks = '134373736000000000';
    agents[0].createTime100ns = ticks;
    let observations = 0;
    const observeProcesses = async () => {
      observations++;
      if (failure === 'new-peer' && observations === 2)
        agents.push({ ...agents[0], pid: 43, instanceId: `43:${start}` });
      return [
        {
          ProcessId: 42,
          CreateTime100ns: failure === 'birth' ? '134373736000000001' : ticks,
          Cwd: failure === 'drift' && observations === 2 ? path.join(home, 'other') : cwd,
          SessionId: failure === 'selector' ? null : sessionId,
        },
      ];
    };
    service = createLiveToolContext({
      home,
      getAgents: () => agents,
      now: () => start + 3000,
      observeProcesses,
    });
    service.record({
      eventId,
      pid: 42,
      instanceId: `42:${start}`,
      timestamp: start + 1500,
      file: path.join(cwd, '.env'),
      createTime100ns:
        failure === 'same-ms-event'
          ? '134373736000000001'
          : failure === 'missing-event'
            ? undefined
            : ticks,
    });
    expect((await service.explain(eventId)).toolContext.sessionBinding).toBe('unavailable');
  },
);

it('rejects renderer-shaped objects and unknown event IDs instead of reading requested paths', async () => {
  expect(
    (await service.explain({ eventId, file: transcript })).toolContext.candidates,
  ).toHaveLength(0);
  expect((await service.explain(sessionId)).toolContext.reasons).toContain('context-unavailable');
});

it('rejects a reused PID and an unavailable process population', async () => {
  agents = [{ ...agents[0], startTime: start + 1200, instanceId: `42:${start + 1200}` }];
  expect((await service.explain(eventId)).toolContext.reasons).toContain(
    'process-identity-unavailable',
  );
});

it('rejects an older registry instead of treating startup tolerance as proof of ownership', async () => {
  await fs.writeFile(registry, JSON.stringify({ sessionId, cwd, startedAt: start - 1 }));
  expect((await service.explain(eventId)).toolContext.reasons).toContain(
    'process-binding-mismatch',
  );
});

it('rejects a session shared by two monitored process instances', async () => {
  agents.push({ ...agents[0], pid: 43, instanceId: `43:${start}` });
  await fs.writeFile(
    path.join(path.dirname(registry), '43.json'),
    JSON.stringify({ sessionId, cwd, startedAt: start + 100 }),
  );
  expect((await service.explain(eventId)).toolContext.reasons).toContain(
    'session-binding-mismatch',
  );
});

it.each([
  'new-peer',
  'new-peer-same-session',
  'peer-exit',
  'peer-replaced',
  'invalid-peer',
  'target-replaced',
])(
  'returns unavailable when the metadata-only Claude population changes during reading (%s)',
  async (change) => {
    const peerSession = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const peer = { ...agents[0], pid: 43, instanceId: `43:${start}` };
    const peerRegistry = path.join(path.dirname(registry), '43.json');
    if (!change.startsWith('new-peer')) {
      agents.push(peer);
      await fs.writeFile(
        peerRegistry,
        JSON.stringify({ sessionId: peerSession, cwd, startedAt: start + 100 }),
      );
    }
    const activity = changeDuringRead(transcript, async () => {
      if (change.startsWith('new-peer')) {
        await fs.writeFile(
          peerRegistry,
          JSON.stringify({
            sessionId: change === 'new-peer-same-session' ? sessionId : peerSession,
            cwd,
            startedAt: start + 100,
          }),
        );
        agents.push(peer);
      }
      if (change === 'peer-exit') agents = [agents[0]];
      if (change === 'peer-replaced')
        agents[1] = { ...peer, startTime: start + 1, instanceId: `43:${start + 1}` };
      if (change === 'invalid-peer') agents[1] = { ...peer, instanceIdSource: 'unknown' };
      if (change === 'target-replaced')
        agents[0] = { ...agents[0], startTime: start + 1, instanceId: `42:${start + 1}` };
    });
    const result = await service.explain(eventId);
    expect(activity().changed).toBe(true);
    expect(result.availability).toBe('unavailable');
    expect(result.toolContext.strength).toBe('unattributed');
    expect(result.toolContext.candidates).toEqual([]);
    for (const raw of [secret, cwd, sessionId, peerSession, 'call-1', '.env'])
      expect(JSON.stringify(result)).not.toContain(raw);
  },
);

it('keeps stable distinct metadata-only Claude peers inferred when native inspection is unavailable', async () => {
  const sessions = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'];
  for (const [index, peerSession] of sessions.entries()) {
    const pid = 43 + index;
    agents.push({ ...agents[0], pid, instanceId: `${pid}:${start}` });
    await fs.writeFile(
      path.join(path.dirname(registry), `${pid}.json`),
      JSON.stringify({ sessionId: peerSession, cwd, startedAt: start + 100 }),
    );
  }
  const activity = changeDuringRead(transcript, () => {
    agents = [...agents].reverse();
  });
  const result = await service.explain(eventId);
  expect(activity().changed).toBe(true);
  expect(result.availability).not.toBe('unavailable');
  expect(result.toolContext.sessionBinding).toBe('unavailable');
  expect(result.toolContext.strength).toBe('inferred');
  expect(result.toolContext.candidates).toHaveLength(1);
  for (const raw of [secret, cwd, sessionId, ...sessions, 'call-1', '.env'])
    expect(JSON.stringify(result)).not.toContain(raw);
});

it('rejects distinct Claude instances sharing a PID when native inspection is unavailable', async () => {
  agents.push({ ...agents[0], startTime: start + 1, instanceId: `42:${start + 1}` });
  const result = await service.explain(eventId);
  expect(result.availability).toBe('unavailable');
  expect(result.toolContext.strength).toBe('unattributed');
  expect(result.toolContext.candidates).toEqual([]);
  for (const raw of [secret, cwd, sessionId, 'call-1', '.env'])
    expect(JSON.stringify(result)).not.toContain(raw);
});

it('rejects an already malformed Claude peer when native inspection is unavailable', async () => {
  agents.push({ agent: 'Claude Code', pid: 43 });
  const result = await service.explain(eventId);
  expect(result.availability).toBe('unavailable');
  expect(result.toolContext.candidates).toEqual([]);
  expect(JSON.stringify(result)).not.toContain(secret);
});

it.each(['stable', 'same-session', 'disappears'])(
  'checks peer registry stability across the selected transcript read (%s)',
  async (change) => {
    const ticks = '134373736000000000';
    const peerSession = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const peerRegistry = path.join(path.dirname(registry), '43.json');
    agents[0].createTime100ns = ticks;
    agents.push({ ...agents[0], pid: 43, instanceId: `43:${start}` });
    await fs.writeFile(
      peerRegistry,
      JSON.stringify({ sessionId: peerSession, cwd, startedAt: start + 100 }),
    );
    const observeProcesses = async () => [
      { ProcessId: 42, CreateTime100ns: ticks, Cwd: cwd, SessionId: sessionId },
      { ProcessId: 43, CreateTime100ns: ticks, Cwd: cwd, SessionId: peerSession },
    ];
    service = createLiveToolContext({
      home,
      getAgents: () => agents,
      now: () => start + 3000,
      observeProcesses,
    });
    service.record({
      eventId,
      pid: 42,
      instanceId: `42:${start}`,
      timestamp: start + 1500,
      file: path.join(cwd, '.env'),
      createTime100ns: ticks,
    });
    const activity = changeDuringRead(transcript, async () => {
      if (change === 'same-session')
        await fs.writeFile(
          peerRegistry,
          JSON.stringify({ sessionId, cwd, startedAt: start + 100 }),
        );
      if (change === 'disappears') await fs.unlink(peerRegistry);
    });
    const result = await service.explain(eventId);
    expect(activity().changed).toBe(true);
    expect(
      vi
        .mocked(fs.open)
        .mock.calls.filter(([file]) => String(file).endsWith('.jsonl'))
        .map(([file]) => file),
    ).toEqual([transcript]);
    expect(result.toolContext.sessionBinding).toBe(
      change === 'stable' ? 'confirmed' : 'unavailable',
    );
    if (change !== 'stable') expect(result.toolContext.candidates).toHaveLength(0);
  },
);

it('requires a safe session filename', async () => {
  await fs.writeFile(
    registry,
    JSON.stringify({ sessionId: '../private', cwd, startedAt: start + 100 }),
  );
  expect((await service.explain(eventId)).toolContext.candidates).toHaveLength(0);
});

it('retains truncated-source uncertainty and does not expose an unfinished private line', async () => {
  await fs.appendFile(transcript, '{"private":"' + secret);
  const result = await service.explain(eventId);
  expect(result.toolContext.strength).toBe('inferred');
  expect(result.toolContext.reasons).toContain('partial-source');
  expect(JSON.stringify(result)).not.toContain(secret);
});

it('does not associate timing overlap with a different object', async () => {
  await fs.writeFile(
    transcript,
    (await fs.readFile(transcript, 'utf8')).replaceAll('.env', 'different.txt'),
  );
  const result = await service.explain(eventId);
  expect(result.toolContext.candidates).toHaveLength(0);
  expect(result.toolContext.reasons).toContain('time-overlap-without-object-match');
});

it('rejects process snapshot drift while reading the source', async () => {
  let reads = 0;
  service = createLiveToolContext({
    home,
    now: () => start + 3000,
    getAgents: () => (++reads === 1 ? agents : []),
  });
  service.record({
    eventId,
    pid: 42,
    instanceId: `42:${start}`,
    timestamp: start + 1500,
    file: path.join(cwd, '.env'),
  });
  expect((await service.explain(eventId)).toolContext.reasons).toContain(
    'process-binding-mismatch',
  );
});

it('refuses linked transcript data', async () => {
  const link = transcript + '.original';
  await fs.rename(transcript, link);
  await fs.link(link, transcript);
  expect((await service.explain(eventId)).toolContext.candidates).toHaveLength(0);
});

it('reads the bounded tail of a large live transcript without treating it as complete', async () => {
  const records = await fs.readFile(transcript);
  await fs.writeFile(
    transcript,
    Buffer.concat([Buffer.from(' '.repeat(512 * 1024) + '\n'), records]),
  );
  const result = await service.explain(eventId);
  expect(result.toolContext.candidates).toHaveLength(1);
  expect(result.toolContext.strength).toBe('inferred');
  expect(result.toolContext.reasons).toContain('partial-source');
});

it('rejects an unavailable process population', async () => {
  agents = [];
  expect((await service.explain(eventId)).toolContext.reasons).toContain(
    'process-identity-unavailable',
  );
});

it('rejects a registry for a different observed working directory', async () => {
  agents[0].cwd = path.join(home, 'other-project');
  expect((await service.explain(eventId)).toolContext.reasons).toContain(
    'process-binding-mismatch',
  );
});

it('requires an OS-witnessed process identity', async () => {
  agents[0].instanceIdSource = 'unknown';
  expect((await service.explain(eventId)).toolContext.reasons).toContain(
    'process-identity-unavailable',
  );
});

it('expires retained observations instead of explaining indefinitely old data', async () => {
  service = createLiveToolContext({ home, getAgents: () => agents, now: () => start + 1000000 });
  service.record({
    eventId,
    pid: 42,
    instanceId: `42:${start}`,
    timestamp: start + 1500,
    file: path.join(cwd, '.env'),
  });
  expect((await service.explain(eventId)).toolContext.reasons).toContain('context-unavailable');
});
