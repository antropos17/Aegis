import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import baselines from '../../src/main/baselines.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { enrichAgents } from '../../src/renderer/lib/utils/enrich-agents';

const require = createRequire(import.meta.url);
const { normalizeToEcs } = require('../../src/shared/ecs-normalizer');
const { projectRecord, replayRecord } = require('../../src/main/security-event-record');
const { projectBoundReadObject } = require('../../src/shared/bound-read-object');
const { createSensitiveAlertJournal } = require('../../src/main/sensitive-alert-journal');
const sequenceLoader = require('../../src/main/sequence-rule-loader');
const sequenceEngine = require('../../src/main/sequence-engine');
const timestamp = 1720000000123;

function event() {
  return {
    observationKind: 'bound-object-read',
    eventId: 'c465454e-b74b-4ec2-b2bb-4df53a4ca6d8',
    agent: 'Claude Code',
    pid: 320,
    instanceId: '320:1720000000000',
    parentEditor: null,
    cwd: null,
    category: 'ai',
    timestamp,
    sensitive: true,
    selfAccess: false,
    reason: 'SSH private key',
    action: 'accessed',
    attribution: { status: 'confirmed', evidence: ['etw-file-object'] },
    object: {
      objectKey: 'object-1',
      bindingId: 'binding-1',
      scopeGeneration: 'scope-1',
      policyGeneration: 'policy-1',
      label: 'C:\\owned\\.ssh\\id_ed25519',
      provenance: 'issuer-handle-file-id',
      policy: { sensitive: true, reason: 'SSH private key', classification: 'ssh-aws' },
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  baselines.init();
  sequenceEngine.init({ rules: [] });
  for (const key of Object.keys(baselines.getSessionData())) delete baselines.getSessionData()[key];
  for (const key of Object.keys(baselines.getBaselines().agents))
    delete baselines.getBaselines().agents[key];
});

describe('bound-object operational consumers', () => {
  it('accepts a Windows binding label and rejects actual control characters', () => {
    expect(projectBoundReadObject(event().object)?.label).toBe('C:\\owned\\.ssh\\id_ed25519');
    for (const character of ['\u0000', '\n', '\r', '\u007f']) {
      expect(
        projectBoundReadObject({ ...event().object, label: `C:\\owned\\${character}secret` }),
      ).toBeNull();
      expect(
        projectBoundReadObject({
          ...event().object,
          policy: {
            ...event().object.policy,
            reason: `SSH${character}private key`,
          },
        }),
      ).toBeNull();
    }
  });
  it('raises actual displayed risk only for the exact instance using frozen object policy', () => {
    vi.useFakeTimers();
    vi.setSystemTime(timestamp);
    const observation = event();
    const actors = [
      { agent: 'Claude Code', pid: 320, instanceId: observation.instanceId, category: 'ai' },
      { agent: 'Claude Code', pid: 321, instanceId: '321:1720000000000', category: 'ai' },
    ];
    const before = enrichAgents(actors, [], {}, [], []);
    // Matching the label with a path exception cannot grant an object exemption.
    const exceptions = [{ agentName: 'Claude Code', pattern: '.*' }];
    const after = enrichAgents(actors, [observation], {}, [], exceptions);
    expect(after[0].riskScore).toBeGreaterThan(before[0].riskScore);
    expect(after[0].sensitiveFiles).toBe(1);
    expect(after[0].anomalyScore).toBe(0);
    expect(after[1].riskScore).toBe(before[1].riskScore);
    // A renamed label does not duplicate exposure to the same bound object.
    const renamed = { ...observation, object: { ...observation.object, label: 'C:\\renamed' } };
    expect(enrichAgents(actors, [observation, renamed], {}, [], [])[0].riskScore).toBe(
      enrichAgents(actors, [observation], {}, [], [])[0].riskScore,
    );
  });

  it('records object features without path, directory or legacy sensitive-path training', () => {
    const observation = event();
    baselines.init({ isInstanceActive: (key) => key === observation.instanceId });
    expect(baselines.recordBoundObjectRead(observation)).toBe(true);
    const bucket = baselines.getSessionData()[observation.instanceId];
    expect(bucket.objects.size).toBe(1);
    expect(bucket.objectSensitiveCount).toBe(1);
    expect(bucket.files.size).toBe(0);
    expect(bucket.directories.size).toBe(0);
    expect(bucket.sensitiveCount).toBe(0);
    expect(baselines.recordBoundObjectRead({ ...observation, instanceId: null })).toBe(false);
    expect(
      baselines.recordBoundObjectRead({ ...observation, instanceId: '321:1720000000000' }),
    ).toBe(false);
  });

  it('finalizes object-only sessions in their own cohort without training or lowering path baselines', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-object-cohort-'));
    baselines._setBaselinesPathForTest(path.join(directory, 'baselines.json'));
    baselines.init();
    try {
      for (let i = 0; i < 3; i++) {
        const instanceId = `path-${i}`;
        baselines.recordFileAccess(
          instanceId,
          'Claude Code',
          'C:\\actual\\path.env',
          true,
          'Secret',
        );
        baselines.finalizeInstances([{ instanceId }]);
      }
      const original = JSON.parse(JSON.stringify(baselines.getBaselines().agents['Claude Code']));
      for (let i = 0; i < 3; i++) {
        const observation = { ...event(), instanceId: `object-${i}` };
        baselines.recordBoundObjectRead(observation);
        baselines.finalizeInstances([{ instanceId: observation.instanceId }]);
      }
      const profile = baselines.getBaselines().agents['Claude Code'];
      expect(profile.sessionCount).toBe(3);
      expect(profile.sessions).toEqual(original.sessions);
      expect(profile.averages).toEqual(original.averages);
      expect(profile.objectSessionCount).toBe(3);
      expect(profile.objectAverages).toEqual({
        bindingsPerSession: 1,
        sensitiveBindingsPerSession: 1,
      });
      const only = { ...event(), instanceId: 'object-only', agent: 'Object Only' };
      baselines.recordBoundObjectRead(only);
      baselines.finalizeInstances([{ instanceId: only.instanceId }]);
      expect(baselines.getBaselines().agents['Object Only']).toMatchObject({
        sessionCount: 0,
        sessions: [],
        objectSessionCount: 1,
      });
    } finally {
      baselines._setBaselinesPathForTest(null);
      expect(path.dirname(path.resolve(directory))).toBe(path.resolve(os.tmpdir()));
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('normalizes object-compatible sequence fields without manufacturing file.path', () => {
    const ecs = normalizeToEcs(event());
    expect(ecs.event.action).toBe('bound-object-read');
    expect(ecs).not.toHaveProperty('file');
    expect(ecs.aegis.bound_object).toEqual({
      key: 'object-1',
      sensitive: true,
      classification: 'ssh-aws',
    });
    expect(JSON.stringify(ecs)).not.toContain('id_ed25519');
  });

  it('creates and restores one explicit object-label alert summary', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-object-alert-'));
    try {
      const observation = { ...event(), timestamp: Date.now() };
      const journal = createSensitiveAlertJournal(directory);
      journal.record(observation);
      journal.record(observation);
      expect(journal.list().items).toMatchObject([
        {
          eventId: observation.eventId,
          basename: 'id_ed25519',
          observationKind: 'bound-object-read',
          labelSemantics: 'binding-label-access-path-unknown',
        },
      ]);
      expect(await journal.flush()).toBe(true);
      expect(createSensitiveAlertJournal(directory).list().items).toHaveLength(1);
      expect(JSON.stringify(journal.list())).not.toContain('C:\\owned');
    } finally {
      expect(path.dirname(path.resolve(directory))).toBe(path.resolve(os.tmpdir()));
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('loads the production object rule while existing path rules cannot match the binding label', () => {
    const loaded = sequenceLoader.loadDir();
    expect(loaded.loadErrors).toBe(0);
    expect(loaded.rules.some((rule) => rule.id === 'SEQ004')).toBe(true);
    const onDetection = vi.fn();
    let now = timestamp + 500;
    sequenceEngine.init({ rules: loaded.rules, onDetection, now: () => now });
    sequenceEngine.ingest(event());
    expect(sequenceEngine.getStats().rules.SEQ001.openNow).toBe(0);
    expect(sequenceEngine.getStats().rules.SEQ004.openNow).toBe(1);
    now += 1000;
    sequenceEngine.ingest({
      agent: 'Claude Code',
      pid: 320,
      instanceId: event().instanceId,
      remoteIp: '203.0.113.5',
      remotePort: 443,
      localIp: '192.0.2.1',
      localPort: 32000,
      domain: '',
      category: 'ai',
      attribution: { status: 'confirmed', evidence: ['os-tcp-owner-pid'] },
    });
    expect(onDetection).toHaveBeenCalledTimes(1);
    expect(onDetection.mock.calls[0][0].ruleId).toBe('SEQ004');
    expect(onDetection.mock.calls[0][0].steps[0].at).toBe(timestamp);
    expect(onDetection.mock.calls[0][0].steps[0]).not.toHaveProperty('path');
    expect(onDetection.mock.calls[0][0].assessment.limitations).toContain('access-path-unobserved');
    expect(JSON.stringify(onDetection.mock.calls)).not.toContain('id_ed25519');
  });

  it('does not retroactively replay a TCP snapshot delivered before delayed native admission', () => {
    const loaded = sequenceLoader.loadDir();
    const onDetection = vi.fn();
    let now = timestamp + 1000;
    sequenceEngine.init({ rules: loaded.rules, onDetection, now: () => now });
    sequenceEngine.ingest({
      agent: 'Claude Code',
      pid: 320,
      instanceId: event().instanceId,
      remoteIp: '203.0.113.5',
      remotePort: 443,
      localIp: '192.0.2.1',
      localPort: 32000,
      domain: '',
      category: 'ai',
      attribution: { status: 'confirmed', evidence: ['os-tcp-owner-pid'] },
    });
    now += 1000;
    sequenceEngine.ingest(event());
    expect(onDetection).not.toHaveBeenCalled();
    expect(sequenceEngine.getStats().rules.SEQ004.openNow).toBe(1);
  });

  it('keeps closed object custody through audit projection and historical replay', () => {
    const observation = event();
    observation.object.volumeSerial = 'RAW-VOLUME';
    observation.object.fileId128 = 'RAW-ID';
    observation.object.prompt = 'PRIVATE-PROMPT';
    const record = projectRecord({
      type: 'file-access',
      sensor: 'other',
      timestamp,
      details: {
        agent: observation.agent,
        instanceId: observation.instanceId,
        pid: observation.pid,
        action: 'accessed',
        path: '',
        severity: 'sensitive',
        eventId: observation.eventId,
        attribution: observation.attribution,
        boundObject: observation.object,
      },
    });
    expect(record.details.extra.boundObject).toEqual(projectBoundReadObject(observation.object));
    expect(record.details.extra.eventId).toBe(observation.eventId);
    expect(record.details.path).toBe('');
    const replay = replayRecord(JSON.parse(JSON.stringify(record)));
    expect(replay.replayed).toBe(true);
    expect(replay.details.extra.boundObject).toEqual(record.details.extra.boundObject);
    expect(replay.details.extra.eventId).toBe(observation.eventId);
    expect(JSON.stringify(replay)).not.toMatch(/RAW-VOLUME|RAW-ID|PRIVATE-PROMPT/);
    expect(
      normalizeToEcs({
        ...record.details,
        type: record.type,
        timestamp: new Date(timestamp).toISOString(),
      }),
    ).not.toHaveProperty('file');
  });
});
