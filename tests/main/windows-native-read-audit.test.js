import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectProfile } from '../../frontend/observatory/tests/sensor-support.mjs';
import { matchingNativeAuditRows } from '../../scripts/qualification/windows-native-read-audit.mjs';

const require = createRequire(import.meta.url);
const { projectRecord } = require('../../src/main/security-event-record.js');
const audit = require('../../src/main/audit-logger.js');
const roots = [];

afterEach(() => {
  audit.shutdown();
  for (const root of roots.splice(0)) {
    const directory = path.resolve(root);
    if (
      path.dirname(directory) !== path.resolve(os.tmpdir()) ||
      !path.basename(directory).startsWith('native-read-audit-') ||
      fs.lstatSync(directory).isSymbolicLink()
    )
      throw new Error('fixture-cleanup-boundary');
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('native-read canonical audit custody guard', () => {
  it('recognizes the real persisted envelope and rejects wrong actor, binding and lookalike rows', () => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'native-read-audit-'));
    roots.push(profile);
    const event = {
      observationKind: 'bound-object-read',
      eventId: '5adf0c5c-9e20-47a9-ba59-1a27cb89eb75',
      agent: 'Aider',
      pid: 6108,
      instanceId: '6108:1792859500660',
      createTime100ns: '134373331006608590',
      object: {
        objectKey: 'opaque-object-1',
        bindingId: 'binding-1',
        scopeGeneration: 'scope-1',
        policyGeneration: 'policy-1',
        provenance: 'issuer-handle-file-id',
        label: path.join(profile, 'fixture', '.env'),
        policy: {
          sensitive: true,
          reason: 'Environment variables',
          classification: 'sensitive',
        },
      },
    };
    const record = projectRecord({
      type: 'file-access',
      sensor: 'other',
      timestamp: Date.now(),
      details: {
        eventId: event.eventId,
        agent: event.agent,
        pid: event.pid,
        instanceId: event.instanceId,
        createTime100ns: event.createTime100ns,
        path: '',
        action: 'accessed',
        severity: 'sensitive',
        attribution: { status: 'confirmed', evidence: ['etw-file-object'] },
        boundObject: event.object,
      },
    });
    audit.init({ userDataPath: profile });
    expect(audit.persistBatch([record])).toBe(true);
    audit.shutdown();

    const rows = inspectProfile(
      profile,
      path.join(profile, 'fixture'),
      event.pid,
      'CONTENT_CANARY',
    );
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row.details.eventId).toBe(event.eventId);
    expect(row.extra).toBeUndefined();
    expect(row.eventId).toBeUndefined();
    const journal = fs
      .readdirSync(path.join(profile, 'audit-logs'))
      .find((name) => name.endsWith('.json'));
    expect(audit.verifyChain(path.join(profile, 'audit-logs', journal)).valid).toBe(true);
    expect(matchingNativeAuditRows(rows, event)).toEqual([row]);

    const mutations = [
      (value) => (value.type = 'config-access'),
      (value) => (value.pid += 1),
      (value) => (value.instanceId += '-other'),
      (value) => (value.path = event.object.label),
      (value) => (value.details.createTime100ns += '1'),
      (value) => (value.details.eventId = '00000000-0000-4000-8000-000000000000'),
      (value) => (value.details.boundObject.bindingId += '-other'),
      (value) => (value.details.boundObject.objectKey += '-other'),
      (value) => (value.details.boundObject.scopeGeneration += '-other'),
      (value) => (value.details.boundObject.policyGeneration += '-other'),
      (value) => {
        value.eventId = value.details.eventId;
        delete value.details.eventId;
      },
      (value) => {
        value.extra = { eventId: value.details.eventId };
        delete value.details.eventId;
      },
    ];
    for (const mutate of mutations) {
      const lookalike = structuredClone(row);
      mutate(lookalike);
      expect(matchingNativeAuditRows([lookalike], event)).toEqual([]);
    }
    expect(matchingNativeAuditRows(rows, { ...event, eventId: undefined })).toEqual([]);
    expect(matchingNativeAuditRows(rows, { ...event, observationKind: 'legacy-file' })).toEqual([]);
  });
});
