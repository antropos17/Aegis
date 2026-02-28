import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import os from 'os';

const require = createRequire(import.meta.url);

describe('baselines', () => {
  let baselines;
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-baselines-test-'));
    baselines = require('../../src/main/baselines.js');
    baselines._setBaselinesPathForTest(path.join(tmpDir, 'baselines.json'));

    // Clear session data from prior tests
    const sd = baselines.getSessionData();
    for (const key of Object.keys(sd)) delete sd[key];
  });

  afterEach(() => {
    baselines._setBaselinesPathForTest(null);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('ensureSessionData() creates correct initial structure', () => {
    const sd = baselines.ensureSessionData('Claude');
    expect(sd.files).toBeInstanceOf(Set);
    expect(sd.sensitiveCount).toBe(0);
    expect(sd.directories).toBeInstanceOf(Set);
    expect(sd.endpoints).toBeInstanceOf(Set);
    expect(sd.sensitiveReasons).toBeInstanceOf(Set);
    expect(sd.activeHours).toBeInstanceOf(Set);
    expect(typeof sd.startTime).toBe('number');
  });

  it('ensureSessionData() returns same object on repeat call', () => {
    const sd1 = baselines.ensureSessionData('Claude');
    const sd2 = baselines.ensureSessionData('Claude');
    expect(sd1).toBe(sd2);
  });

  it('recordFileAccess() tracks files, dirs, sensitive count, reasons, hours', () => {
    baselines.recordFileAccess('Claude', '/home/user/project/file.js', false);
    baselines.recordFileAccess('Claude', '/home/user/.ssh/id_rsa', true, 'SSH key');

    const sd = baselines.ensureSessionData('Claude');
    expect(sd.files.size).toBe(2);
    expect(sd.directories.has('/home/user/project')).toBe(true);
    expect(sd.directories.has('/home/user/.ssh')).toBe(true);
    expect(sd.sensitiveCount).toBe(1);
    expect(sd.sensitiveReasons.has('SSH key')).toBe(true);
    expect(sd.activeHours.size).toBeGreaterThan(0);
  });

  it('recordNetworkEndpoint() tracks endpoints', () => {
    baselines.recordNetworkEndpoint('Claude', '1.2.3.4', 443);
    baselines.recordNetworkEndpoint('Claude', '5.6.7.8', 80);
    const sd = baselines.ensureSessionData('Claude');
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
      delete sd['Claude'];
      baselines.recordFileAccess('Claude', `/file${i}.js`, false);
      baselines.finalizeSession();
    }

    const bl = baselines.getBaselines();
    expect(bl.agents['Claude']).toBeDefined();
    expect(bl.agents['Claude'].sessions.length).toBeLessThanOrEqual(10);
    expect(bl.agents['Claude'].sessionCount).toBe(12);
  });

  it('finalizeSession() skips agents with zero activity', () => {
    baselines.ensureSessionData('Idle');
    baselines.finalizeSession();
    const bl = baselines.getBaselines();
    expect(bl.agents['Idle']).toBeUndefined();
  });

  it('session Sets deduplicate (files, dirs, endpoints)', () => {
    baselines.recordFileAccess('Claude', '/file.js', false);
    baselines.recordFileAccess('Claude', '/file.js', false);
    baselines.recordNetworkEndpoint('Claude', '1.2.3.4', 443);
    baselines.recordNetworkEndpoint('Claude', '1.2.3.4', 443);

    const sd = baselines.ensureSessionData('Claude');
    expect(sd.files.size).toBe(1);
    expect(sd.endpoints.size).toBe(1);
  });
});
