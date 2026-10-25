import { afterEach, beforeEach, expect, it } from 'vitest';
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
  service = createLiveToolContext({ home, getAgents: () => agents, now: () => start + 3000 });
  service.record({
    eventId,
    pid: 42,
    instanceId: `42:${start}`,
    timestamp: start + 1500,
    file: path.join(cwd, '.env'),
  });
});
afterEach(async () => {
  if (home) await fs.rm(home, { recursive: true, force: true });
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
