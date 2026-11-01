import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createSecurityBatcher } = require('../../src/main/ipc-batcher');
const roots = [];
const pipelines = [];
function fixture(options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-pipe-'));
  roots.push(directory);
  const delivered = [];
  const pipeline = createSecurityBatcher({
    directory,
    capacity: 2,
    byteCapacity: 4096,
    intervalMs: 60000,
    consume: (records) => {
      delivered.push(...records);
      return true;
    },
    ...options,
  });
  pipelines.push(pipeline);
  return { pipeline, directory, delivered };
}
const file = (id) => ({
  type: 'file-access',
  sensor: 'file-watch',
  timestamp: 1700000000000 + id,
  details: {
    agent: 'test',
    pid: 12,
    instanceId: '12:100',
    action: 'read',
    path: `/fixture/${id}`,
    severity: 'sensitive',
    attribution: null,
    extra: { prompt: 'DO NOT STORE' },
  },
});
const rejectionCases = [
  ['replay-pending', 'replay-pending'],
  ['invalid-record', 'invalid-record'],
  ['projection-oversize', 'record-oversize'],
  ['bucket-oversize', 'record-oversize'],
];
function rejectedInput(kind, id) {
  const input = file(id);
  if (kind === 'invalid-record') input.type = 'unsupported';
  if (kind === 'projection-oversize') input.details.path = '\u754c'.repeat(24000);
  if (kind === 'bucket-oversize') input.details.path = '/fixture/' + 'x'.repeat(5000);
  return input;
}
function rejectionFixture(kind, options = {}) {
  const value = fixture({ consume: () => false, ...options });
  if (kind !== 'replay-pending') return value;
  value.pipeline.push(file(1));
  value.pipeline.push(file(2));
  value.pipeline.destroy();
  const pipeline = createSecurityBatcher({
    directory: value.directory,
    capacity: 2,
    byteCapacity: 4096,
    intervalMs: 60000,
    consume: () => false,
    ...options,
  });
  pipelines.push(pipeline);
  return { ...value, pipeline };
}
afterEach(() => {
  for (const p of pipelines.splice(0)) p.destroy();
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('security event pipeline', () => {
  it('samples a monotonic clock with a unique batcher generation without changing admission', () => {
    let clock = 10.9;
    const first = fixture({
      sampleClock: () => clock,
      sampleGeneration: () => '11111111-1111-4111-8111-111111111111',
    });
    const second = fixture({
      sampleClock: () => 3,
      sampleGeneration: () => '22222222-2222-4222-8222-222222222222',
    });
    const initial = first.pipeline.getStats();
    expect(initial.sampleMonotonicMs).toBe(10);
    expect(initial.sampleGeneration).toBe('11111111-1111-4111-8111-111111111111');
    expect(second.pipeline.getStats().sampleGeneration).not.toBe(initial.sampleGeneration);
    first.pipeline.push(file(1));
    clock = 2110;
    const later = first.pipeline.getStats();
    expect(later.sampleMonotonicMs).toBe(2110);
    expect(later.sampleGeneration).toBe(initial.sampleGeneration);
    expect(later.sensors['file-watch'].accepted).toBe(1);
    expect(JSON.parse(JSON.stringify(later)).sampleMonotonicMs).toBe(2110);
    clock = Infinity;
    expect(first.pipeline.getStats().sampleMonotonicMs).toBeNull();
  });
  it('spills bounded batches and deletes them only after durable acknowledgement', () => {
    let acknowledge = false;
    const received = [];
    const { pipeline, directory } = fixture({
      consume: (rows) => {
        received.push(...rows);
        return acknowledge;
      },
    });
    for (let id = 0; id < 5; id++) pipeline.push(file(id));
    expect(pipeline.getStats().sensors['file-watch'].buffered).toBeLessThanOrEqual(2);
    expect(fs.readdirSync(directory).some((name) => name.endsWith('.spill'))).toBe(true);
    const bytes = fs
      .readdirSync(directory)
      .filter((name) => name.endsWith('.spill'))
      .map((name) => fs.readFileSync(path.join(directory, name), 'utf8'))
      .join('\n');
    expect(bytes).not.toContain('DO NOT STORE');
    pipeline.flush();
    expect(pipeline.getStats().spill.records).toBe(4);
    acknowledge = true;
    pipeline.flush();
    expect(pipeline.getStats().spill.records).toBe(0);
    expect(received.slice(-5).map((r) => r.details.path)).toEqual(
      Array.from({ length: 5 }, (_, id) => `/fixture/${id}`),
    );
    expect(new Set(received.slice(-5).map((r) => r.deliveryId)).size).toBe(5);
    expect(JSON.stringify(received)).not.toContain('DO NOT STORE');
  });

  it('replays restart history before fresh admission without changing identity or observation time', () => {
    const { pipeline, directory } = fixture({ consume: () => false });
    for (let id = 0; id < 5; id++) pipeline.push(file(id));
    pipeline.destroy();
    const rows = [];
    let acknowledge = false;
    const restart = createSecurityBatcher({
      directory,
      intervalMs: 60000,
      consume: (records) => {
        rows.push(...records);
        return acknowledge;
      },
    });
    pipelines.push(restart);
    expect(restart.push(file(99))).toBe(false);
    acknowledge = true;
    restart.flush();
    const historical = rows.filter((r) => r.type === 'file-access').slice(-5);
    expect(historical.map((r) => r.details.path)).toEqual(
      Array.from({ length: 5 }, (_, i) => `/fixture/${i}`),
    );
    expect(historical.every((r) => r.replayed && r.details.instanceId === '12:100')).toBe(true);
    expect(historical[0].timestamp).toBe(1700000000000);
    expect(restart.push(file(100))).toBe(true);
    restart.flush();
    expect(rows.at(-1).details.path).toBe('/fixture/100');
    expect(rows.filter((r) => r.type === 'pipeline-loss').at(-1).details.extra).toMatchObject({
      code: 'replay-pending',
      count: 1,
    });
  });

  it.each(rejectionCases)(
    'recovers exact %s rejection loss after interruption before flush or destroy',
    (kind, code) => {
      vi.useFakeTimers();
      try {
        const { pipeline, directory } = rejectionFixture(kind);
        expect(pipeline.push(rejectedInput(kind, 99))).toBe(false);
        expect(pipeline.push(rejectedInput(kind, 98))).toBe(false);
        const before = pipeline.getStats();
        const ledgerPath = path.join(directory, 'loss.json');
        const saved = fs.existsSync(ledgerPath)
          ? JSON.parse(fs.readFileSync(ledgerPath, 'utf8'))
          : null;
        vi.clearAllTimers(); // Interrupt without calling this instance's shutdown hooks.
        const replayed = [];
        const restart = createSecurityBatcher({
          directory,
          intervalMs: 60000,
          consume: (rows) => {
            replayed.push(...rows);
            return true;
          },
        });
        pipelines.push(restart);
        const markers = replayed.filter((row) => row.type === 'pipeline-loss');
        expect(markers).toHaveLength(1);
        expect(markers[0]).toMatchObject({
          deliveryId: saved.pending[0].deliveryId,
          timestamp: file(99).timestamp,
          replayed: true,
          details: { path: '' },
        });
        expect(markers[0].details.extra).toEqual({
          code,
          sensor: 'file-watch',
          count: 2,
          firstTimestamp: file(98).timestamp,
          lastTimestamp: file(99).timestamp,
          unknownCount: false,
        });
        expect(before).toMatchObject({
          pendingLoss: 2,
          markerDurable: true,
          health: { state: 'DEGRADED', lossCount: 2 },
        });
        const history = replayed.filter((row) => row.type === 'file-access');
        expect(history.map((row) => row.details.path)).toEqual(
          kind === 'replay-pending' ? ['/fixture/1', '/fixture/2'] : [],
        );
        expect(history.every((row) => row.replayed && row.details.instanceId === '12:100')).toBe(
          true,
        );
        expect(restart.push(file(100))).toBe(true);
        restart.flush();
        expect(replayed.at(-1).details.path).toBe('/fixture/100');
      } finally {
        vi.clearAllTimers();
        vi.useRealTimers();
      }
    },
  );

  it.each(rejectionCases)(
    'retains %s rejection loss through failed ledger writes and persistence recovery',
    (kind, code) => {
      vi.useFakeTimers();
      let failLossWrite = false;
      let failedWrites = 0;
      try {
        const { pipeline, directory } = rejectionFixture(kind, {
          fs: {
            ...fs,
            renameSync: (from, to) => {
              if (failLossWrite && to.endsWith('loss.json')) {
                failedWrites++;
                throw new Error('private storage failure');
              }
              fs.renameSync(from, to);
            },
          },
        });
        failLossWrite = true;
        expect(pipeline.push(rejectedInput(kind, 99))).toBe(false);
        expect(pipeline.push(rejectedInput(kind, 98))).toBe(false);
        expect(failedWrites).toBe(2);
        expect(pipeline.getStats()).toMatchObject({
          pendingLoss: 2,
          markerDurable: false,
          health: { state: 'DEGRADED', lossCount: 2 },
        });
        failLossWrite = false;
        pipeline.flush(); // Persist the pending marker; the consumer still refuses it.
        expect(pipeline.getStats()).toMatchObject({ pendingLoss: 2, markerDurable: true });
        const saved = JSON.parse(fs.readFileSync(path.join(directory, 'loss.json'), 'utf8'));
        expect(saved.pending).toEqual([]);
        expect(saved.inflight).toHaveLength(1);
        expect(JSON.stringify(saved)).not.toContain('private storage failure');
        vi.clearAllTimers();
        const replayed = [];
        const restart = createSecurityBatcher({
          directory,
          intervalMs: 60000,
          consume: (rows) => {
            replayed.push(...rows);
            return true;
          },
        });
        pipelines.push(restart);
        const markers = replayed.filter((row) => row.type === 'pipeline-loss');
        expect(markers).toHaveLength(1);
        expect(markers[0].deliveryId).toBe(saved.inflight[0].deliveryId);
        expect(markers[0].details.extra).toEqual({
          code,
          sensor: 'file-watch',
          count: 2,
          firstTimestamp: file(98).timestamp,
          lastTimestamp: file(99).timestamp,
          unknownCount: false,
        });
        expect(
          replayed.filter((row) => row.type === 'file-access').map((row) => row.details.path),
        ).toEqual(kind === 'replay-pending' ? ['/fixture/1', '/fixture/2'] : []);
        expect(restart.getStats().pendingLoss).toBe(0);
      } finally {
        failLossWrite = false;
        vi.clearAllTimers();
        vi.useRealTimers();
      }
    },
  );

  it('keeps ordinary admission free of loss-ledger synchronization', () => {
    const renameSync = vi.fn((from, to) => fs.renameSync(from, to));
    const fsyncSync = vi.fn((fd) => fs.fsyncSync(fd));
    const { pipeline, directory, delivered } = fixture({ fs: { ...fs, renameSync, fsyncSync } });
    expect(pipeline.push(file(1))).toBe(true);
    pipeline.flush();
    expect(delivered.map((row) => row.details.path)).toEqual(['/fixture/1']);
    expect(renameSync).not.toHaveBeenCalled();
    expect(fsyncSync).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(directory, 'loss.json'))).toBe(false);
  });

  it('counts quota rejection exactly and persists its fixed-code marker with degraded health', () => {
    const { pipeline, delivered } = fixture({ diskQuotaBytes: 65536 });
    const admitted = Array.from({ length: 9 }, (_, id) => pipeline.push(file(id)));
    expect(admitted).toEqual([true, true, false, false, false, false, false, false, false]);
    pipeline.flush();
    const markers = delivered.filter((r) => r.type === 'pipeline-loss');
    expect(markers).toHaveLength(1);
    expect(markers[0].details.extra).toEqual({
      code: 'spill-quota',
      sensor: 'file-watch',
      count: 7,
      firstTimestamp: 1700000000002,
      lastTimestamp: 1700000000008,
      unknownCount: false,
    });
    expect(pipeline.getStats().health).toMatchObject({ state: 'DEGRADED', lossCount: 7 });
    expect(delivered.filter((r) => r.type === 'file-access').map((r) => r.details.path)).toEqual([
      '/fixture/0',
      '/fixture/1',
    ]);
    expect(
      delivered.filter((r) => r.type === 'file-access').length +
        pipeline.getStats().health.lossCount,
    ).toBe(9);
    expect(pipeline.getStats().spill.bytes).toBeLessThanOrEqual(65536);
  });

  it('keeps exact loss pending when ENOSPC prevents both event spill and marker acknowledgement', () => {
    let writable = false;
    const fakeFs = {
      ...fs,
      writeFileSync: (...args) => {
        if (!writable) throw Object.assign(new Error('PRIVATE_STORAGE_ERROR'), { code: 'ENOSPC' });
        return fs.writeFileSync(...args);
      },
    };
    const received = [];
    const { pipeline } = fixture({
      fs: fakeFs,
      consume: (rows) => {
        if (!writable) return false;
        received.push(...rows);
        return true;
      },
    });
    for (let id = 0; id < 7; id++) pipeline.push(file(id));
    pipeline.flush();
    expect(pipeline.getStats()).toMatchObject({ pendingLoss: 5, markerDurable: false });
    expect(JSON.stringify(pipeline.getStats())).not.toContain('PRIVATE_STORAGE_ERROR');
    writable = true;
    pipeline.flush();
    expect(received.find((r) => r.type === 'pipeline-loss').details.extra.count).toBe(5);
    const recovered = received.filter((r) => r.type === 'file-access');
    expect(recovered.map((r) => r.details.path)).toEqual(['/fixture/0', '/fixture/1']);
    expect(
      new Set(recovered.map((r) => r.deliveryId)).size + pipeline.getStats().health.lossCount,
    ).toBe(7);
    expect(pipeline.getStats().pendingLoss).toBe(0);
  });

  it.each(['payload', 'metadata'])(
    'quarantines corrupt %s and continues with later segments',
    (damage) => {
      const { pipeline, directory } = fixture({ consume: () => false });
      for (let id = 0; id < 5; id++) pipeline.push(file(id));
      pipeline.destroy();
      const name = fs
        .readdirSync(directory)
        .filter((n) => n.endsWith('.spill'))
        .sort()[0];
      const target = path.join(directory, name);
      const raw = fs.readFileSync(target, 'utf8');
      fs.writeFileSync(
        target,
        damage === 'payload' ? raw.slice(0, raw.indexOf('\n') + 1) + 'BAD' : 'BAD',
      );
      const rows = [];
      const restart = createSecurityBatcher({
        directory,
        consume: (records) => {
          rows.push(...records);
          return true;
        },
      });
      pipelines.push(restart);
      restart.flush();
      expect(rows.filter((r) => r.type === 'file-access').map((r) => r.details.path)).toEqual([
        '/fixture/2',
        '/fixture/3',
        '/fixture/4',
      ]);
      const marker = rows.find((r) => r.type === 'pipeline-loss');
      expect(marker.details.extra).toMatchObject(
        damage === 'payload'
          ? { code: 'spill-corrupt', count: 2, unknownCount: false }
          : { code: 'spill-corrupt', count: 0, unknownCount: true },
      );
      expect(fs.readdirSync(directory).some((n) => n.endsWith('.bad'))).toBe(true);
    },
  );

  it('retains the same delivery IDs across acknowledgement followed by delete failure and restart', () => {
    const fakeFs = {
      ...fs,
      unlinkSync: () => {
        throw new Error('locked');
      },
    };
    const acknowledged = [];
    const { pipeline, directory } = fixture({
      fs: fakeFs,
      consume: (rows) => {
        acknowledged.push(...rows);
        return true;
      },
    });
    for (let id = 0; id < 3; id++) pipeline.push(file(id));
    pipeline.flush();
    pipeline.destroy();
    const replay = [];
    const restart = createSecurityBatcher({
      directory,
      consume: (rows) => {
        replay.push(...rows);
        return true;
      },
    });
    pipelines.push(restart);
    expect(replay.find((r) => r.details.path === '/fixture/0').deliveryId).toBe(
      acknowledged.find((r) => r.details.path === '/fixture/0').deliveryId,
    );
    expect(replay.filter((r) => r.type === 'file-access')).toHaveLength(3);
  });

  it('retries only deletion after a segment acknowledgement within the same process', () => {
    const { pipeline, directory } = fixture({ consume: () => false });
    for (let id = 0; id < 5; id++) pipeline.push(file(id));
    pipeline.destroy();
    let locked = true;
    const rows = [];
    const restart = createSecurityBatcher({
      directory,
      intervalMs: 60000,
      fs: {
        ...fs,
        unlinkSync: (target) => {
          if (locked && target.endsWith('.spill')) throw new Error('locked');
          return fs.unlinkSync(target);
        },
      },
      consume: (records) => {
        rows.push(...records);
        return true;
      },
    });
    pipelines.push(restart);
    for (let i = 0; i < 20; i++) restart.flush();
    expect(rows.filter((r) => r.type === 'file-access')).toHaveLength(2);
    expect(rows.filter((r) => r.type === 'pipeline-loss')).toHaveLength(1);
    expect(restart.getStats().replayPending).toBe(true);
    locked = false;
    restart.flush();
    expect(rows.filter((r) => r.type === 'file-access').map((r) => r.details.path)).toEqual([
      '/fixture/0',
      '/fixture/1',
      '/fixture/2',
      '/fixture/3',
      '/fixture/4',
    ]);
    expect(restart.getStats()).toMatchObject({ replayPending: false, spill: { records: 0 } });
  });

  it('bounds sensor cardinality and bytes, and snapshots allowed nested fields before spill', () => {
    const { pipeline, delivered } = fixture({ capacity: 100, byteCapacity: 1024 });
    const event = file(0);
    event.details.attribution = { status: 'confirmed', evidence: ['handle-scan-pid'] };
    pipeline.push(event);
    event.details.attribution.evidence[0] = 'PRIVATE_AFTER_ADMISSION';
    for (let id = 1; id < 20; id++) pipeline.push(file(id));
    for (let id = 0; id < 100; id++) pipeline.push({ ...file(id), sensor: `untrusted-${id}` });
    pipeline.push({ ...file(99), details: { ...file(99).details, path: 'x'.repeat(33000) } });
    pipeline.flush();
    const stats = pipeline.getStats();
    expect(Object.keys(stats.sensors)).toHaveLength(5);
    expect(stats.sensors['file-watch'].highWaterBytes).toBeLessThanOrEqual(1024);
    expect(stats.sensors.other.lost).toBe(100);
    expect(JSON.stringify(delivered)).not.toContain('PRIVATE_AFTER_ADMISSION');
    expect(delivered.find((r) => r.type === 'file-access').details.attribution.evidence).toEqual([
      'handle-scan-pid',
    ]);
  });

  it('refuses a symlinked store without touching its target', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-pipe-link-'));
    roots.push(root);
    const target = path.join(root, 'target');
    fs.mkdirSync(target);
    const link = path.join(root, 'link');
    fs.symlinkSync(target, link, 'junction');
    const pipeline = createSecurityBatcher({ directory: link, consume: () => true });
    pipelines.push(pipeline);
    expect(pipeline.push(file(1))).toBe(false);
    expect(pipeline.getStats().health.state).toBe('DEGRADED');
    expect(fs.readdirSync(target)).toEqual([]);
  });

  it('audit fsync and partial append failures retain pipeline ownership and a valid hash chain', async () => {
    delete require.cache[require.resolve('../../src/main/audit-logger')];
    const audit = require('../../src/main/audit-logger');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-pipe-audit-'));
    roots.push(root);
    audit.init({ userDataPath: root });
    await audit._awaitIndexForTest();
    const { pipeline } = fixture({ consume: audit.persistBatch });
    try {
      pipeline.push(file(0));
      const original = fs.writeSync;
      const write = vi
        .spyOn(fs, 'writeSync')
        .mockImplementation((fd, buffer, offset, length, position) => {
          original(fd, buffer, offset, Math.min(20, length), position);
          throw new Error('partial');
        });
      pipeline.flush();
      write.mockRestore();
      expect(pipeline.getStats().sensors['file-watch'].buffered).toBe(1);
      const sync = vi.spyOn(fs, 'fsyncSync').mockImplementationOnce(() => {
        throw new Error('full');
      });
      pipeline.flush();
      sync.mockRestore();
      expect(pipeline.getStats().sensors['file-watch'].buffered).toBe(1);
      pipeline.flush();
      const names = fs.readdirSync(audit.getLogDir()).filter((n) => n.endsWith('.json'));
      const target = path.join(audit.getLogDir(), names[0]);
      expect(audit.verifyChain(target).valid, audit.verifyChain(target).reason).toBe(true);
      const rows = fs.readFileSync(target, 'utf8').trim().split('\n').map(JSON.parse);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        timestamp: '2023-11-14T22:13:20.000Z',
        instanceId: '12:100',
      });
    } finally {
      vi.restoreAllMocks();
      pipeline.destroy();
      audit.shutdown();
    }
  });

  it('accounts an undeletable partial spill and stops additional file creation', () => {
    const fakeFs = {
      ...fs,
      writeFileSync: (fd, data) => {
        fs.writeFileSync(fd, String(data).slice(0, 20));
        throw new Error('disk');
      },
      unlinkSync: () => {
        throw new Error('locked');
      },
      renameSync: () => {
        throw new Error('locked');
      },
    };
    const { pipeline, directory } = fixture({ fs: fakeFs, consume: () => false });
    for (let id = 0; id < 100; id++) pipeline.push(file(id));
    expect(fs.readdirSync(directory).filter((name) => name.endsWith('.tmp'))).toHaveLength(1);
    expect(pipeline.getStats().spill).toMatchObject({ blocked: true, bytes: 20, files: 1 });
  });

  it('retains corruption loss ownership across interruption between ledger persistence and quarantine', () => {
    const { pipeline, directory } = fixture({ consume: () => false });
    for (let id = 0; id < 3; id++) pipeline.push(file(id));
    pipeline.destroy();
    const target = path.join(
      directory,
      fs
        .readdirSync(directory)
        .filter((name) => name.endsWith('.spill'))
        .sort()[0],
    );
    const text = fs.readFileSync(target, 'utf8');
    fs.writeFileSync(target, text.slice(0, text.indexOf('\n') + 1) + 'BAD');
    const interrupted = createSecurityBatcher({
      directory,
      consume: () => false,
      fs: {
        ...fs,
        renameSync: (a, b) => {
          if (b.endsWith('.bad')) throw new Error('locked');
          return fs.renameSync(a, b);
        },
      },
    });
    interrupted.destroy();
    const rows = [];
    const restart = createSecurityBatcher({
      directory,
      consume: (records) => {
        rows.push(...records);
        return true;
      },
    });
    pipelines.push(restart);
    restart.flush();
    const losses = rows.filter(
      (r) => r.type === 'pipeline-loss' && r.details.extra.code === 'spill-corrupt',
    );
    expect(losses.reduce((sum, row) => sum + row.details.extra.count, 0)).toBe(2);
    expect(rows.filter((r) => r.type === 'file-access').map((r) => r.details.path)).toEqual([
      '/fixture/2',
    ]);
  });

  it('keeps attempted marker generations immutable when ledger clearing fails and new losses arrive', () => {
    let failClear = false;
    let failAgain = true;
    const emitted = [];
    const fakeFs = {
      ...fs,
      renameSync: (a, b) => {
        if (failClear && b.endsWith('loss.json')) throw new Error('locked');
        fs.renameSync(a, b);
      },
    };
    const { pipeline } = fixture({
      diskQuotaBytes: 65536,
      fs: fakeFs,
      consume: (rows) => {
        emitted.push(...structuredClone(rows));
        failClear = failAgain;
        return true;
      },
    });
    for (let id = 0; id < 3; id++) pipeline.push(file(id));
    pipeline.flush();
    for (let id = 3; id < 5; id++) pipeline.push(file(id));
    for (let i = 0; i < 20; i++) pipeline.flush();
    const markers = emitted.filter((r) => r.type === 'pipeline-loss');
    expect(markers).toHaveLength(1);
    expect(markers[0].details.extra.count).toBe(1);
    expect(pipeline.getStats().pendingLoss).toBe(3);
    failAgain = false;
    failClear = false;
    pipeline.flush();
    pipeline.flush();
    const unique = new Map(
      emitted.filter((r) => r.type === 'pipeline-loss').map((r) => [r.deliveryId, r]),
    );
    expect(unique.size).toBe(2);
    expect([...unique.values()].reduce((sum, row) => sum + row.details.extra.count, 0)).toBe(3);
    expect(pipeline.getStats().pendingLoss).toBe(0);
  });

  it('replays the same marker ID after restart if acknowledged ledger clearing failed', () => {
    let failClear = false;
    const emitted = [];
    const { pipeline, directory } = fixture({
      diskQuotaBytes: 65536,
      fs: {
        ...fs,
        renameSync: (a, b) => {
          if (failClear && b.endsWith('loss.json')) throw new Error('locked');
          fs.renameSync(a, b);
        },
      },
      consume: (rows) => {
        emitted.push(...rows);
        failClear = true;
        return true;
      },
    });
    for (let id = 0; id < 3; id++) pipeline.push(file(id));
    pipeline.flush();
    pipeline.destroy();
    const original = emitted.find((r) => r.type === 'pipeline-loss');
    expect(emitted.filter((r) => r.type === 'pipeline-loss')).toHaveLength(1);
    const replay = [];
    const restart = createSecurityBatcher({
      directory,
      consume: (rows) => {
        replay.push(...rows);
        return true;
      },
    });
    pipelines.push(restart);
    expect(replay.find((r) => r.deliveryId === original.deliveryId).details).toEqual(
      original.details,
    );
  });

  it.each(['rollback-failed', 'legacy-partial', 'rollback-no-lf', 'legacy-no-lf'])(
    'blocks acknowledgement behind an unrepaired %s audit tail',
    async (failure) => {
      delete require.cache[require.resolve('../../src/main/audit-logger')];
      const audit = require('../../src/main/audit-logger');
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-pipe-tail-'));
      roots.push(root);
      audit.init({ userDataPath: root });
      await audit._awaitIndexForTest();
      const { pipeline } = fixture({ consume: audit.persistBatch });
      try {
        pipeline.push(file(100));
        pipeline.flush(); // Seed a successful cached chain before injecting ambiguity.
        if (failure.startsWith('legacy')) {
          audit.log('ordinary-event', { agent: 'fixture' });
          const append = fs.appendFileSync;
          vi.spyOn(fs, 'appendFileSync').mockImplementation((target, text) => {
            append(target, text.slice(0, failure.endsWith('no-lf') ? -1 : 20));
            throw new Error('partial');
          });
        } else {
          const write = fs.writeSync;
          vi.spyOn(fs, 'writeSync').mockImplementation((fd, buffer, offset, length, position) => {
            write(
              fd,
              buffer,
              offset,
              failure.endsWith('no-lf') ? length - 1 : Math.min(20, length),
              position,
            );
            throw new Error('partial');
          });
          vi.spyOn(fs, 'ftruncateSync').mockImplementation(() => {
            throw new Error('cannot-rollback');
          });
        }
        pipeline.push(file(0));
        pipeline.flush();
        vi.restoreAllMocks();
        const target = path.join(
          audit.getLogDir(),
          fs.readdirSync(audit.getLogDir()).find((name) => name.endsWith('.json')),
        );
        const damaged = fs.readFileSync(target, 'utf8');
        pipeline.flush();
        pipeline.flush();
        expect(fs.readFileSync(target, 'utf8')).toBe(damaged);
        expect(pipeline.getStats().sensors['file-watch']).toMatchObject({
          buffered: 1,
          delivered: 1,
        });
        expect(audit.getDeliveryStatus().writeFailed).toBe(true);
        // Complete JSON can verify while still being unsafe to append without LF.
        expect(audit.verifyChain(target).valid).toBe(failure.endsWith('no-lf'));
      } finally {
        vi.restoreAllMocks();
        pipeline.destroy();
        audit.shutdown();
      }
    },
  );

  it('recovers exact corruption and quota loss after interruption without graceful destroy', () => {
    vi.useFakeTimers();
    try {
      const { pipeline, directory } = fixture({ consume: () => false });
      for (let id = 0; id < 3; id++) pipeline.push(file(id));
      pipeline.destroy();
      const target = path.join(
        directory,
        fs
          .readdirSync(directory)
          .filter((name) => name.endsWith('.spill'))
          .sort()[0],
      );
      const raw = fs.readFileSync(target, 'utf8');
      fs.writeFileSync(target, raw.slice(0, raw.indexOf('\n') + 1) + 'BAD');
      createSecurityBatcher({ directory, consume: () => true }); // replay quarantines, but no second timer tick
      vi.clearAllTimers(); // emulate loss of the process without its shutdown hooks
      const rows = [];
      const restart = createSecurityBatcher({
        directory,
        consume: (records) => {
          rows.push(...records);
          return true;
        },
      });
      pipelines.push(restart);
      expect(
        rows
          .filter((r) => r.type === 'pipeline-loss')
          .reduce((n, r) => n + r.details.extra.count, 0),
      ).toBe(2);

      const quota = fixture({ diskQuotaBytes: 65536, consume: () => false });
      for (let id = 0; id < 3; id++) quota.pipeline.push(file(id));
      vi.clearAllTimers();
      const quotaRows = [];
      const recovered = createSecurityBatcher({
        directory: quota.directory,
        diskQuotaBytes: 65536,
        consume: (records) => {
          quotaRows.push(...records);
          return true;
        },
      });
      pipelines.push(recovered);
      expect(quotaRows.find((r) => r.type === 'pipeline-loss').details.extra.count).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('counts remaining volatile custody at shutdown when neither consumer nor spill can accept it', () => {
    const { pipeline } = fixture({ diskQuotaBytes: 65536, consume: () => false });
    for (let id = 0; id < 7; id++) pipeline.push(file(id));
    expect(pipeline.getStats().sensors['file-watch']).toMatchObject({ buffered: 2, lost: 5 });
    pipeline.destroy();
    expect(pipeline.getStats()).toMatchObject({ pendingLoss: 7, markerDurable: true });
    expect(pipeline.getStats().sensors['file-watch']).toMatchObject({ buffered: 0, lost: 7 });
  });
});
