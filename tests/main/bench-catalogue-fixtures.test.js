import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { afterEach, describe, expect, it } from 'vitest';
import actor from '../../bench/lib/actor.js';
import catalogue from '../../bench/lib/catalogue.js';
import runner from '../../bench/run.js';
import metrics from '../../bench/lib/metrics.js';
import fixture from '../../bench/lib/fixture.js';

const temporary = [];
function directory() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-catalogue-'));
  temporary.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const cases = [
  ['S3-ordinary-fixture', 'project', false],
  ['S4-outside-project', 'outside-project', false],
  ['S5-disposable-deletion', 'project', true],
  ['S6-inert-persistence', 'persistence-location', false],
];

describe('executable synthetic corpus through the existing runner', () => {
  it.each(cases)(
    '%s records actual fixture events and preserves oracle admission',
    async (id, target, deleted) => {
      const scenario = runner.prepareScenario(id, 'B');
      const dir = directory();
      const outcome = await actor.execute(scenario, { runDir: dir });
      expect(outcome.ok).toBe(true);
      expect(outcome.events.map((e) => e.event.type[0])).toEqual(
        deleted ? ['creation', 'deletion'] : ['creation'],
      );
      const destination = path.join(dir, 'fixtures', target, 'canary-result.txt');
      expect(outcome.events[0].file.path).toBe(destination);
      expect(outcome.events[0].file.hash.sha256).toBe(
        crypto.createHash('sha256').update('AEGIS inert fixture\n').digest('hex'),
      );
      expect(fs.existsSync(destination)).toBe(!deleted);
      if (!deleted) expect(fs.readFileSync(destination, 'utf8')).toBe('AEGIS inert fixture\n');
      const written = catalogue.write(dir, outcome.events);
      expect(fs.readFileSync(written, 'utf8').trim().split('\n').map(JSON.parse)).toEqual(
        outcome.events,
      );
      const steps = JSON.parse(
        fs.readFileSync(
          runner.writeSteps({
            dir,
            runId: 'fixture-only',
            scenario,
            arm: 'B',
            steps: outcome.steps,
          }),
          'utf8',
        ),
      );
      expect(steps.expectations).toEqual({
        claimed: deleted ? 2 : 1,
        emitted: deleted ? 2 : 1,
        notExecuted: 0,
      });
      // The actor and even a matching observation cannot independently confirm themselves.
      const built = metrics.buildMetrics({
        runId: 'fixture-only',
        scenario: id,
        arm: 'A',
        expected: outcome.events,
        oracle: [],
        loss: { collection: { ran: false } },
        observed: outcome.events,
        maxLatency: { value: 1000, source: 'unit fixture' },
        steps,
        inputs: [],
      });
      expect(built.matched.every((row) => row.groundTruth === false)).toBe(true);
      expect(built.metrics.sensor['file/creation'].recallValue).toBeNull();
    },
  );

  it('refuses an overwrite, records failed/skipped steps and emits no invented events', async () => {
    const scenario = runner.prepareScenario('S5-disposable-deletion', 'B');
    const dir = directory();
    const first = await actor.execute(scenario, { runDir: dir });
    expect(first.ok).toBe(true);
    const target = path.join(dir, 'fixtures', 'project', 'canary-result.txt');
    fs.writeFileSync(target, 'existing evidence');
    const result = await actor.execute(scenario, { runDir: dir });
    expect(result.ok).toBe(false);
    expect(result.events).toEqual([]);
    expect(result.steps.map((step) => step.status)).toEqual(['failed', 'skipped']);
    const steps = JSON.parse(
      fs.readFileSync(
        runner.writeSteps({
          dir,
          runId: 'failed-fixture',
          scenario,
          arm: 'B',
          steps: result.steps,
        }),
        'utf8',
      ),
    );
    expect(steps.expectations).toEqual({ claimed: 2, emitted: 0, notExecuted: 2 });
    expect(fs.readFileSync(target, 'utf8')).toBe('existing evidence');
  });

  it.each(['../outside', 'C:/host/startup', '/tmp/escape', 'project/../../escape'])(
    'refuses path injection %s before execution and at the write boundary',
    (target) => {
      const scenario = runner.prepareScenario('S3-ordinary-fixture', 'B');
      scenario.steps[0].with.target = target;
      expect(() => actor.validateScenario(scenario)).toThrow();
      expect(() => fixture.writeFixture(scenario.steps[0].with, directory())).toThrow(/invalid/);
    },
  );

  it.each(['../canary-escape.txt', 'C:\\canary-escape.txt', 'con.txt'])(
    'refuses unsafe names %s',
    (name) => {
      expect(() =>
        fixture.writeFixture({ target: 'project', name, content: 'inert' }, directory()),
      ).toThrow(/invalid/);
    },
  );

  it('refuses a linked fixture compartment and leaves the external directory untouched', () => {
    const dir = directory();
    const external = directory();
    fs.mkdirSync(path.join(dir, 'fixtures'));
    const link = path.join(dir, 'fixtures', 'project');
    fs.symlinkSync(external, link, process.platform === 'win32' ? 'junction' : 'dir');
    try {
      expect(() =>
        fixture.writeFixture(
          { target: 'project', name: 'canary-result.txt', content: 'inert' },
          dir,
        ),
      ).toThrow(/ordinary owned/);
      expect(fs.readdirSync(external)).toEqual([]);
    } finally {
      fs.unlinkSync(link);
    }
  });
});
