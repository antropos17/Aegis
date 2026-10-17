import { expect, it } from 'vitest';
import { sensorsPassed } from '../../tools/development/desktop-contract.mjs';

const fixture = () => {
  const attribution = (status, code) => ({ status, evidence: [code] });
  const own = { pid: 42, instanceId: '42:1' };
  const files = [
    ...['created', 'modified', 'deleted', 'created'].map((action) => ({
      file: '/home/.env.sensor-events',
      action,
      pid: null,
      instanceId: null,
      attribution: attribution('unattributed', 'no-owner-match'),
    })),
    ...['.ssh', '.env.sensor-held'].map((file) => ({
      ...own,
      file: '/home/' + file,
      action: 'holding',
      createTime100ns: '123',
      attribution: attribution('confirmed', 'rm-holder-pid'),
    })),
  ];
  const rows = [40001, 40002].map((localPort) => ({
    ...own,
    localPort,
    remoteIp: '203.0.113.1',
    remotePort: 443,
    attribution: attribution('confirmed', 'os-tcp-owner-pid'),
  }));
  return {
    status: 'PASS',
    packaged: true,
    windowInputIsolated: true,
    filesVisible: true,
    networkVisible: true,
    networkClearedVisible: true,
    networkClosedWhileAlive: true,
    fixtureExited: true,
    closureConfirmed: true,
    contentExcluded: true,
    leaked: false,
    overflow: false,
    fixturePid: 42,
    instanceId: '42:1',
    witness: '123',
    native: { ports: [40001, 40002] },
    remoteIp: '203.0.113.1',
    settingsSavedAt: 1,
    networkLive: { at: 4000, rows },
    network: [
      { at: 4000, rows },
      { at: 31000, rows: [] },
    ],
    networkClosedAt: 5000,
    networkClosed: { at: 31000, rows: [] },
    files,
    audit: [
      ...files.map((row) => ({ ...row, type: 'file-access', path: row.file })),
      ...rows.map((row) => ({
        ...row,
        type: 'network-connection',
        details: { localPort: row.localPort },
      })),
    ],
    health: Object.fromEntries(
      ['fs-chokidar', 'fs-rm', 'network'].map((id) => [id, { state: 'HEALTHY' }]),
    ),
  };
};

it('requires both native sockets, file lifecycle, honest ownership and durable audit evidence', () => {
  expect(sensorsPassed(fixture())).toBe(true);
  expect(sensorsPassed({ status: 'PASS' })).toBe(false);
  for (const mutate of [
    (r) => {
      r.files[0].pid = 42;
    },
    (r) => {
      r.files[0].attribution.status = 'inferred';
    },
    (r) => {
      r.files[4].createTime100ns = 'old';
    },
    (r) => {
      r.networkLive.rows.pop();
    },
    (r) => {
      r.networkLive.rows[1].localPort = 40001;
    },
    (r) => {
      r.networkLive.rows[0].instanceId = '42:reused';
    },
    (r) => {
      r.networkLive.at = 30001;
    },
    (r) => {
      r.networkClosed.at = 4000;
    },
    (r) => {
      r.networkClosed.rows = r.networkLive.rows;
    },
    (r) => {
      r.audit.pop();
    },
    (r) => {
      r.audit.shift();
    },
    (r) => {
      r.network.push({ at: 2, rows: [{ remoteIp: '127.0.0.1' }] });
    },
    (r) => {
      r.health.network.state = 'DEGRADED';
    },
    (r) => {
      r.networkClearedVisible = false;
    },
    (r) => {
      r.networkClosedWhileAlive = false;
    },
    (r) => {
      r.contentExcluded = false;
    },
    (r) => {
      r.leaked = true;
    },
    (r) => {
      r.overflow = true;
    },
    (r) => {
      r.closureConfirmed = false;
    },
    (r) => {
      r.fixtureCleanupUnconfirmed = true;
    },
  ]) {
    const result = fixture();
    mutate(result);
    expect(sensorsPassed(result)).toBe(false);
  }
});
