import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pipelineModule from '../../src/main/security-event-pipeline.js';
import { fixture, ready, event, identity, batch } from './sensor-host-fixtures.js';

describe('sensor host injected W1pipe admission boundary', () => {
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
