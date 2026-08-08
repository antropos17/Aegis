import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import baselines from '../../src/main/baselines.js';

// Two space-1 instance keys (`${pid}:${startTime}`) of ONE agent name — the C2 case.
const CLAUDE_A = '1000:1700000000000';
const CLAUDE_B = '2000:1700000009999';

describe('baselines', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-baselines-test-'));
    baselines._setBaselinesPathForTest(path.join(tmpDir, 'baselines.json'));

    // Clear session data from prior tests
    const sd = baselines.getSessionData();
    for (const key of Object.keys(sd)) delete sd[key];
    // …and the persisted profiles, which are module state that survives between tests
    // (nothing here reloads them) — a test asserting a sessionCount must start from zero.
    const bl = baselines.getBaselines();
    for (const key of Object.keys(bl.agents)) delete bl.agents[key];
  });

  afterEach(() => {
    baselines._setBaselinesPathForTest(null);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('ensureSessionData() creates correct initial structure', () => {
    const sd = baselines.ensureSessionData(CLAUDE_A, 'Claude');
    expect(sd.agentName).toBe('Claude');
    expect(sd.files).toBeInstanceOf(Set);
    expect(sd.sensitiveCount).toBe(0);
    expect(sd.directories).toBeInstanceOf(Set);
    expect(sd.endpoints).toBeInstanceOf(Set);
    expect(sd.sensitiveReasons).toBeInstanceOf(Set);
    expect(sd.activeHours).toBeInstanceOf(Set);
    expect(typeof sd.startTime).toBe('number');
  });

  it('ensureSessionData() returns same object on repeat call', () => {
    const sd1 = baselines.ensureSessionData(CLAUDE_A, 'Claude');
    const sd2 = baselines.ensureSessionData(CLAUDE_A, 'Claude');
    expect(sd1).toBe(sd2);
  });

  it('the bucket is keyed on instanceId — same name, two instances, two buckets', () => {
    baselines.recordFileAccess(CLAUDE_A, 'Claude', '/a/one.js', false);
    baselines.recordFileAccess(CLAUDE_B, 'Claude', '/b/two.js', false);
    baselines.recordFileAccess(CLAUDE_B, 'Claude', '/b/three.js', false);

    const sd = baselines.getSessionData();
    expect(Object.keys(sd).sort()).toEqual([CLAUDE_A, CLAUDE_B].sort());
    expect(sd[CLAUDE_A].files.size).toBe(1);
    expect(sd[CLAUDE_B].files.size).toBe(2);
    // The name is not a key anywhere in the live store.
    expect(sd['Claude']).toBeUndefined();
  });

  it('an agent with no instanceId is not recorded at all (null-key policy)', () => {
    baselines.ensureSessionData(null, 'Ollama');
    baselines.recordFileAccess(null, 'Ollama', '/home/user/.ssh/id_rsa', true, 'SSH key');
    baselines.recordFileAccess(undefined, 'Ollama', '/home/user/.aws/credentials', true, 'AWS');
    baselines.recordNetworkEndpoint('', '', '1.2.3.4', 443);

    // No bucket created, under ANY key — not the name, not the empty string.
    expect(baselines.getSessionData()).toEqual({});
  });

  it('recordFileAccess() tracks files, dirs, sensitive count, reasons, hours', () => {
    baselines.recordFileAccess(CLAUDE_A, 'Claude', '/home/user/project/file.js', false);
    baselines.recordFileAccess(CLAUDE_A, 'Claude', '/home/user/.ssh/id_rsa', true, 'SSH key');

    const sd = baselines.ensureSessionData(CLAUDE_A, 'Claude');
    expect(sd.files.size).toBe(2);
    expect(sd.directories.has('/home/user/project')).toBe(true);
    expect(sd.directories.has('/home/user/.ssh')).toBe(true);
    expect(sd.sensitiveCount).toBe(1);
    expect(sd.sensitiveReasons.has('SSH key')).toBe(true);
    expect(sd.activeHours.size).toBeGreaterThan(0);
  });

  it('recordNetworkEndpoint() tracks endpoints', () => {
    baselines.recordNetworkEndpoint(CLAUDE_A, 'Claude', '1.2.3.4', 443);
    baselines.recordNetworkEndpoint(CLAUDE_A, 'Claude', '5.6.7.8', 80);
    const sd = baselines.ensureSessionData(CLAUDE_A, 'Claude');
    expect(sd.endpoints.has('1.2.3.4:443')).toBe(true);
    expect(sd.endpoints.has('5.6.7.8:80')).toBe(true);
  });

  it('recomputeAverages() correct rolling averages', () => {
    const ab = {
      sessions: [
        {
          totalFiles: 10,
          sensitiveFiles: 2,
          directories: ['/a', '/b'],
          networkEndpoints: ['1.2.3.4:443'],
          sensitiveReasons: ['SSH'],
          activeHours: [9, 10],
        },
        {
          totalFiles: 20,
          sensitiveFiles: 4,
          directories: ['/a', '/c'],
          networkEndpoints: ['5.6.7.8:80'],
          sensitiveReasons: ['AWS'],
          activeHours: [14],
        },
      ],
      averages: {},
    };
    baselines.recomputeAverages(ab);
    expect(ab.averages.filesPerSession).toBe(15);
    expect(ab.averages.sensitivePerSession).toBe(3);
    expect(ab.averages.typicalDirectories).toContain('/a');
    expect(ab.averages.typicalDirectories).not.toContain('/b');
    expect(ab.averages.knownEndpoints).toContain('1.2.3.4:443');
    expect(ab.averages.knownEndpoints).toContain('5.6.7.8:80');
    expect(ab.averages.knownSensitiveReasons).toContain('SSH');
    expect(ab.averages.knownSensitiveReasons).toContain('AWS');
    expect(ab.averages.hourHistogram).toHaveLength(24);
  });

  it('finalizeSession() creates baseline, pushes session, caps at 10', () => {
    for (let i = 0; i < 12; i++) {
      const sd = baselines.getSessionData();
      delete sd[CLAUDE_A];
      baselines.recordFileAccess(CLAUDE_A, 'Claude', `/file${i}.js`, false);
      baselines.finalizeSession();
    }

    const bl = baselines.getBaselines();
    expect(bl.agents['Claude']).toBeDefined();
    expect(bl.agents['Claude'].sessions.length).toBeLessThanOrEqual(10);
    expect(bl.agents['Claude'].sessionCount).toBe(12);
  });

  it('finalizeSession() skips agents with zero activity', () => {
    baselines.ensureSessionData(CLAUDE_A, 'Idle');
    baselines.finalizeSession();
    const bl = baselines.getBaselines();
    expect(bl.agents['Idle']).toBeUndefined();
  });

  it('finalizeSession() files instance buckets under the agent NAME, one record each', () => {
    baselines.recordFileAccess(CLAUDE_A, 'Claude', '/a/one.js', false);
    baselines.recordFileAccess(CLAUDE_B, 'Claude', '/b/one.js', false);
    baselines.recordFileAccess(CLAUDE_B, 'Claude', '/b/two.js', false);
    baselines.finalizeSession();

    const ab = baselines.getBaselines().agents['Claude'];
    // The profile stays name-keyed; the instance keys never reach the persisted map.
    expect(Object.keys(baselines.getBaselines().agents)).toEqual(['Claude']);
    // One record per instance — the unit the live bucket is compared against.
    expect(ab.sessionCount).toBe(2);
    expect(ab.sessions.map((s) => s.totalFiles).sort()).toEqual([1, 2]);
  });

  it('a baseline file written before the instance migration still loads and matches by name', () => {
    const file = path.join(tmpDir, 'baselines.json');
    // Pre-migration on-disk shape: agents keyed by display name, no instance key anywhere.
    fs.writeFileSync(
      file,
      JSON.stringify({
        agents: {
          Claude: {
            sessionCount: 4,
            sessions: [
              {
                startTime: 1,
                endTime: 2,
                totalFiles: 10,
                sensitiveFiles: 2,
                directories: ['/old'],
                networkEndpoints: ['9.9.9.9:443'],
                sensitiveReasons: ['SSH key'],
                activeHours: [9],
              },
            ],
            averages: {
              filesPerSession: 10,
              sensitivePerSession: 2,
              typicalDirectories: ['/old'],
              knownEndpoints: ['9.9.9.9:443'],
              knownSensitiveReasons: ['SSH key'],
              hourHistogram: new Array(24).fill(0),
            },
          },
        },
      }),
    );
    baselines._setBaselinesPathForTest(file);
    baselines.loadBaselines();

    const loaded = baselines.getBaselines().agents['Claude'];
    expect(loaded.sessionCount).toBe(4);
    expect(loaded.averages.filesPerSession).toBe(10);
    expect(loaded.averages.knownEndpoints).toEqual(['9.9.9.9:443']);

    // A live instance-keyed bucket lands in that same pre-existing profile.
    baselines.recordFileAccess(CLAUDE_A, 'Claude', '/new/file.js', false);
    baselines.finalizeSession();
    const after = baselines.getBaselines().agents['Claude'];
    expect(after.sessionCount).toBe(5);
    expect(after.sessions).toHaveLength(2);
    expect(JSON.parse(fs.readFileSync(file, 'utf-8')).agents['Claude'].sessionCount).toBe(5);
  });

  it('session Sets deduplicate (files, dirs, endpoints)', () => {
    baselines.recordFileAccess(CLAUDE_A, 'Claude', '/file.js', false);
    baselines.recordFileAccess(CLAUDE_A, 'Claude', '/file.js', false);
    baselines.recordNetworkEndpoint(CLAUDE_A, 'Claude', '1.2.3.4', 443);
    baselines.recordNetworkEndpoint(CLAUDE_A, 'Claude', '1.2.3.4', 443);

    const sd = baselines.ensureSessionData(CLAUDE_A, 'Claude');
    expect(sd.files.size).toBe(1);
    expect(sd.endpoints.size).toBe(1);
  });
});
