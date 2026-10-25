import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
const require = createRequire(import.meta.url);
const storage = require('../../../bench/lib/resource-supervisor-storage');
const directories = [];
afterEach(() => {
  for (const dir of directories.splice(0)) {
    if (
      path.dirname(path.resolve(dir)) !== path.resolve(os.tmpdir()) ||
      !path.basename(dir).startsWith('supervisor-private-child-') ||
      fs.lstatSync(dir).isSymbolicLink()
    )
      throw Error('unsafe-fixture-cleanup');
    fs.rmSync(dir, { recursive: true });
  }
});
function copied(childScript) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'supervisor-private-child-'));
  directories.push(root);
  for (const relative of storage.SOURCES) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.copyFileSync(path.join(storage.ROOT, relative), file);
  }
  fs.writeFileSync(path.join(root, 'bench/self-resource-run.cjs'), childScript);
  return { root, supervisor: require(path.join(root, 'bench/lib/resource-supervisor.js')) };
}
describe('private copied fixed-entry lifecycle fixtures (CI only)', () => {
  it.each([
    ['blocked', 'while (true) {}', 'wall-limit'],
    [
      'sigkill-with-sigterm-handler',
      "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);",
      'wall-limit',
    ],
    [
      'output-overflow',
      'process.stdout.write(Buffer.alloc(20000, 97)); setInterval(() => {}, 1000);',
      'output-overflow',
    ],
  ])(
    'bounds a real private %s child without production fault flags',
    async (_name, script, cause) => {
      const fixture = copied(script),
        out = path.join(fixture.root, 'outer');
      const result = await fixture.supervisor.superviseSelfResources({
        runId: 'private-fixture',
        durationMs: 1000,
        maxAcquisitionUs: 1000,
        maxCpuUncertaintyUs: 2000,
        wallLimitMs: 5000,
        confirmMs: 2000,
        out,
      });
      expect(result.exitCode).toBe(3);
      expect(result.receipt.executionMode).toBe('real-child');
      expect(result.receipt.supervision.cause).toBe(cause);
      expect(result.receipt.supervision.kill).toMatchObject({ attempted: true });
      // This supervisor requests SIGKILL only; the fixture does not establish SIGTERM delivery.
      expect(result.receipt.supervision.exit.observed).toBe(true);
      expect(result.receipt.supervision.close.observed).toBe(true);
      expect(result.receipt.childBundleAssessment).toBe('not-inspected');
      expect(result.receipt.measurementAccepted).toBe(false);
      expect(fs.existsSync(path.join(out, 'supervision-pending.json'))).toBe(true);
      if (cause === 'output-overflow')
        expect(result.receipt.supervision.stdout).toMatchObject({
          hashBytes: 16384,
          overflow: true,
          complete: false,
        });
    },
    12000,
  );
  it('records actual copied source endpoint change while preserving parent evidence', async () => {
    const fixture = copied("require('node:fs').appendFileSync(__filename, ' ');"),
      out = path.join(fixture.root, 'outer');
    const result = await fixture.supervisor.superviseSelfResources({
      runId: 'changed-fixture',
      durationMs: 1000,
      maxAcquisitionUs: 1000,
      maxCpuUncertaintyUs: 2000,
      wallLimitMs: 5000,
      confirmMs: 2000,
      out,
    });
    expect(result.exitCode).toBe(4);
    expect(result.receipt.sources.state).toBe('changed');
    expect(result.receipt.supervision.exit).toEqual({ observed: true, code: 0, signal: null });
    expect(fs.existsSync(path.join(out, 'supervision-plan.json'))).toBe(true);
    expect(fs.existsSync(path.join(out, 'supervision-final.json'))).toBe(true);
  }, 12000);
});
