// Disposable benchmark: node scripts/bench-audit-index.mjs [--samples=50] [--rows=25000]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const audit = require('../src/main/audit-logger');
const index = require('../src/main/audit-index');
const rebuild = require('../src/main/audit-index-rebuild');
const chain = require('../src/main/audit-hashchain');
const option = (name, fallback) => {
  const arg = process.argv.find((v) => v.startsWith(`--${name}=`));
  const n = arg ? Number(arg.split('=')[1]) : fallback;
  assert(Number.isSafeInteger(n) && n > 0 && n <= 1000000, `invalid ${name}`);
  return n;
};
const samples = option('samples', 50);
const perDay = option('rows', 25000);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-index-bench-'));
const logDir = path.join(root, 'audit-logs');
const ms = (start) => Number(process.hrtime.bigint() - start) / 1e6;
const types = ['file-access', 'network-connection', 'config-access'];
const dailyFiles = [];
const starts = [];
const now = new Date();
const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
const originalReady = index.isReady;
let monitor;
let originalWrite;
try {
  fs.mkdirSync(logDir);
  let jsonlBytes = 0;
  for (let day = 0; day < 8; day++) {
    const start = midnight - (7 - day) * 86400000;
    starts.push(start);
    const file = path.join(
      logDir,
      `aegis-audit-${new Date(start).toISOString().slice(0, 10)}.json`,
    );
    dailyFiles.push(file);
    let prev = chain.GENESIS;
    const rows = [];
    for (let i = 0; i < perDay; i++) {
      const slot = i % 100;
      const type =
        slot < 70
          ? 'file-access'
          : slot < 85
            ? 'network-connection'
            : slot < 90
              ? 'config-access'
              : slot < 95
                ? i % 2
                  ? 'agent-enter'
                  : 'agent-exit'
                : 'anomaly-alert';
      const rec = {
        timestamp: new Date(start + Math.floor((i * 80000000) / perDay)).toISOString(),
        type: day === 7 && i < 3 ? 'buffer-overflow-drop' : type,
        agent: 'bench-fixture',
        action: 'read',
        path: '/fixture/example',
        severity: 'normal',
        details: slot < 5 ? { pid: 42, attribution: 'confirmed' } : null,
      };
      if (slot >= 5)
        Object.assign(rec, {
          schemaVersion: 1,
          pid: 42,
          instanceId: '42:fixture',
          attribution: null,
        });
      const hash = chain.computeHash(prev, rec);
      rows.push(JSON.stringify({ ...rec, seq: i, hash }));
      prev = hash;
    }
    fs.writeFileSync(file, rows.join('\n') + '\n');
    assert.equal(chain.verifyChain(file).valid, true, 'generated chain');
    jsonlBytes += fs.statSync(file).size;
  }
  // Deliberate rejected line: the intact chains were checked before adding it.
  fs.appendFileSync(dailyFiles[0], 'malformed\n');
  jsonlBytes += Buffer.byteLength('malformed\n');
  assert.equal(chain.verifyChain(dailyFiles[0]).valid, false);
  let peakRss = process.memoryUsage().rss;
  monitor = setInterval(() => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss);
  }, 5);
  index.open({ userDataPath: root });
  let start = process.hrtime.bigint();
  await rebuild.reconcile(logDir);
  const rebuildMs = ms(start);
  const rebuildPeakRss = Math.max(peakRss, process.memoryUsage().rss);
  const totalRows = perDay * 8;
  assert.equal(index.status().rows, totalRows);
  assert.equal(index.status().malformedLines, 1);
  const fullAccounting = index.files();
  const fullEvents = index
    ._dbForTest()
    .prepare('SELECT file, line_no, raw FROM audit_events ORDER BY file, line_no')
    .all();
  index._dbForTest().exec('DELETE FROM audit_files');
  index.setState('building');
  originalWrite = index.writeBatch;
  let batches = 0;
  index.writeBatch = (batch) => {
    const value = originalWrite(batch);
    if (++batches === 3) throw new Error('benchmark interruption after committed batch');
    return value;
  };
  await assert.rejects(rebuild.reconcile(logDir), /benchmark interruption/);
  index.writeBatch = originalWrite;
  originalWrite = null;
  start = process.hrtime.bigint();
  await rebuild.reconcile(logDir);
  const resumeMs = ms(start);
  assert.deepEqual(index.files(), fullAccounting);
  assert.deepEqual(
    index
      ._dbForTest()
      .prepare('SELECT file, line_no, raw FROM audit_events ORDER BY file, line_no')
      .all(),
    fullEvents,
  );
  audit.init({ userDataPath: root });
  await audit._awaitIndexForTest();
  const positions = [
    ['tail', starts[7] + 80000000],
    ['middle', starts[7] + 40000000],
    ['head', starts[7] + 1000],
    ['boundary', starts[7]],
  ];
  const timings = [];
  for (const [position, t] of positions) {
    for (const limit of [25, 500]) {
      for (const filter of [undefined, types]) {
        const before = new Date(t).toISOString();
        const one = (indexed) => {
          index.isReady = indexed ? originalReady : () => false;
          const began = process.hrtime.bigint();
          const answer = audit.getEntriesBefore(before, limit, filter);
          return { elapsed: ms(began), answer };
        };
        assert.deepEqual(one(true).answer, one(false).answer);
        for (const indexed of [false, true]) {
          const times = [];
          for (let i = 0; i < samples; i++) times.push(one(indexed).elapsed);
          times.sort((a, b) => a - b);
          timings.push({
            position,
            limit,
            filtered: !!filter,
            path: indexed ? 'sqlite' : 'jsonl',
            p50Ms: times[Math.ceil(samples * 0.5) - 1],
            p95Ms: times[Math.ceil(samples * 0.95) - 1],
          });
        }
      }
    }
  }
  index.isReady = originalReady;
  // Persist the batch to canon before measuring its projection cost.
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const file = `aegis-audit-${today}.json`;
  const fp = path.join(logDir, file);
  const existing = fs.existsSync(fp) ? fs.readFileSync(fp, 'utf8').trim().split('\n') : [];
  let prev = existing.length ? JSON.parse(existing.at(-1)).hash : chain.GENESIS;
  const lines = [];
  for (let i = 0; i < 50; i++) {
    const rec = {
      timestamp: new Date().toISOString(),
      type: 'file-access',
      agent: 'append-fixture',
    };
    const hash = chain.computeHash(prev, rec);
    lines.push(JSON.stringify({ ...rec, seq: existing.length + i, hash }));
    prev = hash;
  }
  const text = lines.join('\n') + '\n';
  const offsetBefore = fs.existsSync(fp) ? fs.statSync(fp).size : 0;
  fs.appendFileSync(fp, text);
  start = process.hrtime.bigint();
  assert.equal(index.append({ file, offsetBefore, bytes: Buffer.byteLength(text), lines }), true);
  const appendMs = ms(start);
  assert.equal(chain.verifyChain(fp).valid, true);
  assert.equal(index.status().rows, totalRows + 50);
  const db = index._dbForTest();
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const databaseBytes = fs.statSync(path.join(root, 'audit-index', 'audit-index.sqlite')).size;
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
  console.log(
    JSON.stringify(
      {
        runtime: process.versions,
        samples,
        generatedRows: totalRows,
        jsonlBytes,
        databaseBytes,
        rebuildMs,
        rebuildPeakRss,
        resumeMs,
        peakRss,
        append50Ms: appendMs,
        timings,
      },
      null,
      2,
    ),
  );
} finally {
  clearInterval(monitor);
  index.isReady = originalReady;
  if (originalWrite) index.writeBatch = originalWrite;
  await audit._awaitIndexForTest();
  audit.shutdown();
  index.close();
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
}
