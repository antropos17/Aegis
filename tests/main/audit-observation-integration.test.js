import { afterEach, beforeEach, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import Module from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createSecurityBatcher } = require('../../src/main/ipc-batcher');
const { createLiveToolContext } = require('../../src/main/live-tool-context');
let root, audit, pipeline, scanLoop, custody;

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-audit-integration-'));
  delete require.cache[require.resolve('../../src/main/audit-logger')];
  delete require.cache[require.resolve('../../src/main/scan-loop')];
  const originalLoad = Module._load;
  try {
    Module._load = function (name) {
      if (name === 'electron')
        return {
          app: { getPath: () => root },
          safeStorage: { isEncryptionAvailable: () => false },
        };
      return originalLoad.apply(this, arguments);
    };
    audit = require('../../src/main/audit-logger');
    scanLoop = require('../../src/main/scan-loop');
  } finally {
    Module._load = originalLoad;
  }
  audit.init({ userDataPath: root });
  await audit._awaitIndexForTest();
  pipeline = createSecurityBatcher({
    directory: path.join(root, 'spill'),
    capacity: 4,
    intervalMs: 60000,
    consume: audit.persistBatch,
  });
  custody = createLiveToolContext({ getAgents: () => [] });
  scanLoop.init({
    audit,
    securityEvents: pipeline,
    prepareFileObservation: custody.prepare,
  });
});

afterEach(() => {
  pipeline?.destroy();
  scanLoop?.stopScanIntervals();
  audit?.shutdown();
  expect(path.dirname(root)).toBe(path.resolve(os.tmpdir()));
  expect(fs.lstatSync(root).isSymbolicLink()).toBe(false);
  fs.rmSync(root, { recursive: true, force: true });
});

const event = (id) => ({
  eventId: id,
  timestamp: Date.now(),
  pid: 123,
  instanceId: '123:100',
  agent: 'Claude Code',
  file: path.join(root, 'fixture.txt'),
  action: 'read',
  sensitive: true,
  attribution: { status: 'unattributed', evidence: [] },
  unrelatedPrivateData: 'DO_NOT_COPY_TO_AUDIT',
});

function rows() {
  pipeline.flush();
  const name = fs.readdirSync(audit.getLogDir()).find((item) => item.endsWith('.json'));
  const target = path.join(audit.getLogDir(), name);
  expect(audit.verifyChain(target).valid).toBe(true);
  return fs.readFileSync(target, 'utf8').trim().split('\n').map(JSON.parse);
}

it('binds the exact sensitive ingress to its durable row while a distinct deduped observation remains unavailable', () => {
  const first = event('11111111-1111-4111-8111-111111111111');
  const accepted = scanLoop.dedupFileEvent(first);
  expect(accepted).toBe(first);
  custody.record(accepted);
  scanLoop.logAuditForFile(accepted);
  const second = event('22222222-2222-4222-8222-222222222222');
  expect(scanLoop.dedupFileEvent(second)).toBeNull();
  const saved = rows();
  expect(saved).toHaveLength(2);
  expect(saved[0].details.auditIdentity.eventId).toBe(first.eventId);
  expect(saved[1].details.auditIdentity.eventId).toBe(second.eventId);
  expect(saved[0].details.deliveryId).not.toBe(first.eventId);
  expect(saved[0].details.deliveryId).not.toBe(saved[1].details.deliveryId);
  expect(custody.auditLookup(saved[0])).toBe(saved[0].details.auditIdentity.token);
  expect(custody.auditLookup(saved[1])).toBeNull();
  expect(createLiveToolContext({ getAgents: () => [] }).auditLookup(saved[0])).toBeNull();
  expect(JSON.stringify(saved)).not.toContain('DO_NOT_COPY_TO_AUDIT');
});

it('revokes both rows when a second sensitive observation reuses an ID before dedup', () => {
  const first = event('AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA');
  const accepted = scanLoop.dedupFileEvent(first);
  custody.record(accepted);
  const duplicate = event('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  expect(scanLoop.dedupFileEvent(duplicate)).toBeNull();
  const saved = rows();
  expect(saved).toHaveLength(2);
  expect(saved[0].details.auditIdentity.eventId).toBe(saved[1].details.auditIdentity.eventId);
  expect(saved[0].details.auditIdentity.token).not.toBe(saved[1].details.auditIdentity.token);
  expect(custody.auditLookup(saved[0])).toBeNull();
  expect(custody.auditLookup(saved[1])).toBeNull();
});
