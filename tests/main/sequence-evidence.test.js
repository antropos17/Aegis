import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import evidence from '../../src/main/sequence-evidence.js';
const require = createRequire(import.meta.url);
const engine = require('../../src/main/sequence-engine');
const loader = require('../../src/main/sequence-rule-loader');
const logger = require('../../src/main/logger');
let at, detections;
const owner = { status: 'confirmed', evidence: ['os-tcp-owner-pid'] };
const file = (patch = {}) => ({
  instanceId: '42:100',
  pid: 42,
  agent: 'Example agent',
  timestamp: 1,
  file: '/project/credentials.json',
  action: 'accessed',
  attribution: { status: 'confirmed', evidence: ['handle-scan-pid'] },
  ...patch,
});
const tcp = (patch = {}) => ({
  instanceId: '42:100',
  pid: 42,
  agent: 'Example agent',
  localIp: '192.0.2.1',
  localPort: 50001,
  remoteIp: '203.0.113.9',
  remotePort: 443,
  state: 'Established',
  attribution: owner,
  ...patch,
});
function ingest(value) {
  at += 1000;
  engine.ingest(value);
}
beforeEach(() => {
  vi.spyOn(logger, 'warn').mockImplementation(() => {});
  at = 10000;
  detections = [];
  engine.init({
    rules: loader.loadDir().rules,
    now: () => at,
    onDetection: (d) => detections.push(d),
  });
});
afterEach(() => vi.restoreAllMocks());

it('retains an existing TCP observation as informational context without an anomaly score', () => {
  ingest(tcp());
  ingest(file());
  ingest(tcp({ state: 'CloseWait' }));
  expect(detections).toHaveLength(1);
  expect(detections[0].level).toBe('informational');
  expect(detections[0].assessment.reasons).toContain('connection-observed-before-file');
  expect(detections[0].assessment.dataTransfer).toBe('unobserved');
  expect(engine.scoreFor('42:100')).toBe(0);
});

it('retains ordered endpoints and ownership without claiming a transfer', () => {
  ingest(file());
  ingest(tcp({ domain: 'api.example.com', verdict: 'allowlisted' }));
  expect(detections).toHaveLength(1);
  expect(detections[0]).toMatchObject({
    level: 'medium',
    attribution: { status: 'confirmed' },
    assessment: { confidence: 'temporal-correlation', dataTransfer: 'unobserved' },
    steps: [
      { action: 'file-accessed', instanceId: '42:100', pid: 42, at: 11000 },
      {
        action: 'network-connection',
        instanceId: '42:100',
        pid: 42,
        at: 12000,
        network: {
          localPort: 50001,
          remoteIp: '203.0.113.9',
          remotePort: 443,
          firstObservedAt: 12000,
          verdict: 'allowlisted',
        },
      },
    ],
  });
  expect(engine.scoreFor('42:100')).toBe(55);
});

it.each([
  [{ action: 'holding' }, {}, 'file-read-unobserved'],
  [{ attribution: null }, {}, 'ownership-incomplete'],
  [{ attribution: { status: 'confirmed', evidence: [] } }, {}, 'ownership-incomplete'],
  [
    { attribution: { status: 'inferred', evidence: ['cwd-containment'] } },
    {},
    'ownership-inferred',
  ],
  [{}, { attribution: null }, 'ownership-incomplete'],
  [{}, { localPort: null }, 'tcp-history-unavailable'],
])('caps incomplete observation evidence at low: %j / %j', (filePatch, netPatch, reason) => {
  ingest(file(filePatch));
  ingest(tcp(netPatch));
  expect(detections[0].level).toBe('low');
  expect(detections[0].assessment.reasons).toContain(reason);
  if (reason === 'ownership-incomplete')
    expect(detections[0].attribution.status).toBe('unattributed');
});

it.each([
  '/x/.env',
  '/x/.env.production',
  'C:\\Users\\me\\.ssh\\id_ed25519',
  '/x/id_rsa',
  '/x/1password_backup.csv',
  '/x/credentials',
  '/x/PASSWORDS.TXT',
])('covers sensitive basename %s on nonstandard TCP ports', (path) => {
  ingest(file({ file: path }));
  ingest(tcp({ remotePort: 8443 }));
  expect(detections).toHaveLength(1);
  expect(detections[0].level).toBe('medium');
});

it.each(['/x/README.md', '/x/id_rsa.pub', '/x/id_ed25519.pub', '/passwords/notes.md'])(
  'does not call an ordinary or public-key path a credential: %s',
  (path) => {
    ingest(file({ file: path }));
    ingest(tcp());
    expect(detections).toEqual([]);
  },
);

it.each(['42:200', '43:100'])(
  'does not combine recycled PIDs or related agents: %s',
  (instanceId) => {
    ingest(file());
    ingest(tcp({ instanceId, parentEditor: 'Example agent' }));
    expect(detections).toEqual([]);
    ingest(tcp());
    expect(detections).toHaveLength(1);
  },
);

it('keeps distinct local sockets even to the same API', () => {
  ingest(tcp());
  ingest(file());
  ingest(tcp({ localPort: 50002 }));
  expect(detections[0].level).toBe('medium');
  expect(engine.getStats().tcpHistory.retained).toBe(2);
});

it('an old or incomplete socket cannot consume the pending file evidence before a new socket', () => {
  ingest(tcp());
  ingest(file());
  ingest(tcp());
  ingest(tcp());
  expect(detections.map((d) => d.level)).toEqual(['informational']);
  ingest(tcp({ localPort: null }));
  expect(detections.map((d) => d.level)).toEqual(['informational', 'low']);
  ingest(tcp({ localPort: 50002 }));
  expect(detections.map((d) => d.level)).toEqual(['informational', 'low', 'medium']);
  expect(detections[2].steps[0].at).toBe(12000);
  expect(engine.scoreFor('42:100')).toBe(55);
});

it('weak TCP repeats cannot extend the file correlation window', () => {
  ingest(tcp());
  ingest(file());
  const fileAt = at;
  ingest(tcp());
  at = fileAt + 300001;
  ingest(tcp({ localPort: 50002 }));
  expect(detections.map((d) => d.level)).toEqual(['informational']);
  expect(engine.scoreFor('42:100')).toBe(0);
});

it('weaker repeats neither erase nor prolong an existing stronger score', () => {
  ingest(file());
  ingest(tcp());
  const strongAt = at;
  at += 590000;
  ingest(file());
  ingest(tcp());
  expect(detections[1].level).toBe('informational');
  expect(engine.scoreFor('42:100')).toBe(55);
  at = strongAt + 600001;
  expect(engine.scoreFor('42:100')).toBe(0);
});

it('never raises a configured low ceiling and keeps custom rules opt-in', () => {
  const rule = loader.loadDir().rules[0];
  engine.init({
    rules: [{ ...rule, level: 'low' }],
    now: () => at,
    onDetection: (d) => detections.push(d),
  });
  ingest(file());
  ingest(tcp());
  expect(detections[0].level).toBe('low');
  engine.init({
    rules: [{ ...rule, evidencePolicy: undefined, level: 'high' }],
    now: () => at,
    onDetection: (d) => detections.push(d),
  });
  ingest(tcp());
  ingest(file());
  ingest(tcp());
  expect(detections[1].level).toBe('high');
  expect(detections[1]).not.toHaveProperty('assessment');
  expect(detections[1].steps[1]).not.toHaveProperty('network');
});

it('does not retain arbitrary carrier contents or command/URL strings', () => {
  const secret = 'DO-NOT-RETAIN';
  ingest(file({ contents: secret, command: secret }));
  ingest(tcp({ payload: secret, userAgent: secret, domain: 'https://host/?token=' + secret }));
  expect(JSON.stringify(detections)).not.toContain(secret);
});

it('expires and bounds tuple memory, isolates identities, and reports lost history', () => {
  const history = evidence.createHistory({ maxEntries: 2, retentionMs: 100 });
  expect(history.observe(tcp(), 10).firstObservedAt).toBe(10);
  expect(history.observe(tcp({ state: 'CloseWait' }), 20).firstObservedAt).toBe(10);
  history.observe(tcp({ instanceId: '42:200' }), 30);
  history.observe(tcp({ localPort: 50002 }), 40);
  expect(history.stats()).toMatchObject({ retained: 2, evicted: 1 });
  expect(history.observe(tcp(), 50).firstObservedAt).toBe(50);
  history.close('42:100');
  expect(history.stats().retained).toBe(0);
  history.observe(tcp(), 60);
  history.sweep(161);
  expect(history.stats()).toMatchObject({ retained: 0, expired: 1 });
  expect(history.observe(tcp({ localIp: null }), 170).history).toBe('unavailable');
  history.observe(tcp(), 180);
  expect(history.observe(tcp(), 20).firstObservedAt).toBe(20);
  expect(history.stats().clockResets).toBe(1);
});

it('forgets TCP observations at process exit and starts fresh at engine init', () => {
  ingest(tcp());
  ingest({ type: 'agent-exit', instanceId: '42:100', pid: 42, agent: 'Example agent' });
  expect(engine.getStats().tcpHistory.retained).toBe(0);
  engine.init({ rules: loader.loadDir().rules, now: () => at });
  expect(engine.getStats().tcpHistory.retained).toBe(0);
});

it.each(['unknown-policy', 'null', '[credential-egress-v1]'])('rejects policy %s', (policy) => {
  const source = fs.readFileSync(loader.DEFAULT_SEQUENCES_DIR + '/sequences.yaml', 'utf8');
  const result = loader.loadFromString(
    source.replace('evidence-policy: credential-egress-v1', 'evidence-policy: ' + policy),
  );
  expect(result.rules).toEqual([]);
  expect(result.loadErrors).toBeGreaterThan(0);
});

it('rejects evidence calibration on a network-first sequence', () => {
  const source = fs.readFileSync(loader.DEFAULT_SEQUENCES_DIR + '/sequences.yaml', 'utf8');
  const result = loader.loadFromString(
    source.replace(/- cred_file_read\s+- outbound_conn/, '- outbound_conn\n    - cred_file_read'),
  );
  expect(result.rules).toEqual([]);
  expect(result.loadErrors).toBeGreaterThan(0);
});
