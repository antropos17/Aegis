import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import pipelineModule from '../../src/main/security-event-pipeline.js';
import { fixture, ready, event, identity, batch } from './sensor-host-fixtures.js';
const require = createRequire(import.meta.url);
const audit = require('../../src/main/audit-logger');
function removeOwnedFixture(root) {
  if (
    path.dirname(path.resolve(root)) !== path.resolve(os.tmpdir()) ||
    !path.basename(root).startsWith('sensor-host-observation-') ||
    fs.lstatSync(root).isSymbolicLink()
  )
    throw Error('fixture-cleanup-boundary');
  fs.rmSync(root, { recursive: true, force: true });
}

describe('sensor host injected W1pipe admission boundary', () => {
  it('persists actual host capsules through a configured fixture sink, bounded spill, restart and canonical JSONL', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sensor-host-observation-'));
    const directory = path.join(root, 'spill');
    const observed = [];
    const pipeline = pipelineModule.createSecurityBatcher({
      directory,
      capacity: 1,
      intervalMs: 60000,
      consume: () => false,
    });
    let restarted;
    // This explicit fixture projection is not connected to the production coordinator.
    const sink = (row) => {
      observed.push(row);
      return pipeline.push({
        sensor: row.event.kind === 'open' ? 'file-handle' : 'network',
        type: row.event.kind === 'open' ? 'file-access' : 'network-connection',
        timestamp: row.nativeObservation.capture.epochMs,
        details: {
          agent: '',
          pid: null,
          instanceId: null,
          attribution: null,
          action: row.event.kind,
          path: '',
          severity: 'normal',
          nativeObservation: row.nativeObservation,
        },
      });
    };
    const f = fixture({ sink });
    const child = f.start();
    try {
      ready(child);
      child.send(batch(event()));
      child.send(
        batch({
          seq: '2',
          kind: 'connect',
          pid: 73,
          ppid: 1,
          ...identity,
          ts: '1700000000000002',
          family: 4,
          daddr: '203.0.113.1',
          dport: 443,
          saddr: '192.0.2.1',
          sport: 50000,
        }),
      );
      child.send(batch(event('3')));
      expect(pipeline.getStats().spill.records).toBe(2);
      expect(pipeline.getStats().sensors['file-handle'].highWater).toBe(1);
      const expected = observed.map((row) => structuredClone(row.nativeObservation));
      observed[0].nativeObservation.observation.ts = 'PRIVATE_AFTER_ADMISSION';
      pipeline.destroy();
      const stored = fs
        .readdirSync(directory)
        .filter((name) => name.endsWith('.spill'))
        .flatMap((name) => {
          const bytes = fs.readFileSync(path.join(directory, name), 'utf8');
          expect(bytes).not.toContain('PRIVATE_AFTER_ADMISSION');
          return JSON.parse(bytes.slice(bytes.indexOf('\n') + 1));
        });
      expect(stored.map((row) => row.details.extra.nativeObservation)).toEqual(expected);
      const deliveryIds = stored.map((row) => row.deliveryId);
      expect(new Set(deliveryIds).size).toBe(3);
      audit.init({ userDataPath: root });
      await audit._awaitIndexForTest();
      restarted = pipelineModule.createSecurityBatcher({
        directory,
        intervalMs: 60000,
        consume: (records) => audit.persistBatch(records),
      });
      const journal = path.join(
        audit.getLogDir(),
        fs.readdirSync(audit.getLogDir()).find((name) => name.endsWith('.json')),
      );
      const entries = fs
        .readFileSync(journal, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(entries.map((entry) => entry.details.deliveryId)).toEqual(deliveryIds);
      expect(entries.map((entry) => entry.details.nativeObservation)).toEqual(expected);
      expect(entries.map((entry) => entry.type)).toEqual([
        'file-access',
        'network-connection',
        'file-access',
      ]);
      expect(
        entries.every(
          (entry) =>
            entry.details.replayed === true &&
            entry.agent === '' &&
            entry.pid === null &&
            entry.instanceId === null &&
            entry.attribution === null,
        ),
      ).toBe(true);
      expect(restarted.getStats().spill.records).toBe(0);
      expect(audit.verifyChain(journal).valid).toBe(true);
      entries[0].details.nativeObservation.source.generation++;
      fs.writeFileSync(journal, entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n');
      expect(audit.verifyChain(journal)).toMatchObject({ valid: false, brokenAtSeq: 0 });
    } finally {
      const done = f.api.dispose();
      if (child.messages.at(-1)?.t === 'stop') child.ack();
      child.close(0);
      await done;
      pipeline.destroy();
      restarted?.destroy();
      audit.shutdown();
      removeOwnedFixture(root);
    }
  });
  it('accepts supported file/network projections while retaining the original raw observation at ingress', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-sensor-host-pipe-'));
    const relative = path.relative(os.tmpdir(), directory);
    if (relative.startsWith('..') || path.isAbsolute(relative))
      throw new Error('fixture-root-invalid');
    const delivered = [],
      admitted = [];
    const pipeline = pipelineModule.createSecurityBatcher({
      directory,
      intervalMs: 60000,
      consume: (rows) => {
        delivered.push(...rows);
        return true;
      },
    });
    // This fixture adapter proves the existing W1pipe audit projection only.
    // Production identity/attribution and fork/exit routing remain owner work.
    const sink = (observation) => {
      admitted.push(observation);
      const { event: row, identity: normalized } = observation;
      if (!['open', 'connect'].includes(row.kind)) return false;
      return pipeline.push({
        sensor: row.kind === 'open' ? 'file-handle' : 'network',
        type: row.kind === 'open' ? 'file-access' : 'network-connection',
        timestamp: Number(BigInt(row.ts) / 1000n),
        details: {
          pid: row.pid,
          agent: '',
          instanceId: `${row.pid}:${normalized.startTime}`,
          action: row.kind,
          path: row.path ?? '',
          severity: 'normal',
          attribution: { status: 'unattributed', evidence: [] },
          extra: row.kind === 'connect' ? { remoteIp: row.daddr, remotePort: row.dport } : {},
        },
      });
    };
    const f = fixture({ sink });
    const child = f.start();
    try {
      ready(child);
      child.send(batch(event()));
      child.send(
        batch({
          seq: '2',
          kind: 'connect',
          pid: 73,
          ppid: 1,
          ...identity,
          ts: '1700000000000002',
          family: 4,
          daddr: '203.0.113.1',
          dport: 443,
          saddr: '192.0.2.1',
          sport: 50000,
        }),
      );
      expect(admitted).toHaveLength(2);
      expect(admitted[0]).toMatchObject({
        event: { birth: '12345', witness: identity.witness },
        identity: { rawBirth: '12345', witness: identity.witness.bootId + ':12345' },
      });
      expect(pipeline.getStats().sensors['file-handle'].accepted).toBe(1);
      expect(pipeline.getStats().sensors.network.accepted).toBe(1);
      pipeline.flush();
      expect(delivered.map((row) => row.type)).toEqual(['file-access', 'network-connection']);
      expect(delivered[1].details.extra).toMatchObject({
        remoteIp: '203.0.113.1',
        remotePort: 443,
      });
      expect(f.api.getHealth().state).toBe('HEALTHY');
    } finally {
      const stopped = f.api.dispose();
      child.ack();
      child.close(0);
      await stopped;
      pipeline.destroy();
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
