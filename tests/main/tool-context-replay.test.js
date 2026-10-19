import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import Module from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { createSessionContext } = require('../../src/main/session-context');
const { createSessionContextReader } = require('../../src/main/session-context-reader');
const { createToolContext } = require('../../src/main/tool-context-record');
const { createSecurityBatcher, createBatcher } = require('../../src/main/ipc-batcher');
const { FILE_ACCESS_BATCHER_OPTIONS } = require('../../src/main/file-access-batching');
const {
  selection,
  processEvidence,
  verifier,
  event,
  timing,
  sentinels,
  copiedFixture,
  cases,
} = require('../fixtures/session-context/replay-cases.cjs');
const roots = [],
  pipelines = [],
  audits = [];
const actor = { status: 'unattributed', evidence: ['no-owner-match'] };

function directory() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-context-replay-'));
  roots.push(root);
  return root;
}

function scan() {
  const original = Module._load;
  Module._load = function (request) {
    if (request === 'electron')
      return {
        app: { getPath: () => os.tmpdir() },
        safeStorage: { isEncryptionAvailable: () => false },
      };
    return original.apply(this, arguments);
  };
  try {
    // Only the external copied-source mutation run selects this test-only override.
    const target =
      process.env.AEGIS_CONTEXT_REPLAY_SCAN_MODULE || require.resolve('../../src/main/scan-loop');
    delete require.cache[target];
    return require(target);
  } finally {
    Module._load = original;
  }
}

async function replay(spec) {
  const bytes = copiedFixture(spec.fixture, spec.mode, spec.count);
  const stamp = {
    kind: 'regular',
    symlink: false,
    reparse: false,
    volumeId: 'fixture-volume',
    fileId: 'fixture-file',
    size: bytes.length,
    mtimeNs: '100',
    ctimeNs: '200',
  };
  const handle = {
    stat: vi.fn(async () => ({ ...stamp })),
    close: vi.fn(async () => {}),
    read: vi.fn(async (target, offset, length, position) =>
      spec.race === 'short-read'
        ? 0
        : bytes.copy(target, offset, position, Math.min(position + length, bytes.length)),
    ),
  };
  const selected = '/owned-replay/selected.jsonl';
  const files = {
    pathStyle: 'posix',
    statPath: vi.fn(async (file) => {
      expect(file).toBe(selected);
      if (spec.race === 'missing') throw Error('REPLAY_PROMPT_SENTINEL');
      return { ...stamp };
    }),
    openRead: vi.fn(async (file) => {
      expect(file).toBe(selected);
      return handle;
    }),
  };
  if (spec.race === 'changed')
    handle.stat.mockResolvedValueOnce({ ...stamp }).mockResolvedValue({ ...stamp, mtimeNs: '101' });
  if (spec.race === 'replaced')
    files.statPath
      .mockResolvedValueOnce({ ...stamp })
      .mockResolvedValue({ ...stamp, fileId: 'other' });
  const owner = createSessionContext({ digestKey: Buffer.alloc(32, 7) });
  const reader = createSessionContextReader({ files, adapter: owner });
  const batch = await reader.read(spec.source || 'claude-code', selected, selection);
  expect(batch.availability).toBe(
    spec.race ? 'unavailable' : spec.mode === 'truncated' ? 'partial' : 'available',
  );
  const binding = owner.bind(batch, processEvidence, { ...verifier, ...spec.verifier });
  const correlation = owner.correlate(
    { ...event, ...spec.event },
    [binding],
    spec.timing || timing,
  );
  const capsule = createToolContext(correlation);
  expect(capsule).toEqual(spec.want);
  expect(batch.calls).toHaveLength(spec.race ? 0 : spec.count || 1);
  if (spec.fixture === 'codex') expect(batch.calls[0].objectDigest).toBeNull();
  if (spec.fixture === 'gemini' || spec.mode === 'missing-end')
    expect(batch.calls[0].endMs).toBeNull();
  expect(handle.close).toHaveBeenCalledTimes(spec.race === 'missing' ? 0 : 1);
  for (const secret of sentinels)
    expect(JSON.stringify({ batch, binding, correlation, capsule })).not.toContain(secret);
  return capsule;
}

async function custody(capsule, wanted) {
  const loop = scan();
  delete require.cache[require.resolve('../../src/main/audit-logger')];
  const audit = require('../../src/main/audit-logger');
  audits.push(audit);
  audit.init({ userDataPath: directory() });
  await audit._awaitIndexForTest();
  const store = directory();
  const first = createSecurityBatcher({
    directory: store,
    capacity: 1,
    intervalMs: 60000,
    consume: () => false,
  });
  pipelines.push(first);
  loop.init({ audit, securityEvents: first });
  const observation = {
    agent: 'synthetic-os-observation',
    pid: 42,
    instanceId: processEvidence.instanceId,
    file: '/work/private.env',
    action: 'accessed',
    sensitive: true,
    selfAccess: false,
    reason: 'synthetic',
    category: 'ai',
    timestamp: event.atMs,
    attribution: structuredClone(actor),
    toolContext: capsule,
  };
  const live = loop.dedupFileEvent(observation, 'file-handle');
  expect(live).not.toBeNull();
  first.destroy();
  pipelines.pop();
  const spilled = fs
    .readdirSync(store)
    .filter((name) => name.endsWith('.spill'))
    .map((name) => fs.readFileSync(path.join(store, name), 'utf8'))
    .join('\n');
  const pending = spilled
    .split('\n')
    .filter((line) => line.startsWith('['))
    .flatMap(JSON.parse);
  expect(pending).toHaveLength(1);
  // This vertical assertion kills dropping context at real scan audit admission.
  expect(pending[0].details.toolContext).toEqual(wanted);
  expect(pending[0].details.attribution).toEqual(actor);
  expect(pending[0].details).toMatchObject({
    pid: 42,
    instanceId: processEvidence.instanceId,
    agent: 'synthetic-os-observation',
    path: '/work/private.env',
    action: 'accessed',
  });
  const replayed = [];
  const restart = createSecurityBatcher({
    directory: store,
    intervalMs: 60000,
    consume: (rows) => {
      replayed.push(...rows);
      return audit.persistBatch(rows);
    },
  });
  pipelines.push(restart);
  restart.flush();
  expect(restart.getStats().spill.records).toBe(0);
  expect(replayed).toHaveLength(1);
  expect(replayed[0].deliveryId).toBe(pending[0].deliveryId);
  expect(replayed[0].replayed).toBe(true);
  expect(replayed[0].details.toolContext).toEqual(wanted);
  const target = path.join(
    audit.getLogDir(),
    fs.readdirSync(audit.getLogDir()).find((name) => name.endsWith('.json')),
  );
  const persisted = fs.readFileSync(target, 'utf8').trim().split('\n').map(JSON.parse);
  const exported = audit.exportAll();
  const historical = audit.getEntriesBefore('9999-12-31T23:59:59Z', 10);
  for (const rows of [persisted, exported, historical]) {
    expect(rows).toHaveLength(1);
    expect(rows[0].toolContext).toEqual(wanted);
    expect(rows[0].attribution).toEqual(actor);
    expect(rows[0]).toMatchObject({
      pid: 42,
      instanceId: processEvidence.instanceId,
      agent: 'synthetic-os-observation',
      path: '/work/private.env',
      action: 'accessed',
    });
    expect(rows[0].details.deliveryId).toBe(pending[0].deliveryId);
  }
  expect(audit.verifyChain(target).valid).toBe(true);
  const delivered = [];
  const display = createBatcher(
    'file-access',
    (channel, rows) => delivered.push({ channel, rows }),
    FILE_ACCESS_BATCHER_OPTIONS,
  );
  pipelines.push(display);
  display.push(live);
  display.flush();
  expect(delivered).toHaveLength(1);
  expect(delivered[0].channel).toBe('file-access');
  expect(delivered[0].rows).toHaveLength(1);
  expect(delivered[0].rows[0].toolContext).toEqual(wanted);
  expect(delivered[0].rows[0].attribution).toEqual(actor);
  const serialized = JSON.stringify({
    spilled,
    replayed,
    persisted,
    exported,
    historical,
    delivered,
  });
  for (const secret of [...sentinels, 'session-local', 'call-replay-', 'cat '])
    expect(serialized).not.toContain(secret);
}

afterEach(() => {
  for (const pipeline of pipelines.splice(0)) pipeline.destroy();
  for (const audit of audits.splice(0)) audit.shutdown();
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    if (
      path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) ||
      fs.realpathSync(root) !== root ||
      fs.lstatSync(root).isSymbolicLink() ||
      !path.basename(root).startsWith('aegis-context-replay-')
    )
      throw Error('unexpected-replay-root');
    fs.rmSync(root, { recursive: true });
  }
});

describe('fixture reader to audit explanation replay (synthetic verifier; launchAllowed=false)', () => {
  it.each(cases)('$name', async (spec) => {
    const capsule = await replay(spec);
    await custody(capsule, spec.want);
  });
});
