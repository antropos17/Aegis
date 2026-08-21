/**
 * @file bench/lib/actor.js
 * @module bench/lib/actor
 * @description Executes a scenario's steps and emits the expected-event
 *   catalogue as a by-product.
 *
 *   The catalogue is never written ahead of a run. Each step is executed, what
 *   actually happened is captured at that moment — the pid the OS handed out,
 *   the absolute path the copy landed on, the instant read off the clock — and
 *   only then is a line built from it. A hand-written catalogue would be a
 *   guess about a machine, and a guess is not a basis for scoring anything.
 *
 *   What the catalogue asserts is still only intent plus the fact of execution.
 *   It is never the confirmation of what it asserts: every row is confirmed
 *   against an independent oracle before any metric counts it (B2.3, B2.6).
 *
 *   Two failure modes are kept apart on purpose:
 *
 *   - **The scenario is wrong** — bad shape, a step kind nobody implements, a
 *     reference to a step that does not exist. Caught before the run directory
 *     is created, named field by field, exit 2.
 *   - **A step did not execute** — the source binary is missing, the spawn
 *     failed, the process was already gone. Recorded as failed, the remaining
 *     steps are skipped, the run fails. A step that did not execute emits
 *     nothing: the catalogue must not contain a row that reads as if it had.
 *
 *   Nothing here imports from `src/`. `src/shared/agent-database.json` is read
 *   as a file because the scenario draws its stimulus from it — which name to
 *   give a fake agent. It is a stimulus, never evidence: no claim about what
 *   happened is taken from anything AEGIS ships.
 * @author AEGIS Contributors
 * @license MIT
 * @since v0.11.0
 */
'use strict';

const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const Ajv = require('ajv');

const catalogue = require('./catalogue');
const manifest = require('./manifest');

/** @type {string} Where scenario directories live. */
const SCENARIOS_DIR = path.join(manifest.ROOT, 'bench', 'scenarios');

/** @type {string} The draft-07 schema every scenario is validated against. */
const SCHEMA_PATH = path.join(manifest.ROOT, 'bench', 'scenario.schema.json');

/** @type {string} Agent signatures — the source of the names a scenario stages. */
const AGENT_DATABASE_PATH = path.join(manifest.ROOT, 'src', 'shared', 'agent-database.json');

/** @type {string} Subdirectory of a run holding the binaries it stages. */
const STAGE_DIRNAME = 'stage';

/**
 * The run-scoped home directory's name inside a run directory.
 *
 * Created only for a scenario that seeds a secret file into it — see
 * `KIND_IMPL['seed-secret-file']` for why the Restart Manager branch needs one.
 * @type {string}
 */
const HOME_DIRNAME = 'home';

/** @type {number} How long a terminated process is given to actually exit. */
const EXIT_TIMEOUT_MS = 10000;

/**
 * The bytes a seeded secret file holds.
 *
 * Fixed and inert on purpose: nothing here is a credential, and nothing about the
 * CONTENT makes the file sensitive. What makes it sensitive is the directory it sits
 * in matching a rule the product already ships, which is the same thing that would
 * make a real one sensitive.
 * @type {string}
 */
const SEEDED_SECRET_BYTES = ['{"bench":"seeded secret file — inert, not a credential"}', ''].join(
  '\n',
);

/**
 * The closed set of step kinds, mapped to the catalogue shape each emits.
 * `null` means the kind emits nothing — nothing can confirm the passage of
 * time, and a catalogue row no oracle can reach is decoration.
 * @type {Readonly<Object<string, string|null>>}
 */
const STEP_KINDS = Object.freeze({
  'copy-binary': 'file.creation',
  'spawn-process': 'process.start',
  wait: null,
  'terminate-process': 'process.end',
  'delete-file': 'file.deletion',
  'seed-secret-file': 'file.creation',
  'hold-secret-file': 'process.start',
});

/** @type {ReadonlyArray<string>} Implemented kinds, in declaration order. */
const KIND_NAMES = Object.freeze(Object.keys(STEP_KINDS));

/**
 * Which kind a step's `with.fromStep` has to name. A kind absent from this map
 * takes no back-reference.
 * @type {Readonly<Object<string, string>>}
 */
const FROM_STEP_KIND = Object.freeze({
  'spawn-process': 'copy-binary',
  'terminate-process': 'spawn-process',
  'delete-file': 'copy-binary',
  'hold-secret-file': 'copy-binary',
});

/** @type {import('ajv').ValidateFunction | null} Compiled once per process. */
let validateFn = null;

/**
 * Expand `%VAR%` against the environment.
 * @param {string} value
 * @returns {string}
 * @throws {Error} When a named variable is not set — a bench must not resolve
 *   an unset variable to an empty path segment and copy from somewhere else.
 */
function expandEnv(value) {
  return value.replace(/%([^%]+)%/g, (_match, name) => {
    const resolved = process.env[name];
    if (resolved === undefined) {
      throw new Error(
        `environment variable %${name}% is not set, so "${value}" cannot be resolved`,
      );
    }
    return resolved;
  });
}

/**
 * SHA-256 of a file on disk.
 * @param {string} file
 * @returns {string} Lowercase hex.
 */
function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/**
 * Load a scenario by id.
 * @param {string} id - Directory name under `bench/scenarios/`.
 * @returns {{dir: string, file: string, scenario: Object}}
 * @throws {Error} When the directory, the file, or the JSON is not there.
 */
function loadScenario(id) {
  const dir = path.join(SCENARIOS_DIR, id);
  const file = path.join(dir, 'scenario.json');
  if (!fs.existsSync(file)) {
    throw new Error(`no scenario "${id}" — expected ${file}`);
  }
  let scenario;
  try {
    scenario = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`${file} is not valid JSON: ${err.message}`, { cause: err });
  }
  if (scenario && scenario.id !== id) {
    throw new Error(
      `${file} declares id "${scenario.id}" but lives in "${id}" — a run directory named after ` +
        'one of the two would misname what was run',
    );
  }
  return { dir, file, scenario };
}

/**
 * Validate a scenario's shape against `bench/scenario.schema.json`.
 * @param {Object} scenario
 * @param {string} [schemaPath] - Override, for tests.
 * @throws {Error} Naming every field that is wrong.
 */
function validateScenario(scenario, schemaPath) {
  let validate;
  if (schemaPath) {
    validate = compileSchema(schemaPath);
  } else {
    if (!validateFn) validateFn = compileSchema(SCHEMA_PATH);
    validate = validateFn;
  }
  if (validate(scenario)) return;
  throw new Error(formatSchemaErrors(validate.errors));
}

/**
 * Compile one draft-07 schema. ajv is pinned at ^6, which understands draft-07
 * and no later draft — the same version and the same precedent as
 * `rules/_schema.json`.
 * @param {string} schemaPath
 * @returns {import('ajv').ValidateFunction}
 */
function compileSchema(schemaPath) {
  return new Ajv({ allErrors: true }).compile(JSON.parse(fs.readFileSync(schemaPath, 'utf8')));
}

/**
 * Turn ajv 6 errors into a message that names the field.
 * @param {Array<Object>|null|undefined} errors
 * @returns {string}
 */
function formatSchemaErrors(errors) {
  const lines = (errors ?? []).map((e) => {
    const where = e.dataPath || '<root>';
    const params = e.params ?? {};
    // ajv 6 leaves the offending key out of `message` for these two keywords;
    // without it "should NOT have additional properties" names no field at all.
    let detail = '';
    if (params.additionalProperty) detail = ` — "${params.additionalProperty}"`;
    else if (params.allowedValues) detail = ` — allowed: ${params.allowedValues.join(', ')}`;
    return `  ${where} ${e.message}${detail}`;
  });
  return `scenario does not match bench/scenario.schema.json:\n${lines.join('\n')}`;
}

/**
 * Validate what only the actor can: which kinds exist, which emit, and whether
 * the references between steps and expectations lead anywhere.
 * @param {Object} scenario - Already through {@link validateScenario}.
 * @throws {Error} On the first problem, named.
 */
function validateSteps(scenario) {
  const expectations = new Map();
  for (const e of scenario.expect) {
    if (expectations.has(e.id)) throw new Error(`expectation "${e.id}" is declared twice`);
    expectations.set(e.id, e);
  }
  const claimed = new Set();
  const seen = new Map();
  for (const step of scenario.steps) {
    if (seen.has(step.id)) throw new Error(`step id "${step.id}" is used twice`);
    if (!Object.prototype.hasOwnProperty.call(STEP_KINDS, step.kind)) {
      throw new Error(
        `step "${step.id}" uses step kind "${step.kind}", which the actor does not implement. ` +
          `Implemented kinds: ${KIND_NAMES.join(', ')}. An unknown kind fails the run rather ` +
          'than being skipped: a scenario that silently did less than it says is not a baseline.',
      );
    }
    const shapeName = STEP_KINDS[step.kind];
    if (shapeName === null && step.expect !== undefined) {
      throw new Error(
        `step "${step.id}" (kind "${step.kind}") emits no event and must not claim expectation ` +
          `"${step.expect}" — nothing would ever confirm it`,
      );
    }
    if (shapeName !== null) {
      if (step.expect === undefined) {
        throw new Error(
          `step "${step.id}" (kind "${step.kind}") emits a "${shapeName}" event and must name the ` +
            'expectation it satisfies in `expect`',
        );
      }
      const expectation = expectations.get(step.expect);
      if (!expectation) {
        throw new Error(
          `step "${step.id}" claims expectation "${step.expect}", which the scenario does not declare`,
        );
      }
      const shape = catalogue.EVENT_SHAPES[shapeName];
      if (expectation.category !== shape.category || expectation.type !== shape.type) {
        throw new Error(
          `step "${step.id}" (kind "${step.kind}") emits ${shape.category}/${shape.type} but ` +
            `expectation "${expectation.id}" declares ${expectation.category}/${expectation.type}`,
        );
      }
      claimed.add(step.expect);
    }
    const requiredKind = FROM_STEP_KIND[step.kind];
    if (requiredKind) {
      const target = seen.get(step.with.fromStep);
      if (!target) {
        throw new Error(
          `step "${step.id}" refers to step "${step.with.fromStep}", which does not appear before it`,
        );
      }
      if (target.kind !== requiredKind) {
        throw new Error(
          `step "${step.id}" (kind "${step.kind}") needs a "${requiredKind}" step but ` +
            `"${step.with.fromStep}" is a "${target.kind}" step`,
        );
      }
    }
    seen.set(step.id, step);
  }
  for (const id of expectations.keys()) {
    if (!claimed.has(id)) {
      throw new Error(`expectation "${id}" is declared but no step produces it`);
    }
  }
}

/**
 * Confirm the staged name really is one this agent is known by.
 * @param {string} databasePath
 * @param {string} agentId
 * @param {string} agentName
 * @throws {Error} When the id or the name is not in the database.
 */
function assertAgentName(databasePath, agentId, agentName) {
  const db = JSON.parse(fs.readFileSync(databasePath, 'utf8'));
  const agent = (db.agents ?? []).find((a) => a.id === agentId);
  if (!agent) {
    throw new Error(`agent id "${agentId}" is not in ${databasePath}`);
  }
  const names = agent.names ?? [];
  if (!names.some((n) => n.toLowerCase() === agentName.toLowerCase())) {
    throw new Error(
      `"${agentName}" is not one of the names ${databasePath} gives "${agentId}" ` +
        `(${names.join(', ')}) — the stimulus has to be drawn from the database, not resemble it`,
    );
  }
}

/**
 * Resolve when the child is running, reject when it never started.
 * @param {import('child_process').ChildProcess} child
 * @returns {Promise<string>} The instant the OS reported it spawned.
 */
function awaitSpawn(child) {
  return new Promise((resolve, reject) => {
    child.once('spawn', () => resolve(new Date().toISOString()));
    child.once('error', reject);
  });
}

/**
 * Resolve when the child exits.
 * @param {import('child_process').ChildProcess} child
 * @param {number} timeoutMs
 * @returns {Promise<{exitCode: number|null, signal: string|null, timestamp: string}>}
 */
function awaitExit(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`process ${child.pid} did not exit within ${timeoutMs} ms of being killed`));
    }, timeoutMs);
    child.once('exit', (exitCode, signal) => {
      clearTimeout(timer);
      resolve({ exitCode, signal, timestamp: new Date().toISOString() });
    });
  });
}

/**
 * Whether a resolved path sits INSIDE a resolved stage directory, by the path
 * rules of the platform the comparison is for.
 *
 * win32 paths are case-insensitive, so the two operands are lowercased before the
 * prefix check — a path that names a file inside the stage directory must not be
 * rejected for disagreeing about the casing of a drive letter or a segment.
 * Everywhere else the filesystem's own rule is case-sensitive and the comparison
 * stays exact. One helper for both call sites, so the two guards cannot drift.
 *
 * Note the containment guard's operands both derive from the same `ctx.stageDir`
 * today, so `execute()` cannot currently produce a case-variant pair — this fixes
 * the guard's CONTRACT on win32, where the false rejection was latent.
 * @param {string} resolvedPath - An absolute path, already through `path.resolve`.
 * @param {string} resolvedStageDir - The stage directory, already through `path.resolve`.
 * @param {string} [platform] - A `process.platform` value. Defaults to this one.
 * @returns {boolean}
 */
function isInsideStageDir(resolvedPath, resolvedStageDir, platform = process.platform) {
  const sep = platform === 'win32' ? '\\' : '/';
  const child = platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath;
  const parent = platform === 'win32' ? resolvedStageDir.toLowerCase() : resolvedStageDir;
  return child.startsWith(parent + sep);
}

/**
 * The step kinds themselves. Each returns `{observed, result}`: `observed` is
 * what the catalogue writes, `result` is what later steps refer back to.
 * @type {Readonly<Object<string, function(Object, Object): Promise<Object>>>}
 */
const KIND_IMPL = Object.freeze({
  'copy-binary': async (step, ctx) => {
    const from = expandEnv(step.with.from);
    if (!fs.existsSync(from) || !fs.statSync(from).isFile()) {
      throw new Error(`source binary ${from} does not exist`);
    }
    assertAgentName(ctx.agentDatabasePath, step.with.agentId, step.with.agentName);
    fs.mkdirSync(ctx.stageDir, { recursive: true });
    const dest = path.join(ctx.stageDir, step.with.agentName);
    fs.copyFileSync(from, dest, fs.constants.COPYFILE_EXCL);
    const timestamp = new Date().toISOString();
    return {
      observed: {
        timestamp,
        pid: process.pid,
        executable: process.execPath,
        path: dest,
        name: path.basename(dest),
        directory: path.dirname(dest),
        sizeBytes: fs.statSync(dest).size,
        sha256: sha256File(dest),
      },
      result: { path: dest, name: path.basename(dest), from },
    };
  },

  'spawn-process': async (step, ctx) => {
    const source = ctx.results.get(step.with.fromStep);
    const args = step.with.args ?? [];
    const resolvedExec = path.resolve(source.path);
    const resolvedStageDir = path.resolve(ctx.stageDir);
    if (!isInsideStageDir(resolvedExec, resolvedStageDir)) {
      throw new Error(`executable path is outside the stage directory`);
    }
    const child = spawn(resolvedExec, args, { stdio: 'ignore', windowsHide: true });
    ctx.children.push(child);
    const timestamp = await awaitSpawn(child);
    return {
      observed: {
        timestamp,
        pid: child.pid,
        name: source.name,
        executable: source.path,
        args,
        parentPid: process.pid,
      },
      result: { child, pid: child.pid, name: source.name, executable: source.path },
    };
  },

  wait: async (step) => {
    await new Promise((resolve) => setTimeout(resolve, step.with.ms));
    return { result: { waitedMs: step.with.ms } };
  },

  'terminate-process': async (step, ctx) => {
    const target = ctx.results.get(step.with.fromStep);
    if (target.child.exitCode !== null || target.child.signalCode !== null) {
      throw new Error(
        `process ${target.pid} had already exited (code ${target.child.exitCode}, signal ` +
          `${target.child.signalCode}) before this step ran — the scenario's premise that it ` +
          'stays alive across the wait did not hold, so its end is not the one being measured',
      );
    }
    // The exit listener is attached before the signal is sent, or a process
    // that dies instantly would exit between the two and never be seen.
    const exited = awaitExit(target.child, EXIT_TIMEOUT_MS);
    if (!target.child.kill()) {
      // Nothing will ever await `exited` now, and its timeout would reject into
      // an unhandled rejection — fatal on Node 22 — several seconds after this
      // step has already been recorded as failed.
      exited.catch(() => {});
      throw new Error(`could not signal process ${target.pid}`);
    }
    const end = await exited;
    return {
      observed: {
        timestamp: end.timestamp,
        pid: target.pid,
        name: target.name,
        executable: target.executable,
        exitCode: end.exitCode,
        signal: end.signal,
      },
      result: { pid: target.pid, exitCode: end.exitCode, signal: end.signal },
    };
  },

  /**
   * Create one secret file inside the run's own home, so the Restart Manager path
   * has something in scope to report a holder for.
   *
   * WHY A RUN-SCOPED HOME AT ALL. `platform/restart-manager.js` `buildSensitiveGroups`
   * enumerates `os.homedir()` and nothing else — the credential dirs and the agent
   * config dirs under it, plus `~/.env*`. A file staged in the run's `stage/` is never
   * a candidate, so without redirecting the sensor's home the RM branch is unreachable
   * from a bench scenario, and the only alternative would be seeding the developer's
   * REAL home on a shared machine. `bench/lib/sensor.js` points the sensor's
   * `USERPROFILE` at the run directory instead, and this step fills it.
   *
   * The file's bytes are fixed and inert. What makes it sensitive is the rules the
   * product already ships — the directory name has to match one of them, or
   * `buildSensitiveGroups` skips the group and the scenario proves nothing.
   */
  'seed-secret-file': async (step, ctx) => {
    if (!ctx.homeDir) {
      throw new Error(
        'this step needs a run-scoped home, and the run did not create one. bench/run.js ' +
          'creates it exactly when a scenario holds a seed-secret-file step',
      );
    }
    const dir = path.join(ctx.homeDir, step.with.dir);
    const dest = path.join(dir, step.with.name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(dest, SEEDED_SECRET_BYTES, { flag: 'wx' });
    const timestamp = new Date().toISOString();
    return {
      observed: {
        timestamp,
        pid: process.pid,
        executable: process.execPath,
        path: dest,
        name: path.basename(dest),
        directory: path.dirname(dest),
        sizeBytes: fs.statSync(dest).size,
        sha256: sha256File(dest),
      },
      result: { path: dest, name: path.basename(dest), directory: path.dirname(dest) },
    };
  },

  /**
   * Spawn the staged binary and have it HOLD the seeded file open.
   *
   * A hold, not a read. The Restart Manager reports the processes that hold a handle
   * to a registered resource at the instant it is asked, which is what the product's
   * own docs mean by "a HOLD at the tick, NEVER a transient open→read→close". A step
   * that opened and closed the file would leave nothing for a tick to find.
   *
   * The holder must be the STAGED binary rather than the actor, because
   * `_scanRmHolders` maps a holder pid onto an agent and drops any pid that is not
   * one — the actor is not an agent, so an actor-held file would be observed by RM
   * and then correctly discarded.
   *
   * Its lifetime is bounded by its own argument, the same guarantee `spawn-process`
   * gets from ping's `-n` count: an actor that dies before cleanup cannot leave a
   * process holding a file forever.
   */
  'hold-secret-file': async (step, ctx) => {
    if (!ctx.homeDir) {
      throw new Error('this step needs a run-scoped home, and the run did not create one');
    }
    const source = ctx.results.get(step.with.fromStep);
    const target = path.join(ctx.homeDir, step.with.dir, step.with.name);
    if (!fs.existsSync(target)) {
      throw new Error(`${target} does not exist — seed it before holding it`);
    }
    const resolvedExec = path.resolve(source.path);
    const resolvedStageDir = path.resolve(ctx.stageDir);
    if (!isInsideStageDir(resolvedExec, resolvedStageDir)) {
      throw new Error(`executable path is outside the stage directory`);
    }
    const holdMs = step.with.ms;
    const script =
      "const fs=require('fs');fs.openSync(process.argv[1],'r');" +
      `setTimeout(() => {}, ${holdMs});`;
    const child = spawn(resolvedExec, ['-e', script, target], {
      stdio: 'ignore',
      windowsHide: true,
    });
    ctx.children.push(child);
    const timestamp = await awaitSpawn(child);
    return {
      observed: {
        timestamp,
        pid: child.pid,
        name: source.name,
        executable: resolvedExec,
        args: ['-e', script, target],
        parentPid: process.pid,
      },
      result: { pid: child.pid, child, holding: target },
    };
  },

  'delete-file': async (step, ctx) => {
    const target = ctx.results.get(step.with.fromStep);
    fs.unlinkSync(target.path);
    return {
      observed: {
        timestamp: new Date().toISOString(),
        pid: process.pid,
        executable: process.execPath,
        path: target.path,
        name: target.name,
        directory: path.dirname(target.path),
      },
      result: { path: target.path, deleted: true },
    };
  },
});

/**
 * Kill anything the scenario spawned and did not terminate itself. Reported,
 * and deliberately not written to the catalogue: a cleanup kill is the harness
 * tidying up after a failure, not an event the scenario claimed would happen.
 * @param {Array<import('child_process').ChildProcess>} children
 * @param {function(string): void} log
 */
function cleanup(children, log) {
  for (const child of children) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    child.kill();
    log(`cleanup pid ${child.pid} was still alive and was killed — no catalogue line was written`);
  }
}

/**
 * Execute a scenario.
 * @param {Object} scenario - Through {@link validateScenario} and {@link validateSteps}.
 * @param {Object} opts
 * @param {string} opts.runDir - Absolute path of the run directory.
 * @param {string} [opts.homeDir] - The run-scoped home the sensor was pointed at, for
 *   scenarios that seed a secret file. Absent for every scenario that does not.
 * @param {string} [opts.agentDatabasePath] - Override, for tests.
 * @param {function(string): void} [opts.log] - Progress sink.
 * @returns {Promise<{ok: boolean, events: Object[], steps: Object[]}>}
 */
async function execute(scenario, opts) {
  const log = opts.log ?? (() => {});
  const ctx = {
    stageDir: path.join(opts.runDir, STAGE_DIRNAME),
    // The run-scoped home the sensor was pointed at, when this scenario asked for
    // one. `null` for every scenario that did not: a step that needs it fails by
    // name rather than falling back to the developer's real home directory.
    homeDir: opts.homeDir ?? null,
    agentDatabasePath: opts.agentDatabasePath ?? AGENT_DATABASE_PATH,
    results: new Map(),
    children: [],
  };
  const events = [];
  const steps = [];
  let ok = true;

  try {
    for (const step of scenario.steps) {
      if (!ok) {
        steps.push({ id: step.id, kind: step.kind, status: 'skipped' });
        continue;
      }
      const startedAt = new Date().toISOString();
      try {
        const outcome = await KIND_IMPL[step.kind](step, ctx);
        ctx.results.set(step.id, outcome.result);
        const shapeName = STEP_KINDS[step.kind];
        if (shapeName !== null) {
          events.push(
            catalogue.buildEvent({
              scenario: scenario.id,
              step: step.id,
              expect: step.expect,
              shape: shapeName,
              observed: outcome.observed,
            }),
          );
        }
        steps.push({ id: step.id, kind: step.kind, status: 'ok', startedAt, emitted: shapeName });
        log(`step    ${step.id} (${step.kind}) ok${shapeName ? ` → ${shapeName}` : ''}`);
      } catch (err) {
        ok = false;
        steps.push({
          id: step.id,
          kind: step.kind,
          status: 'failed',
          startedAt,
          error: err.message,
        });
        log(`step    ${step.id} (${step.kind}) FAILED — ${err.message}`);
      }
    }
  } finally {
    cleanup(ctx.children, log);
  }
  return { ok, events, steps };
}

module.exports = {
  AGENT_DATABASE_PATH,
  EXIT_TIMEOUT_MS,
  FROM_STEP_KIND,
  HOME_DIRNAME,
  KIND_NAMES,
  SCENARIOS_DIR,
  SCHEMA_PATH,
  STAGE_DIRNAME,
  STEP_KINDS,
  assertAgentName,
  execute,
  expandEnv,
  isInsideStageDir,
  loadScenario,
  sha256File,
  validateScenario,
  validateSteps,
};
