/**
 * @file tests/main/bench/actor.test.js
 * @description The actor's pure half: what it refuses to run. Executing a
 *   scenario spawns real processes and is not what these tests do — they cover
 *   the checks that decide whether a scenario is allowed to run at all, plus
 *   the one consistency rule between the schema and the actor that nothing else
 *   would catch.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';

import actor from '../../../bench/lib/actor.js';

const ROOT = path.resolve(__dirname, '../../..');
const S1_PATH = path.join(ROOT, 'bench', 'scenarios', 'S1-agent-lifecycle', 'scenario.json');
const SCHEMA_PATH = path.join(ROOT, 'bench', 'scenario.schema.json');
const AGENT_DB_PATH = path.join(ROOT, 'src', 'shared', 'agent-database.json');

/**
 * A fresh, valid scenario every test can spoil in its own way.
 * @returns {Object}
 */
function scenario() {
  return {
    schemaVersion: 1,
    id: 'S9-fixture',
    title: 'Fixture',
    arms: ['A'],
    oracles: ['sysmon'],
    proves: 'Nothing — it exists to be broken by a test.',
    expect: [
      { id: 'E1', description: 'a file appears', category: 'file', type: 'creation' },
      { id: 'E2', description: 'a process starts', category: 'process', type: 'start' },
    ],
    steps: [
      {
        id: 'stage',
        kind: 'copy-binary',
        expect: 'E1',
        with: {
          from: '%SystemRoot%\\System32\\ping.exe',
          agentId: 'claude-code',
          agentName: 'claude.exe',
        },
      },
      {
        id: 'spawn',
        kind: 'spawn-process',
        expect: 'E2',
        with: { fromStep: 'stage', args: [] },
      },
    ],
  };
}

describe('bench actor — the shipped S1 scenario', () => {
  it('validates against the schema and the actor', () => {
    const s1 = JSON.parse(fs.readFileSync(S1_PATH, 'utf8'));
    expect(() => actor.validateScenario(s1)).not.toThrow();
    expect(() => actor.validateSteps(s1)).not.toThrow();
  });

  it('only uses step kinds the actor implements', () => {
    const s1 = JSON.parse(fs.readFileSync(S1_PATH, 'utf8'));
    for (const step of s1.steps) {
      expect(actor.KIND_NAMES).toContain(step.kind);
    }
  });
});

describe('bench actor — schema rejection', () => {
  it('accepts the fixture unspoiled', () => {
    expect(() => actor.validateScenario(scenario())).not.toThrow();
  });

  it('names a missing top-level field', () => {
    const s = scenario();
    delete s.proves;
    expect(() => actor.validateScenario(s)).toThrow(/should have required property 'proves'/);
  });

  it('names an arm outside the closed set', () => {
    const s = scenario();
    s.arms = ['D'];
    expect(() => actor.validateScenario(s)).toThrow(/\.arms\[0\].*allowed: A, B, C/s);
  });

  it('names a field the scenario format does not have', () => {
    const s = scenario();
    s.expectedEvents = 4;
    expect(() => actor.validateScenario(s)).toThrow(/additional properties — "expectedEvents"/);
  });

  it('names a missing parameter of a known step kind', () => {
    const s = scenario();
    delete s.steps[0].with.agentName;
    expect(() => actor.validateScenario(s)).toThrow(
      /\.steps\[0\]\.with should have required property 'agentName'/,
    );
  });

  it('names a parameter a step kind does not take', () => {
    const s = scenario();
    s.steps[1].with.ms = 1000;
    expect(() => actor.validateScenario(s)).toThrow(/\.steps\[1\]\.with.*"ms"/s);
  });

  it('rejects an expectation type outside the closed set', () => {
    const s = scenario();
    s.expect[0].type = 'modification';
    expect(() => actor.validateScenario(s)).toThrow(/\.expect\[0\]\.type/);
  });

  it('rejects a wait longer than the ten-minute ceiling', () => {
    const s = scenario();
    s.steps = [{ id: 'settle', kind: 'wait', with: { ms: 600001 } }];
    s.expect = [{ id: 'E1', description: 'x', category: 'file', type: 'creation' }];
    expect(() => actor.validateScenario(s)).toThrow(/\.steps\[0\]\.with\.ms/);
  });
});

describe('bench actor — step-kind rejection', () => {
  it('rejects a kind it does not implement, naming it and the ones it has', () => {
    const s = scenario();
    s.steps[1].kind = 'boil-ocean';
    expect(() => actor.validateSteps(s)).toThrow(
      /step kind "boil-ocean", which the actor does not implement/,
    );
    expect(() => actor.validateSteps(s)).toThrow(new RegExp(actor.KIND_NAMES.join(', ')));
  });

  it('lets an unimplemented kind through the schema, so the actor is the one that names it', () => {
    const s = scenario();
    s.steps[1].kind = 'boil-ocean';
    delete s.steps[1].with;
    expect(() => actor.validateScenario(s)).not.toThrow();
  });

  it('rejects a step that emits nothing but claims an expectation', () => {
    const s = scenario();
    s.steps[1] = { id: 'settle', kind: 'wait', expect: 'E2', with: { ms: 10 } };
    expect(() => actor.validateSteps(s)).toThrow(
      /emits no event and must not claim expectation "E2"/,
    );
  });

  it('rejects an emitting step that claims nothing', () => {
    const s = scenario();
    delete s.steps[1].expect;
    expect(() => actor.validateSteps(s)).toThrow(/must name the expectation it satisfies/);
  });

  it('rejects a claim on an expectation the scenario never declared', () => {
    const s = scenario();
    s.steps[1].expect = 'E9';
    expect(() => actor.validateSteps(s)).toThrow(
      /claims expectation "E9", which the scenario does not declare/,
    );
  });

  it('rejects a claim whose category or type contradicts what the kind emits', () => {
    const s = scenario();
    s.expect[1].type = 'end';
    expect(() => actor.validateSteps(s)).toThrow(
      /emits process\/start but expectation "E2" declares process\/end/,
    );
  });

  it('rejects an expectation no step produces', () => {
    const s = scenario();
    s.expect.push({ id: 'E3', description: 'never happens', category: 'file', type: 'deletion' });
    expect(() => actor.validateSteps(s)).toThrow(
      /expectation "E3" is declared but no step produces it/,
    );
  });

  it('rejects a back-reference to a step that does not come earlier', () => {
    const s = scenario();
    s.steps[1].with.fromStep = 'nowhere';
    expect(() => actor.validateSteps(s)).toThrow(
      /refers to step "nowhere", which does not appear before it/,
    );
  });

  it('rejects a back-reference to a step of the wrong kind', () => {
    const s = scenario();
    s.expect.push({ id: 'E3', description: 'a process ends', category: 'process', type: 'end' });
    s.steps.push({
      id: 'kill',
      kind: 'terminate-process',
      expect: 'E3',
      with: { fromStep: 'stage' },
    });
    expect(() => actor.validateSteps(s)).toThrow(
      /needs a "spawn-process" step but "stage" is a "copy-binary" step/,
    );
  });

  it('rejects a duplicate step id', () => {
    const s = scenario();
    s.steps[1].id = 'stage';
    expect(() => actor.validateSteps(s)).toThrow(/step id "stage" is used twice/);
  });

  it('rejects a duplicate expectation id', () => {
    const s = scenario();
    s.expect[1].id = 'E1';
    expect(() => actor.validateSteps(s)).toThrow(/expectation "E1" is declared twice/);
  });
});

describe('bench actor — schema and actor agree on the set of kinds', () => {
  it('has a parameter branch in the schema for every kind the actor implements', () => {
    const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
    const branches = schema.definitions.step.allOf.map((b) => b.if.properties.kind.const);
    expect([...branches].sort()).toEqual([...actor.KIND_NAMES].sort());
  });
});

describe('bench actor — stimulus is drawn from the agent database', () => {
  it('accepts a name the database gives that agent', () => {
    expect(() => actor.assertAgentName(AGENT_DB_PATH, 'claude-code', 'claude.exe')).not.toThrow();
  });

  it('rejects a name that merely looks like one', () => {
    expect(() => actor.assertAgentName(AGENT_DB_PATH, 'claude-code', 'claude-code.exe')).toThrow(
      /is not one of the names/,
    );
  });

  it('rejects an agent id the database does not have', () => {
    expect(() => actor.assertAgentName(AGENT_DB_PATH, 'not-an-agent', 'claude.exe')).toThrow(
      /agent id "not-an-agent" is not in/,
    );
  });
});

describe('bench actor — stage-directory containment respects the platform’s casing rule', () => {
  it('accepts a case-variant path INSIDE the stage directory on win32', () => {
    // The regression this suite pins: win32 paths are case-insensitive, so a staged
    // path differing only in casing (drive letter, any component) is still inside.
    expect(actor.isInsideStageDir('x:\\run\\stage\\claude.exe', 'X:\\Run\\Stage', 'win32')).toBe(
      true,
    );
    expect(actor.isInsideStageDir('X:\\RUN\\STAGE\\CLAUDE.EXE', 'x:\\run\\stage', 'win32')).toBe(
      true,
    );
  });

  it('is what the raw prefix check both call sites used to be got wrong', () => {
    // The exact comparison spawn-process and hold-secret-file performed before the
    // helper existed — kept here so the fixed behaviour above cannot be mistaken
    // for the old one agreeing by accident.
    expect('x:\\run\\stage\\claude.exe'.startsWith('X:\\Run\\Stage' + '\\')).toBe(false);
  });

  it('stays case-SENSITIVE off win32, where the filesystem’s own rule is', () => {
    expect(actor.isInsideStageDir('/run/Stage/claude', '/run/stage', 'linux')).toBe(false);
    expect(actor.isInsideStageDir('/run/stage/claude', '/run/stage', 'linux')).toBe(true);
    expect(actor.isInsideStageDir('/run/stage/claude', '/run/stage', 'darwin')).toBe(true);
  });

  it('rejects a path outside the stage directory on every platform', () => {
    expect(
      actor.isInsideStageDir('X:\\run\\elsewhere\\claude.exe', 'X:\\run\\stage', 'win32'),
    ).toBe(false);
    expect(actor.isInsideStageDir('/run/elsewhere/claude', '/run/stage', 'linux')).toBe(false);
    // Prefix-shaped but not contained: `stage2` begins with `stage` and must not pass.
    expect(actor.isInsideStageDir('X:\\run\\stage2\\claude.exe', 'X:\\run\\stage', 'win32')).toBe(
      false,
    );
    // The stage directory itself is not INSIDE the stage directory.
    expect(actor.isInsideStageDir('X:\\run\\stage', 'X:\\run\\stage', 'win32')).toBe(false);
  });
});

describe('bench actor — environment expansion and loading', () => {
  it('expands a variable that is set', () => {
    process.env.AEGIS_BENCH_FIXTURE = 'C:\\fixture';
    expect(actor.expandEnv('%AEGIS_BENCH_FIXTURE%\\ping.exe')).toBe('C:\\fixture\\ping.exe');
    delete process.env.AEGIS_BENCH_FIXTURE;
  });

  it('refuses to resolve a variable that is not set', () => {
    expect(() => actor.expandEnv('%AEGIS_BENCH_NOT_SET%\\ping.exe')).toThrow(
      /%AEGIS_BENCH_NOT_SET% is not set/,
    );
  });

  it('names the file it looked for when a scenario does not exist', () => {
    expect(() => actor.loadScenario('S99-not-a-scenario')).toThrow(
      /no scenario "S99-not-a-scenario" — expected .*scenario\.json/,
    );
  });
});
