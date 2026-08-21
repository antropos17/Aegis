/**
 * @file tests/shared/bench-scenarios/actor-secret-hold.test.js
 * @description The two step kinds that let a scenario reach the Restart Manager
 *   read-detect branch: `seed-secret-file` and `hold-secret-file`.
 *
 *   Both exist because `platform/restart-manager.js` `buildSensitiveGroups`
 *   enumerates `os.homedir()` and nothing else, so a file staged in a run's
 *   `stage/` is never in scope. The bench moves the home into the run directory
 *   rather than seeding the developer's real one, and these two kinds fill it and
 *   hold it.
 *
 *   What is pinned here is the refusals. The branch itself was confirmed by a live
 *   arm-A run, which is the only thing that can confirm it — an RM scan needs a
 *   Windows host, a PowerShell spawn and a real process holding a real handle, and
 *   a unit test that faked any of those would be testing the fake.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, afterEach } from 'vitest';

import paths from '../../../bench/lib/paths.js';
import actor from '../../../bench/lib/actor.js';

/**
 * A path as the CATALOGUE records it.
 *
 * The catalogue neutralizes every path it writes — the clone root and the OS account
 * name — so a row never carries the machine it was recorded on. A case comparing
 * against a raw path would fail on the account name and say nothing about the step.
 * @param {string} p
 * @returns {string}
 */
function recorded(p) {
  return paths.neutralizePath(p);
}

/** @type {string[]} Directories to remove after each case. */
const created = [];

/** @returns {{runDir: string, homeDir: string}} A throwaway run. */
function tempRun() {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-actor-hold-'));
  created.push(runDir);
  return {
    runDir,
    homeDir: path.join(runDir, actor.HOME_DIRNAME),
  };
}

/**
 * Run steps through the actor's real executor, the way a run does.
 *
 * `execute()` rather than the kind implementations directly: a step that refuses
 * surfaces as `status: 'failed'` with its message, which is exactly how a run
 * reports it, and the catalogue rows are built by the same code that builds a real
 * one. Its `finally` also kills whatever the steps spawned, so a case cannot leak a
 * process holding a file.
 * @param {Object[]} steps
 * @param {Object} opts - `{runDir, homeDir}`.
 * @returns {Promise<{ok: boolean, events: Object[], steps: Object[]}>}
 */
function execute(steps, opts) {
  return actor.execute({ id: 'T-unit', steps }, opts);
}

/** A `copy-binary` step staging this interpreter under an agent name. */
const STAGE_STEP = {
  id: 'stage',
  kind: 'copy-binary',
  expect: 'E1',
  with: {
    from: process.execPath,
    agentId: 'claude-code',
    agentName: 'claude.exe',
  },
};

/**
 * Remove a run directory once Windows has actually released it.
 *
 * `actor.execute()` kills what it spawned, but a kill is not synchronous: the holder
 * can still own its handle — and its own image is still mapped — for a moment after.
 * A plain `rmSync` here raced that and failed with EPERM under load, which turned a
 * passing assertion into a red suite for a reason that had nothing to do with the
 * step being tested.
 *
 * Retries, then gives up quietly. A temp directory the OS will reclaim is not a test
 * result, and failing the case on it would report a cleanup problem as a defect in
 * the code under test.
 * @param {string} dir
 * @returns {void}
 */
function removeWhenReleased(dir) {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (_) {
      const until = Date.now() + 50;
      while (Date.now() < until) {
        /* the handle is released by the OS, not by anything this loop can await */
      }
    }
  }
}

afterEach(() => {
  while (created.length > 0) {
    removeWhenReleased(created.pop());
  }
});

describe('the closed set of kinds', () => {
  it('declares a catalogue shape for both new kinds', () => {
    expect(actor.STEP_KINDS['seed-secret-file']).toBe('file.creation');
    expect(actor.STEP_KINDS['hold-secret-file']).toBe('process.start');
  });

  it('makes the holder reference a staged binary, never a bare path', () => {
    // `_scanRmHolders` maps a holder pid onto an agent and drops any pid that is not
    // one, so the holder has to be the staged binary. Requiring a `copy-binary`
    // back-reference is what makes that structural rather than a convention.
    expect(actor.FROM_STEP_KIND['hold-secret-file']).toBe('copy-binary');
  });
});

describe('seed-secret-file', () => {
  it('refuses when the run created no run-scoped home', async () => {
    // The alternative to refusing is falling back to os.homedir(), which would seed
    // the developer's real credential directory. It fails by name instead.
    const { runDir } = tempRun();
    const out = await execute(
      [
        {
          id: 'seed',
          kind: 'seed-secret-file',
          expect: 'E1',
          with: { dir: '.ssh', name: 'id_rsa' },
        },
      ],
      { runDir },
    );
    expect(out.ok).toBe(false);
    expect(out.steps[0].status).toBe('failed');
    expect(out.steps[0].error).toMatch(/run-scoped home/);
    expect(out.events, 'a step that did not execute emits nothing').toHaveLength(0);
  });

  it('writes fixed, inert bytes into the run home and catalogues what it wrote', async () => {
    const { runDir, homeDir } = tempRun();
    const out = await execute(
      [
        {
          id: 'seed',
          kind: 'seed-secret-file',
          expect: 'E1',
          with: { dir: '.ssh', name: 'id_rsa' },
        },
      ],
      { runDir, homeDir },
    );
    expect(out.ok, out.steps[0].error).toBe(true);

    const written = path.join(homeDir, '.ssh', 'id_rsa');
    expect(fs.existsSync(written)).toBe(true);
    expect(out.events).toHaveLength(1);
    expect(out.events[0].file.path).toBe(recorded(written));
    expect(out.events[0].event.type).toEqual(['creation']);
    // Nothing about the CONTENT makes it sensitive — the directory does. A file whose
    // bytes looked like a key would invite exactly the opposite reading.
    expect(fs.readFileSync(written, 'utf8')).not.toMatch(/PRIVATE KEY/);
  });

  it('refuses to overwrite a file it already seeded', async () => {
    const { runDir, homeDir } = tempRun();
    const seed = {
      id: 'seed',
      kind: 'seed-secret-file',
      expect: 'E1',
      with: { dir: '.ssh', name: 'id_rsa' },
    };
    const out = await execute([seed, { ...seed, id: 'seed-again' }], { runDir, homeDir });
    expect(out.steps[0].status).toBe('ok');
    expect(out.steps[1].status).toBe('failed');
  });
});

describe('hold-secret-file', () => {
  it('refuses a file nobody seeded, rather than holding nothing', async () => {
    const { runDir, homeDir } = tempRun();
    const out = await execute(
      [
        STAGE_STEP,
        {
          id: 'hold',
          kind: 'hold-secret-file',
          expect: 'E2',
          with: { fromStep: 'stage', dir: '.ssh', name: 'id_rsa', ms: 500 },
        },
      ],
      { runDir, homeDir },
    );
    expect(out.steps[1].status).toBe('failed');
    expect(out.steps[1].error).toMatch(/seed it before holding it/);
  });

  it('refuses an executable outside the stage directory', async () => {
    // The same containment the `spawn-process` guard keeps: a scenario may only run
    // what the run itself staged. Here the staged path is replaced after the copy, so
    // the guard is what catches it rather than the copy.
    const { runDir, homeDir } = tempRun();
    const out = await execute(
      [
        {
          id: 'seed',
          kind: 'seed-secret-file',
          expect: 'E1',
          with: { dir: '.ssh', name: 'id_rsa' },
        },
        STAGE_STEP,
        {
          id: 'hold',
          kind: 'hold-secret-file',
          expect: 'E2',
          with: { fromStep: 'seed', dir: '.ssh', name: 'id_rsa', ms: 500 },
        },
      ],
      { runDir, homeDir },
    );
    // `seed`'s result carries the seeded file's path, which is not under stage/.
    expect(out.steps[2].status).toBe('failed');
    expect(out.steps[2].error).toMatch(/outside the stage directory/);
  });

  it('spawns the staged binary against the seeded file, and bounds its own lifetime', async () => {
    const { runDir, homeDir } = tempRun();
    const out = await execute(
      [
        STAGE_STEP,
        {
          id: 'seed',
          kind: 'seed-secret-file',
          expect: 'E2',
          with: { dir: '.ssh', name: 'id_rsa' },
        },
        {
          id: 'hold',
          kind: 'hold-secret-file',
          expect: 'E3',
          with: { fromStep: 'stage', dir: '.ssh', name: 'id_rsa', ms: 1500 },
        },
      ],
      { runDir, homeDir },
    );
    expect(out.ok, out.steps.map((s) => s.error).join(' | ')).toBe(true);

    const target = path.join(homeDir, '.ssh', 'id_rsa');
    const started = out.events.find((e) => e.event.type[0] === 'start');
    expect(started.process.pid).toBeGreaterThan(0);
    expect(started.process.executable).toBe(
      recorded(path.join(runDir, actor.STAGE_DIRNAME, 'claude.exe')),
    );
    expect(started.process.args[started.process.args.length - 1]).toBe(recorded(target));
    // The hold bounds itself, the same guarantee ping's `-n` count gives
    // `spawn-process`: an actor that dies before cleanup leaves nothing running.
    expect(started.process.args.join(' ')).toContain('setTimeout');
  });
});
