import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { createLiveToolContext } = require('../../src/main/live-tool-context');
let home, cwd, agents, service, registry, transcript;
const start = 1792900000000;
const sessionId = '12345678-1234-4234-9234-123456789abc';
const eventId = '98765432-1234-4234-9234-123456789abc';
const secret = 'PRIVATE_PROMPT_AND_ARGUMENT_123';

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
  vi.restoreAllMocks();
  if (home) await fs.rm(home, { recursive: true, force: true });
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
