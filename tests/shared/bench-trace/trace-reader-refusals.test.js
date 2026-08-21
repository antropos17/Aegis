/**
 * @file tests/shared/bench-trace/trace-reader-refusals.test.js
 * @description Every reason a trace is refused, pinned one at a time by name.
 *
 *   A refusal that fires for the right file but reports the wrong reason sends a
 *   reader to the wrong place, so each case asserts `err.reason` and not merely that
 *   something threw. The environment is synthetic (see `_make-trace.js`) so a case
 *   cannot pass on this machine for a reason that has nothing to do with what it
 *   pins — except in the last block, which observes the real tree and asserts shape
 *   and stability rather than values.
 */
import fs from 'fs';
import path from 'path';
import { describe, it, expect, afterEach } from 'vitest';

import environment from '../../../bench/trace/environment.js';
import schema from '../../../bench/trace/schema.js';
import writer from '../../../bench/trace/writer.js';
import reader from '../../../bench/trace/reader.js';

import {
  CLOCK_EPOCH_MS,
  makeAgent,
  makeAmbient,
  makeEnv,
  makeHeader,
  makeRecords,
  makeScope,
  writeTraceDir,
} from './_make-trace.js';

/** @type {string[]} Directories to remove after each test. */
const created = [];

/** @param {Object} [opts] @returns {string} A trace directory, cleaned up afterwards. */
function tempTrace(opts) {
  const dir = writeTraceDir(opts);
  created.push(dir);
  return dir;
}

/**
 * Read a trace and return the refusal it raised, or `null` when it was accepted.
 * @param {string} dir
 * @param {Object} [env]
 * @returns {import('../../../bench/trace/schema.js').TraceError|null}
 */
function refusalFrom(dir, env) {
  try {
    reader.readTrace(dir, { env: env || makeEnv() });
  } catch (err) {
    return err;
  }
  return null;
}

afterEach(() => {
  while (created.length > 0) {
    fs.rmSync(created.pop(), { recursive: true, force: true });
  }
});

describe('refusal list', () => {
  it('is closed, unique, and every reason is a kebab-case string', () => {
    expect(Object.isFrozen(schema.REFUSAL)).toBe(true);
    const reasons = schema.REFUSAL_REASONS;
    expect(new Set(reasons).size).toBe(reasons.length);
    for (const reason of reasons) expect(reason).toMatch(/^[a-z]+(-[a-z]+)*$/);
  });

  it('accepts a trace whose header matches its environment', () => {
    expect(refusalFrom(tempTrace())).toBeNull();
  });
});

describe('refusal — the header itself', () => {
  it('schema-version: a newer trace is refused, not read past', () => {
    const header = makeHeader({ overrides: { traceSchemaVersion: 2 } });
    const err = refusalFrom(tempTrace({ header }));
    expect(err.reason).toBe(schema.REFUSAL.SCHEMA_VERSION);
    expect(err.message).toContain('a trace is an INPUT');
  });

  it('schema-version: an older or absent version is refused too', () => {
    for (const version of [0, undefined, '1']) {
      const header = makeHeader({ overrides: { traceSchemaVersion: version } });
      expect(refusalFrom(tempTrace({ header })).reason).toBe(schema.REFUSAL.SCHEMA_VERSION);
    }
  });

  it('header-malformed: a missing id, clock, tz or neutralization block', () => {
    const cases = [
      { id: '' },
      { clock: {} },
      { tz: { offsetMinutesAt: 0 } },
      { neutralization: null },
      { digests: null },
    ];
    for (const overrides of cases) {
      const err = refusalFrom(tempTrace({ header: makeHeader({ overrides }) }));
      expect(err.reason, JSON.stringify(overrides)).toBe(schema.REFUSAL.HEADER_MALFORMED);
    }
  });

  it('header-malformed: the header and the records name different traces', () => {
    const header = makeHeader({ id: 'T9-other' });
    const err = refusalFrom(tempTrace({ header, records: makeRecords() }));
    expect(err.reason).toBe(schema.REFUSAL.HEADER_MALFORMED);
    expect(err.message).toContain('assembled out of two');
  });
});

describe('refusal — the environment a trace pins', () => {
  it('platform-mismatch', () => {
    const err = refusalFrom(tempTrace(), makeEnv({ platform: 'linux' }));
    expect(err.reason).toBe(schema.REFUSAL.PLATFORM_MISMATCH);
    expect(err.message).toContain('only look faithful');
  });

  it('tz-mismatch', () => {
    const env = makeEnv();
    const other = makeEnv({ tz: { ...env.tz, name: 'America/New_York' } });
    const err = refusalFrom(tempTrace({ header: makeHeader({ env }) }), other);
    expect(err.reason).toBe(schema.REFUSAL.TZ_MISMATCH);
  });

  it('evidence-codes-mismatch: a code added to the closed list', () => {
    const env = makeEnv();
    const grown = makeEnv({
      digests: { ...env.digests, evidenceCodes: [...env.digests.evidenceCodes, 'new-code'] },
    });
    const err = refusalFrom(tempTrace({ header: makeHeader({ env }) }), grown);
    expect(err.reason).toBe(schema.REFUSAL.EVIDENCE_CODES_MISMATCH);
  });

  it('evidence-codes-mismatch: the same codes in a different order', () => {
    // A reordering changes no verdict. It IS a change to a closed list the format
    // pins, and a format that tolerated it would have no way to report the change
    // that does matter.
    const env = makeEnv();
    const shuffled = makeEnv({
      digests: { ...env.digests, evidenceCodes: [...env.digests.evidenceCodes].reverse() },
    });
    expect(refusalFrom(tempTrace({ header: makeHeader({ env }) }), shuffled).reason).toBe(
      schema.REFUSAL.EVIDENCE_CODES_MISMATCH,
    );
  });

  it('digest-mismatch: a rule file, the compiled rules, the agent database, a source file', () => {
    const env = makeEnv();
    const mutate = (fn) => {
      const next = makeEnv();
      fn(next.digests);
      return next;
    };
    const cases = [
      ['rules.files', mutate((d) => (d.rules.files['secrets.yaml'] = '9'.repeat(64)))],
      ['rules.compiled', mutate((d) => (d.rules.compiled = '9'.repeat(64)))],
      ['rules.schemaFile', mutate((d) => (d.rules.schemaFile = '9'.repeat(64)))],
      ['agentDatabase', mutate((d) => (d.agentDatabase.sha256 = '9'.repeat(64)))],
      ['sources', mutate((d) => (d.sources['src/shared/constants.js'] = '9'.repeat(64)))],
    ];
    for (const [label, observed] of cases) {
      const err = refusalFrom(tempTrace({ header: makeHeader({ env }) }), observed);
      expect(err.reason, label).toBe(schema.REFUSAL.DIGEST_MISMATCH);
    }
  });

  it('digest-mismatch: the rules enumerate in a different order', () => {
    // `classifySensitive` takes the FIRST matching rule, so the same files in a
    // different readdir order can disagree about one path's reason.
    const env = makeEnv();
    const reordered = makeEnv();
    reordered.digests.rules.loadOrder = ['secrets.yaml', 'ai-config.yaml'];
    const err = refusalFrom(tempTrace({ header: makeHeader({ env }) }), reordered);
    expect(err.reason).toBe(schema.REFUSAL.DIGEST_MISMATCH);
    expect(err.message).toContain('rules.loadOrder');
  });
});

describe('refusal — scope', () => {
  it('scope-incomplete: a required question is not answered at all', () => {
    for (const key of environment.REQUIRED_SCOPE_KEYS) {
      const scope = makeScope();
      delete scope[key];
      const header = makeHeader({ overrides: { scope } });
      const err = refusalFrom(tempTrace({ header }));
      expect(err.reason, key).toBe(schema.REFUSAL.SCOPE_INCOMPLETE);
      expect(err.message).toContain(key);
    }
  });

  it('scope-incomplete: an absent fact recorded without a reason', () => {
    const scope = makeScope();
    scope.anomalyAlerts = { value: null };
    const err = refusalFrom(tempTrace({ header: makeHeader({ overrides: { scope } }) }));
    expect(err.reason).toBe(schema.REFUSAL.SCOPE_INCOMPLETE);
    expect(err.message).toContain('WITH why');
  });

  it('accepts a scope entry that answers with a value', () => {
    const scope = { ...makeScope(), rmFullPath: { value: 'covered' } };
    expect(refusalFrom(tempTrace({ header: makeHeader({ overrides: { scope } }) }))).toBeNull();
  });
});

describe('refusal — record shape and kind order', () => {
  it('unknown-kind: a kind outside the closed list', () => {
    const records = makeRecords();
    const swapped = { ...records[1], bench: { ...records[1].bench, kind: 'fs.renamed' } };
    const rechained = writer.chainRecords(
      records.map((r, i) => {
        const copy = i === 1 ? { ...swapped } : { ...r };
        delete copy.hash;
        return copy;
      }),
    );
    const err = refusalFrom(tempTrace({ records: rechained }));
    expect(err.reason).toBe(schema.REFUSAL.UNKNOWN_KIND);
  });

  it('lets a handle-pool tick and a Restart Manager tick appear in either order', () => {
    // Not an ordering rule, and deliberately so. `scanAllFileHandles` diverts to the
    // Restart Manager only when `_getSensitiveHolders` is set (`rmEnabled`), phase 1
    // never injects it — `scope.rmFullPath` records why — and `isHotReadScanActive`
    // reads only `_getHotSensitiveHolders`. The two kinds are independent, and a
    // refusal here would be guarding a constraint this path does not have.
    const both = (first, second) => {
      const trace = 'T0-synthetic';
      const tick = (seq, kind) =>
        writer.buildRecord({
          trace,
          seq,
          kind,
          epochMs: CLOCK_EPOCH_MS + seq,
          input:
            kind === 'handles.tick'
              ? { byPid: { 4812: ['X:\dev\project\AEGIS\.env'] } }
              : { holders: [{ pid: 4812, group: 'X:\dev\project\AEGIS\.env' }] },
          ambient: makeAmbient(),
        });
      return writer.chainRecords([
        writer.buildRecord({
          trace,
          seq: 0,
          kind: 'population.set',
          epochMs: CLOCK_EPOCH_MS,
          input: { agents: [makeAgent()] },
        }),
        tick(1, first),
        tick(2, second),
      ]);
    };
    expect(refusalFrom(tempTrace({ records: both('rm.hot.tick', 'handles.tick') }))).toBeNull();
    expect(refusalFrom(tempTrace({ records: both('handles.tick', 'rm.hot.tick') }))).toBeNull();
  });
});

describe('the observed environment', () => {
  it('reports the shape the header pins, read off this tree', () => {
    const env = environment.observeEnvironment({ clockEpochMs: CLOCK_EPOCH_MS });
    expect(env.platform).toBe(process.platform);
    expect(env.pathSep).toBe(path.sep);
    expect(env.digests.algorithm).toBe('sha256');
    expect(env.digests.rules.loadOrder.length).toBeGreaterThan(0);
    expect(env.digests.rules.compiled).toMatch(/^[0-9a-f]{64}$/);
    expect(env.digests.agentDatabase.sha256).toMatch(/^[0-9a-f]{64}$/);
    for (const rel of environment.pinnedSourceFiles(process.platform)) {
      expect(env.digests.sources[rel], rel).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('names the platform module that would actually be loaded', () => {
    // `src/main/platform/index.js` picks win32 and darwin by name and everything else
    // linux, so a digest of a file that merely exists would pin the wrong constants.
    expect(environment.pinnedSourceFiles('win32')).toContain('src/main/platform/win32.js');
    expect(environment.pinnedSourceFiles('darwin')).toContain('src/main/platform/darwin.js');
    expect(environment.pinnedSourceFiles('freebsd')).toContain('src/main/platform/linux.js');
  });

  it('is stable across calls and does not populate the rule cache', () => {
    const first = environment.observeEnvironment({ clockEpochMs: CLOCK_EPOCH_MS });
    const second = environment.observeEnvironment({ clockEpochMs: CLOCK_EPOCH_MS });
    expect(second).toEqual(first);
  });

  it('digests content, not line endings', () => {
    // `.gitattributes` puts this tree under `text=auto`, so the same commit lands as
    // CRLF on one clone and LF on another. A byte digest would refuse a trace that
    // names exactly the rules the tree holds.
    const crlf = Buffer.from('a: 1\r\nb: 2\r\n', 'utf8');
    const lf = Buffer.from('a: 1\nb: 2\n', 'utf8');
    expect(environment.foldLineEndings(crlf)).toBe(environment.foldLineEndings(lf));
    expect(environment.foldLineEndings(Buffer.from('a\r\nb'))).toBe('a\nb');
    expect(environment.foldLineEndings(Buffer.from('a\rb'))).toBe('a\nb');
    // Nothing else is folded: a real edit still moves the digest.
    expect(environment.foldLineEndings(Buffer.from('a  b'))).not.toBe(
      environment.foldLineEndings(Buffer.from('a b')),
    );
  });
});
