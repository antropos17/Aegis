import { afterEach, beforeEach, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const require = createRequire(import.meta.url);
const { createLedger } = require('../../src/main/token-dedup-ledger');
const adapter = require('../../src/main/token-adapters/claude-code');
const feed = require('../../src/main/token-feed');
const tracker = require('../../src/main/token-tracker');
const collector = require('../../src/main/token-cost-collector');
let directory, file;
const delta = {
  inputTokens: 10,
  outputTokens: 2,
  acceptedCostUsd: 0.00002,
  acceptedEstimated: true,
  acceptedPricingEstimated: true,
};
function accept(ledger, session, id) {
  ledger.withSession(session, (state) => {
    expect(state.seenIds.has(id)).toBe(false);
    state.seenIds.add(id);
    state.offset = 200;
    ledger.accumulate([delta]);
  });
}
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-durable-token-'));
  file = path.join(directory, 'ledger.sqlite');
});
afterEach(() => {
  feed._resetForTest();
  tracker._resetForTest();
  fs.rmSync(directory, { recursive: true, force: true });
});

it('reopens accepted prices, IDs, cursor and allocates a distinct session key', () => {
  let ledger = createLedger({ file });
  accept(ledger, 'session-a', 'message');
  ledger.commit();
  ledger.close();
  expect(fs.existsSync(file)).toBe(true);
  ledger = createLedger({ file });
  expect(ledger.getAggregate()).toEqual({
    inputTokens: 10,
    outputTokens: 2,
    costUsd: 0.00002,
    estimated: true,
    pricingEstimated: true,
  });
  ledger.withSession('session-a', (state) => {
    expect(state.offset).toBe(200);
    expect(state.seenIds.has('message')).toBe(true);
  });
  accept(ledger, 'session-b', 'message');
  ledger.commit();
  expect(ledger.getAggregate().inputTokens).toBe(20);
  ledger.close();
});

it.each(['before', 'after'])(
  'preserves an abrupt child termination %s commit without counting discarded usage',
  async (boundary) => {
    const childFile = path.join(directory, 'child.cjs');
    fs.writeFileSync(
      childFile,
      `
    const { createLedger } = require(${JSON.stringify(require.resolve('../../src/main/token-dedup-ledger'))});
    const ledger = createLedger({file:process.argv[2]});
    ledger.withSession('session', state => {
      state.seenIds.add('message'); state.offset=200;
      ledger.accumulate([${JSON.stringify(delta)}]);
    });
    if(process.argv[3]==='after') ledger.commit();
    process.send('boundary');
    setInterval(()=>{},1000);
  `,
    );
    const child = fork(childFile, [file, boundary], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    try {
      await Promise.race([
        once(child, 'message'),
        once(child, 'exit').then(() => {
          throw Error('child exited early');
        }),
      ]);
      const exit = once(child, 'exit');
      child.kill('SIGKILL');
      await exit;
      if (boundary === 'before' && fs.existsSync(file + '-journal')) {
        const residue = fs.readFileSync(file + '-journal');
        expect(() => createLedger({ file })).toThrow('dedup-journal-not-owned');
        expect(fs.readFileSync(file + '-journal')).toEqual(residue);
        // Controlled small fixture has not spilled database pages. This manual
        // step applies only to the known disposable fixture journal.
        fs.unlinkSync(file + '-journal');
      }
      const ledger = createLedger({ file });
      const committed = boundary === 'after';
      expect(ledger.getAggregate().inputTokens).toBe(committed ? 10 : 0);
      ledger.withSession('session', (state) => {
        expect(state.offset).toBe(committed ? 200 : 0);
        expect(state.seenIds.has('message')).toBe(committed);
      });
      ledger.close();
    } finally {
      child.kill('SIGKILL');
    }
  },
  15000,
);

it('restores historical usage once with no live PID, then accepts only new transcript usage', async () => {
  const birth = 1700000000000;
  const proc = { pid: 42, agent: 'Claude Code', startTime: birth, instanceId: '42:birth' };
  const registryDir = path.join(directory, '.claude', 'sessions');
  const project = path.join(directory, '.claude', 'projects', adapter._encodeCwd(directory));
  fs.mkdirSync(registryDir, { recursive: true });
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(
    path.join(registryDir, '42.json'),
    JSON.stringify({
      sessionId: 'session',
      cwd: directory,
      startedAt: birth,
      procStart: '639162008149103680',
      status: 'idle',
    }),
  );
  const transcript = path.join(project, 'session.jsonl');
  const line = (id) =>
    JSON.stringify({
      type: 'assistant',
      message: {
        id,
        model: 'claude-haiku-4-5-20251001',
        usage: { input_tokens: 10, output_tokens: 2 },
      },
    }) + '\n';
  fs.writeFileSync(transcript, line('one'));
  const setup = () => {
    feed._resetForTest();
    tracker._resetForTest();
    adapter._setHomedirForTest(() => directory);
    adapter._setLedgerFactoryForTest(() => createLedger({ file }));
  };
  setup();
  await collector.collectTokenCosts([proc]);
  expect(tracker.getCost(proc).totalTokens).toBe(12);
  setup();
  await collector.collectTokenCosts([]);
  await collector.collectTokenCosts([]);
  expect(tracker.getAllCosts()).toHaveLength(1);
  expect(tracker.getAllCosts()[0]).toMatchObject({
    historical: true,
    archived: true,
    pid: null,
    instanceId: null,
    totalTokens: 12,
  });
  expect(tracker.getAllCosts()[0].costUsd).toBeCloseTo(0.00002, 12);
  expect(await collector.collectTokenCosts([proc])).toEqual([]);
  expect(tracker.getCost(proc).totalTokens).toBe(0);
  fs.appendFileSync(transcript, line('one') + line('two'));
  expect(await collector.collectTokenCosts([proc])).toHaveLength(1);
  expect(tracker.getCost(proc).totalTokens).toBe(12);
  expect(tracker.getAllCosts().reduce((sum, row) => sum + row.totalTokens, 0)).toBe(24);
});

it('fails closed without modifying foreign files or sidecar links', () => {
  fs.writeFileSync(file, 'foreign');
  expect(() => createLedger({ file })).toThrow('dedup-cache-not-owned');
  expect(fs.readFileSync(file, 'utf8')).toBe('foreign');
  fs.unlinkSync(file);
  const ledger = createLedger({ file });
  ledger.close();
  fs.writeFileSync(file + '-journal', 'foreign');
  expect(() => createLedger({ file })).toThrow('dedup-journal-not-owned');
  expect(fs.readFileSync(file + '-journal', 'utf8')).toBe('foreign');
  fs.writeFileSync(file + '-journal', Buffer.alloc(512));
  expect(() => createLedger({ file })).toThrow('dedup-journal-not-owned');
  expect(fs.statSync(file + '-journal').size).toBe(512);
  const shaped = Buffer.alloc(512);
  shaped.writeUInt32BE(5, 16);
  shaped.writeUInt32BE(512, 20);
  shaped.writeUInt32BE(4096, 24);
  fs.writeFileSync(file + '-journal', shaped);
  expect(() => createLedger({ file })).toThrow('dedup-journal-not-owned');
  expect(fs.readFileSync(file + '-journal')).toEqual(shaped);
  Buffer.from('d9d505f920a163d7', 'hex').copy(shaped);
  fs.writeFileSync(file + '-journal', shaped);
  expect(() => createLedger({ file })).toThrow('dedup-journal-not-owned');
  expect(fs.readFileSync(file + '-journal')).toEqual(shaped);
});

it('rolls back aggregate and IDs together and refuses an incompatible owned schema', () => {
  let ledger = createLedger({ file });
  accept(ledger, 'session', 'first');
  ledger.commit();
  accept(ledger, 'session', 'discarded');
  ledger.rollback();
  ledger.close();
  ledger = createLedger({ file });
  expect(ledger.getAggregate().inputTokens).toBe(10);
  ledger.withSession('session', (state) => {
    expect(state.seenIds.has('first')).toBe(true);
    expect(state.seenIds.has('discarded')).toBe(false);
  });
  ledger.close();
  const db = new DatabaseSync(file);
  db.exec('DROP TABLE aggregate');
  db.close();
  expect(() => createLedger({ file })).toThrow('dedup-schema-incompatible');
  const inspect = new DatabaseSync(file);
  expect(
    inspect.prepare("SELECT name FROM sqlite_master WHERE name='aggregate'").get(),
  ).toBeUndefined();
  inspect.close();
});

it('clears startup unavailable health after successful historical retry without live agents', async () => {
  const ledger = createLedger({ file });
  accept(ledger, 'session', 'first');
  ledger.commit();
  ledger.close();
  feed._resetForTest();
  tracker._resetForTest();
  let clock = 1000;
  let attempts = 0;
  adapter._setNowForTest(() => clock);
  adapter._setLedgerFactoryForTest(() => {
    if (++attempts === 1) throw Error('temporary-unavailable');
    return createLedger({ file });
  });
  await collector.collectTokenCosts([]);
  expect(adapter.getCollectionStatus()).toMatchObject({
    state: 'storage-paused',
    reason: 'unavailable',
  });
  await collector.collectTokenCosts([]);
  expect(attempts).toBe(1);
  clock += 30000;
  await collector.collectTokenCosts([]);
  expect(attempts).toBe(2);
  expect(adapter.getCollectionStatus()).toEqual({ state: 'ready', reason: null, retryAt: null });
  expect(tracker.getAllCosts()).toHaveLength(1);
  expect(tracker.getAllCosts()[0]).toMatchObject({ historical: true, totalTokens: 12 });
  await collector.collectTokenCosts([]);
  expect(tracker.getAllCosts()).toHaveLength(1);
});
