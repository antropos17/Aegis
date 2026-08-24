/**
 * sequence-rule-loader — the accepted subset of Sigma correlations, and every refusal.
 *
 * The loader's only channel for a REJECTION is `logger.warn`; the return value carries the
 * count, not the cause. `logger` is therefore pulled in through `createRequire`, which is the
 * same native module instance `require('./logger')` resolves inside the loader — an ESM
 * `import` of the same path yields a DIFFERENT object and a spy on it never fires (measured).
 * The module under test stays on a plain ESM import so coverage instruments it.
 *
 * Every rejection row asserts the EXACT set of reasons the file produced, not a substring of
 * one message: a fixture that trips its own reason plus two others would pass a `toContain`
 * assertion and quietly stop being a test of anything in particular (ai-mistakes #21).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import loader from '../../src/main/sequence-rule-loader.js';
import { normalizeToEcs } from '../../src/shared/ecs-normalizer.js';

const require_ = createRequire(import.meta.url);
const logger = require_('../../src/main/logger.js');

const FIXTURES = path.resolve(__dirname, '../fixtures/sequences');
const ACCEPTED_DIR = path.join(FIXTURES, 'accepted');
const REJECTED_DIR = path.join(FIXTURES, 'rejected');
const WARNING_DIR = path.join(FIXTURES, 'warning');

/** @type {import('vitest').MockInstance} */
let warnSpy;

beforeEach(() => {
  warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  // The createRequire instance is shared by every suite in this worker; an unrestored spy
  // would leak into whichever file runs next (ai-mistakes #26).
  vi.restoreAllMocks();
});

/** @param {string} dir @param {string} file @returns {string} */
function read(dir, file) {
  return fs.readFileSync(path.join(dir, file), 'utf8');
}

/** js-yaml appends a source excerpt to a parse error; the first line is the whole assertion. */
const firstLine = (/** @type {string} */ text) => text.split('\n')[0];

/** @returns {string[]} the reason code of every line the loader logged, in order. */
const reasonsLogged = () => warnSpy.mock.calls.map((c) => c[2].reason);

/** @returns {string[]} the first line of every message the loader logged, in order. */
const messagesLogged = () => warnSpy.mock.calls.map((c) => firstLine(c[1]));

/**
 * Compiles one selection by wrapping it in the smallest file the loader accepts, so a matcher
 * test exercises the real load path rather than a private compile helper.
 * @param {string} category
 * @param {string[]} selectionLines - YAML lines of the selection body, unindented.
 * @returns {(doc: Record<string, unknown>) => boolean}
 */
function compileStep(category, selectionLines) {
  const text = [
    'title: Step under test',
    'name: step_under_test',
    'logsource:',
    '  product: aegis',
    `  category: ${category}`,
    'detection:',
    '  selection:',
    ...selectionLines.map((l) => `    ${l}`),
    '  condition: selection',
    '---',
    'title: Tail step',
    'name: tail_step',
    'logsource:',
    '  product: aegis',
    '  category: process',
    'detection:',
    '  selection:',
    '    event.action: agent-exit',
    '  condition: selection',
    '---',
    'title: Matcher probe',
    'id: SEQ900',
    'correlation:',
    '  type: temporal_ordered',
    '  rules:',
    '    - step_under_test',
    '    - tail_step',
    '  group-by:',
    '    - process.entity_id',
    '  timespan: 5m',
  ].join('\n');
  const out = loader.loadFromString(text, 'matcher-probe.yaml');
  expect(out.loadErrors).toBe(0);
  return out.rules[0].steps[0].matcher;
}

describe('sequence-rule-loader — accepted format', () => {
  for (const file of ['canonical.yaml', 'canonical.yml']) {
    it(`accepts the canonical example in ${path.extname(file)}`, () => {
      const out = loader.loadFromString(read(ACCEPTED_DIR, file), file);

      expect(out.loadErrors).toBe(0);
      expect(out.rules).toHaveLength(1);
      const rule = out.rules[0];
      expect(rule.id).toBe('SEQ001');
      expect(rule.title).toBe('Credential file read followed by outbound connection');
      expect(rule.level).toBe('high');
      expect(rule.timespanMs).toBe(5 * 60 * 1000);
      expect(rule.steps.map((s) => s.name)).toEqual(['cred_file_read', 'outbound_conn']);
      expect(rule.steps.map((s) => s.category)).toEqual(['file', 'network']);
      for (const step of rule.steps) expect(typeof step.matcher).toBe('function');
    });
  }

  it('reads both extensions from a directory', () => {
    const out = loader.loadDir(ACCEPTED_DIR);
    // Both files carry the SAME canonical rule, and both load: duplicate detection is WITHIN a
    // file, which is the bound the module header states. This pins it rather than implying it.
    expect(out.rules.map((r) => r.id)).toEqual(['SEQ001', 'SEQ001']);
    expect(out.loadErrors).toBe(0);
  });

  it('defaults level to medium when the correlation omits it', () => {
    const out = loader.loadFromString(
      read(WARNING_DIR, 'adjacent-file-steps.yaml'),
      'adjacent-file-steps.yaml',
    );
    expect(out.rules[0].level).toBe('medium');
  });

  it('converts every timespan unit to milliseconds', () => {
    const cases = [
      ['1s', 1000],
      ['90m', 90 * 60 * 1000],
      ['2h', 2 * 3600 * 1000],
      ['1d', 24 * 3600 * 1000],
    ];
    for (const [written, ms] of cases) {
      const text = read(ACCEPTED_DIR, 'canonical.yaml').replace(
        'timespan: 5m',
        `timespan: ${written}`,
      );
      const out = loader.loadFromString(text, 'canonical.yaml');
      expect(out.loadErrors).toBe(0);
      expect(out.rules[0].timespanMs).toBe(ms);
    }
  });

  it('an unreadable directory is not the same statement as an absent one', () => {
    const out = loader.loadDir(path.join(FIXTURES, 'no-such-directory'));
    expect(out).toEqual({ rules: [], warnings: [], loadErrors: 0 });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('the default directory is rules/sequences', () => {
    expect(loader.DEFAULT_SEQUENCES_DIR.split(path.sep).slice(-2)).toEqual(['rules', 'sequences']);
  });

  it('a path that exists but is not a directory is a counted read error', () => {
    // ENOTDIR from the real syscall, not an injected one: `existsSync` says yes and
    // `readdirSync` refuses, which is exactly the shape a stray file at rules/sequences takes.
    const notADir = path.join(ACCEPTED_DIR, 'canonical.yaml');
    const out = loader.loadDir(notADir);

    expect(out.rules).toEqual([]);
    expect(out.loadErrors).toBe(1);
    expect(reasonsLogged()).toEqual(['file-read']);
    expect(messagesLogged()[0]).toContain(`${notADir}: directory unreadable — `);
  });

  it('one unreadable entry is counted and the rest of the directory still loads', () => {
    // EISDIR: a directory named `*.yaml` passes the extension filter and then refuses to be read
    // as a file. The point of the case is the `continue` — a bad entry must not cost the good
    // ones, and the counter must still say something was lost.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-seq-'));
    try {
      fs.mkdirSync(path.join(tmp, 'unreadable.yaml'));
      fs.copyFileSync(path.join(ACCEPTED_DIR, 'canonical.yaml'), path.join(tmp, 'zz-good.yaml'));

      const out = loader.loadDir(tmp);

      expect(out.rules.map((r) => r.id)).toEqual(['SEQ001']);
      expect(out.warnings.map((w) => w.reason)).toEqual(['nullable-entity-id-steps']);
      expect(out.loadErrors).toBe(1);
      expect(reasonsLogged()).toEqual(['file-read', 'nullable-entity-id-steps']);
      expect(messagesLogged()[0]).toContain('unreadable.yaml: unreadable — ');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('sequence-rule-loader — rejection matrix', () => {
  /**
   * One row per rejection reason. The message is the FIRST LINE of what the loader logged —
   * every message is one line except `yaml-parse`, where js-yaml appends its own excerpt.
   * @type {Array<[string, string, string]>}
   */
  const ROWS = [
    [
      'unsupported-correlation-type.yaml',
      'unsupported-correlation-type',
      'unsupported-correlation-type.yaml: correlation type "event_count" is not supported — temporal_ordered is the only accepted type',
    ],
    [
      'unsupported-group-by.yaml',
      'unsupported-group-by',
      'unsupported-group-by.yaml: correlation "SEQ001" must group by exactly [process.entity_id]',
    ],
    [
      'aliases-not-supported.yaml',
      'aliases-not-supported',
      'aliases-not-supported.yaml: correlation "SEQ001" uses aliases, not supported',
    ],
    [
      'condition-in-correlation.yaml',
      'condition-in-correlation',
      'condition-in-correlation.yaml: correlation "SEQ001" holds a condition, not supported inside a correlation',
    ],
    [
      'generate-not-supported.yaml',
      'generate-not-supported',
      'generate-not-supported.yaml: correlation "SEQ001" uses generate, not supported',
    ],
    [
      'correlation-chain.yaml',
      'correlation-chain',
      'correlation-chain.yaml: correlation "SEQ002" references correlation "SEQ001" — a correlation of correlations is not supported',
    ],
    [
      'unresolved-rule-reference.yaml',
      'unresolved-rule-reference',
      'unresolved-rule-reference.yaml: correlation "SEQ001" references "missing_step", which resolves to no base document in this file',
    ],
    [
      'rule-count-out-of-range.yaml',
      'rule-count-out-of-range',
      'rule-count-out-of-range.yaml: correlation "SEQ001" lists 1 step(s) — a temporal_ordered rule needs 2 to 5',
    ],
    [
      'unknown-field.yaml',
      'unknown-field',
      'unknown-field.yaml: field "file.hash" is not an ECS field AEGIS produces — see docs/ECS-MAPPING.md',
    ],
    [
      'unsupported-modifier.yaml',
      'unsupported-modifier',
      'unsupported-modifier.yaml: modifier "|all" on "file.path" is not supported — accepted: contains, startswith, endswith, re, re|i',
    ],
    [
      'invalid-regex.yaml',
      'invalid-regex',
      'invalid-regex.yaml: field "process.working_directory|re" holds an invalid regular expression ("[") — Invalid regular expression: /[/: Unterminated character class',
    ],
    [
      'unmodified-wildcard.yaml',
      'unmodified-wildcard',
      'unmodified-wildcard.yaml: field "process.working_directory" holds a wildcard in an unmodified value ("C:\\Users\\*") — use |contains or |re',
    ],
    [
      'invalid-timespan-grammar.yaml',
      'invalid-timespan',
      'invalid-timespan-grammar.yaml: timespan "5x" does not match ^[0-9]+[smhd]$',
    ],
    [
      'invalid-timespan-bounds.yaml',
      'invalid-timespan',
      'invalid-timespan-bounds.yaml: timespan "48h" is outside the bounds 1s to 24h',
    ],
    [
      'unreferenced-base-document.yaml',
      'unreferenced-base-document',
      'unreferenced-base-document.yaml: base document "orphan_step" is referenced by no correlation in this file',
    ],
    [
      'duplicate-name.yaml',
      'duplicate-identifier',
      'duplicate-name.yaml: duplicate name "outbound_conn"',
    ],
    ['duplicate-id.yaml', 'duplicate-identifier', 'duplicate-id.yaml: duplicate id "SEQ001"'],
    [
      'unsatisfiable-field.yaml',
      'unsatisfiable-selection',
      'unsatisfiable-field.yaml: field "destination.ip" is never produced by logsource category "file"',
    ],
    [
      'unsatisfiable-action.yaml',
      'unsatisfiable-selection',
      'unsatisfiable-action.yaml: event.action value "network-connection" is never produced by logsource category "file"',
    ],
    [
      'entity-id-in-selection.yaml',
      'entity-id-in-selection',
      'entity-id-in-selection.yaml: field "process.entity_id" is forbidden in a selection — it is reserved for group-by',
    ],
    [
      'step-without-entity-id.yaml',
      'step-without-entity-id',
      'step-without-entity-id.yaml: step can only match events without process.entity_id; a temporal_ordered rule grouped by process.entity_id can never fire',
    ],
    [
      'invalid-document.yaml',
      'invalid-document',
      'invalid-document.yaml: base document "Cred File Read" needs a name matching ^[a-z0-9_]+$',
    ],
    [
      'yaml-parse.yaml',
      'yaml-parse',
      'yaml-parse.yaml: YAML parse failed — bad indentation of a mapping entry (5:12)',
    ],
  ];

  for (const [file, reason, message] of ROWS) {
    it(`${file} → ${reason}, and the file contributes no rule`, () => {
      const out = loader.loadFromString(read(REJECTED_DIR, file), file);

      expect(out.rules).toEqual([]);
      expect(out.warnings).toEqual([]);
      expect(out.loadErrors).toBe(1);
      expect(reasonsLogged()).toEqual([reason]);
      expect(messagesLogged()).toEqual([message]);
      expect(warnSpy.mock.calls[0][0]).toBe('sequence-loader');
    });
  }

  it('every rejection fixture on disk owns a row in the table', () => {
    const onDisk = fs.readdirSync(REJECTED_DIR).sort();
    expect(ROWS.map(([file]) => file).sort()).toEqual(onDisk);
  });

  it('a rejected directory contributes nothing and counts every reason', () => {
    const out = loader.loadDir(REJECTED_DIR);
    expect(out.rules).toEqual([]);
    expect(out.warnings).toEqual([]);
    // Derived, never restated: one reason per fixture, and the fixture count comes off the tree.
    expect(out.loadErrors).toBe(fs.readdirSync(REJECTED_DIR).length);
  });

  it('names the meta of a step-scoped reason and of a rule-scoped one', () => {
    loader.loadFromString(read(REJECTED_DIR, 'unknown-field.yaml'), 'unknown-field.yaml');
    expect(warnSpy.mock.calls[0][2]).toEqual({
      rule: null,
      step: 'cred_file_read',
      reason: 'unknown-field',
    });

    warnSpy.mockClear();
    loader.loadFromString(
      read(REJECTED_DIR, 'unsupported-group-by.yaml'),
      'unsupported-group-by.yaml',
    );
    expect(warnSpy.mock.calls[0][2]).toEqual({
      rule: 'SEQ001',
      step: null,
      reason: 'unsupported-group-by',
    });
  });
});

describe('sequence-rule-loader — the shape validator, message by message', () => {
  // `invalid-document` is ONE reason carrying many messages, and a reason is only as good as
  // the branch that produces it. Every branch of the shape validator is listed here, because a
  // must-match list is the entire protected set and not a sample of it (ai-mistakes #30). These
  // stay inline rather than becoming 17 more fixtures: the fixture directory holds one file per
  // REASON, which is the contract the rejection table above reads.
  const HEAD = [
    'title: Head step',
    'name: head_step',
    'logsource:',
    '  product: aegis',
    '  category: file',
    'detection:',
    '  selection:',
    '    file.path: /tmp/x',
    '  condition: selection',
  ].join('\n');

  const TAIL = [
    'title: Tail step',
    'name: tail_step',
    'logsource:',
    '  product: aegis',
    '  category: process',
    'detection:',
    '  selection:',
    '    event.action: agent-exit',
    '  condition: selection',
  ].join('\n');

  const CORR = [
    'title: Probe',
    'id: SEQ001',
    'correlation:',
    '  type: temporal_ordered',
    '  rules:',
    '    - head_step',
    '    - tail_step',
    '  group-by:',
    '    - process.entity_id',
    '  timespan: 5m',
  ].join('\n');

  /**
   * @param {{head?: string, corr?: string, extra?: string[]}} [parts]
   * @returns {string}
   */
  const build = (parts = {}) =>
    [parts.head ?? HEAD, TAIL, parts.corr ?? CORR, ...(parts.extra ?? [])].join('\n---\n');

  /** @type {Array<[string, string, string]>} */
  const SHAPE_ROWS = [
    [
      'a base document with a key outside the accepted five',
      build({ head: HEAD + '\nlevel: high' }),
      'shape.yaml: base document "head_step" holds unknown key "level"',
    ],
    [
      'a base title that is not a string',
      build({ head: HEAD.replace('title: Head step', 'title: 42') }),
      'shape.yaml: base document "head_step" has a non-string title',
    ],
    [
      'a base id that is not a string',
      build({ head: HEAD + '\nid: 7' }),
      'shape.yaml: base document "head_step" has a non-string id',
    ],
    [
      'a logsource category outside file|network|process',
      build({ head: HEAD.replace('  category: file', '  category: registry') }),
      'shape.yaml: base document "head_step" needs logsource product: aegis plus category: file|network|process',
    ],
    [
      'a detection that is not a mapping',
      build({ head: HEAD.replace(/detection:[\s\S]*$/, 'detection: 7') }),
      'shape.yaml: base document "head_step" has no detection',
    ],
    [
      'a condition that does not name the selection',
      build({ head: HEAD.replace('  condition: selection', '  condition: other') }),
      'shape.yaml: base document "head_step" needs exactly one named selection and a condition equal to that name',
    ],
    [
      'a selection that is not a non-empty map',
      build({ head: HEAD.replace('  selection:\n    file.path: /tmp/x', '  selection: []') }),
      'shape.yaml: base document "head_step" has a selection that is not a non-empty map of fields',
    ],
    [
      'a field value that is neither a scalar nor a list of them',
      build({ head: HEAD.replace('    file.path: /tmp/x', '    file.path:\n      nested: 1') }),
      'shape.yaml: field "file.path" must hold a scalar or a non-empty list of scalars',
    ],
    [
      'a correlation with a key outside the accepted six',
      build({ corr: CORR + '\nfoo: bar' }),
      'shape.yaml: correlation "SEQ001" holds unknown key "foo"',
    ],
    [
      'a correlation with no id at all',
      build({ corr: CORR.replace('id: SEQ001\n', '') }),
      'shape.yaml: correlation #3 needs an id matching ^SEQ[0-9]{3}$',
    ],
    [
      'a correlation with no title',
      build({ corr: CORR.replace('title: Probe\n', '') }),
      'shape.yaml: correlation "SEQ001" needs a title',
    ],
    [
      'a correlation status that is not a string',
      build({ corr: CORR + '\nstatus: 7' }),
      'shape.yaml: correlation "SEQ001" has a non-string status',
    ],
    [
      'a level outside the five',
      build({ corr: CORR + '\nlevel: urgent' }),
      'shape.yaml: correlation "SEQ001" has level "urgent" outside informational|low|medium|high|critical',
    ],
    [
      'a correlation whose body is empty',
      build({ corr: CORR.replace(/correlation:[\s\S]*$/, 'correlation:') }),
      'shape.yaml: correlation "SEQ001" has no correlation body',
    ],
    [
      'a correlation body key that is not type/rules/group-by/timespan',
      build({ corr: CORR.replace('  timespan: 5m', '  timespan: 5m\n  foo: bar') }),
      'shape.yaml: correlation "SEQ001" holds unknown correlation key "foo"',
    ],
    [
      'a rules value that is not a list of names',
      build({ corr: CORR.replace('  rules:\n    - head_step\n    - tail_step', '  rules: 7') }),
      'shape.yaml: correlation "SEQ001" needs a rules list of names',
    ],
    [
      'a base document with no name at all',
      build({ head: HEAD.replace('name: head_step\n', '') }),
      'shape.yaml: base document #1 needs a name matching ^[a-z0-9_]+$',
    ],
    [
      'a document that is not a mapping at all',
      build({ extra: ['just a scalar'] }),
      'shape.yaml: document #4 is not a mapping',
    ],
  ];

  for (const [label, text, message] of SHAPE_ROWS) {
    it(`rejects ${label}`, () => {
      const out = loader.loadFromString(text, 'shape.yaml');

      expect(out.rules).toEqual([]);
      expect(out.loadErrors).toBe(1);
      expect(reasonsLogged()).toEqual(['invalid-document']);
      expect(messagesLogged()).toEqual([message]);
    });
  }

  it('refuses the unattributed step only where it can PROVE the step is empty', () => {
    // Unmodified and alone: provably no entity id, so the file is rejected — that row is in
    // the matrix above. The two cases here are the ones the loader must NOT refuse, because
    // neither one says the step matches nothing else (ai-mistakes #27).
    const beside = build({
      head: HEAD.replace(
        '    file.path: /tmp/x',
        '    aegis.attribution.status:\n      - unattributed\n      - confirmed',
      ),
    });
    const modified = build({
      head: HEAD.replace(
        '    file.path: /tmp/x',
        '    aegis.attribution.status|contains: unattributed',
      ),
    });

    for (const text of [beside, modified]) {
      warnSpy.mockClear();
      const out = loader.loadFromString(text, 'shape.yaml');
      expect(out.loadErrors).toBe(0);
      expect(out.rules.map((r) => r.id)).toEqual(['SEQ001']);
    }
  });

  it('an EMPTY document is skipped in silence — a blank --- is not a defect', () => {
    const out = loader.loadFromString(build({ extra: ['', '   '] }), 'shape.yaml');

    expect(out.loadErrors).toBe(0);
    expect(out.rules.map((r) => r.id)).toEqual(['SEQ001']);
  });
});

describe('sequence-rule-loader — warnings, which are not rejections', () => {
  it('warns on two adjacent steps that resolve to the same file document', () => {
    const out = loader.loadFromString(
      read(WARNING_DIR, 'adjacent-file-steps.yaml'),
      'adjacent-file-steps.yaml',
    );

    expect(out.loadErrors).toBe(0);
    expect(out.rules).toHaveLength(1);
    expect(out.warnings.map((w) => w.reason)).toEqual([
      'adjacent-duplicate-step',
      'nullable-entity-id-steps',
    ]);
    expect(out.warnings[0].message).toBe(
      'adjacent-file-steps.yaml: steps 1 and 2 are both "cred_file_read"; dedupFileEvent suppresses a repeat of instanceId|file for 30s, so this rule fires only on two different paths',
    );
    expect(out.warnings[0]).toMatchObject({ rule: 'SEQ002', step: 'cred_file_read' });
  });

  it('warns once per rule that carries a file or network step', () => {
    const out = loader.loadFromString(read(ACCEPTED_DIR, 'canonical.yaml'), 'canonical.yaml');

    expect(out.warnings.map((w) => w.reason)).toEqual(['nullable-entity-id-steps']);
    expect(out.warnings[0].message).toBe(
      'canonical.yaml: steps "cred_file_read", "outbound_conn" are over file or network, where process.entity_id is nullable — unattributed events on those steps are skipped and counted',
    );
    expect(out.warnings[0]).toMatchObject({ rule: 'SEQ001', step: null });
  });

  it('a rule whose steps are all over process carries no nullable-key warning', () => {
    const text = [
      'title: Agent enters',
      'name: agent_in',
      'logsource:',
      '  product: aegis',
      '  category: process',
      'detection:',
      '  selection:',
      '    event.action: agent-enter',
      '  condition: selection',
      '---',
      'title: Agent leaves',
      'name: agent_out',
      'logsource:',
      '  product: aegis',
      '  category: process',
      'detection:',
      '  selection:',
      '    event.action: agent-exit',
      '  condition: selection',
      '---',
      'title: A short-lived agent',
      'id: SEQ901',
      'correlation:',
      '  type: temporal_ordered',
      '  rules:',
      '    - agent_in',
      '    - agent_out',
      '  group-by:',
      '    - process.entity_id',
      '  timespan: 1m',
    ].join('\n');

    const out = loader.loadFromString(text, 'process-only.yaml');
    expect(out.loadErrors).toBe(0);
    expect(out.warnings).toEqual([]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('two adjacent NETWORK steps carry no adjacency warning — the dedup window is the file one', () => {
    const text = read(WARNING_DIR, 'adjacent-file-steps.yaml')
      .replace('  category: file', '  category: network')
      .replace(
        / {4}event\.action:\n(?: {6}- \S+\n)+ {4}file\.path\|re\|i: .*\n/,
        '    destination.port: 443\n',
      );

    const out = loader.loadFromString(text, 'adjacent-network.yaml');
    expect(out.loadErrors).toBe(0);
    expect(out.warnings.map((w) => w.reason)).toEqual(['nullable-entity-id-steps']);
  });
});

describe('sequence-rule-loader — compiled matchers', () => {
  it('an unmodified value is equality, case-folded', () => {
    const m = compileStep('file', ['file.path: /home/me/.env']);
    expect(m({ file: { path: '/home/me/.env' } })).toBe(true);
    expect(m({ file: { path: '/HOME/ME/.ENV' } })).toBe(true);
    expect(m({ file: { path: '/home/me/.envelope' } })).toBe(false);
  });

  it('|contains matches anywhere', () => {
    const m = compileStep('file', ['file.path|contains: credentials']);
    expect(m({ file: { path: 'C:\\aws\\CREDENTIALS.txt' } })).toBe(true);
    expect(m({ file: { path: 'C:\\aws\\config' } })).toBe(false);
  });

  it('|startswith anchors at the head', () => {
    const m = compileStep('file', ['file.path|startswith: C:\\Users']);
    expect(m({ file: { path: 'C:\\Users\\me\\notes.txt' } })).toBe(true);
    expect(m({ file: { path: 'D:\\Users\\me\\notes.txt' } })).toBe(false);
  });

  it('|endswith anchors at the tail', () => {
    const m = compileStep('file', ['file.path|endswith: .pem']);
    expect(m({ file: { path: '/etc/ssl/key.PEM' } })).toBe(true);
    expect(m({ file: { path: '/etc/ssl/key.pem.bak' } })).toBe(false);
  });

  it('|re is case-SENSITIVE and |re|i is not — the flag is pinned at compile time', () => {
    const sensitive = compileStep('file', ["file.path|re: 'cred[0-9]+'"]);
    const insensitive = compileStep('file', ["file.path|re|i: 'cred[0-9]+'"]);
    expect(sensitive({ file: { path: '/tmp/cred42' } })).toBe(true);
    expect(sensitive({ file: { path: '/tmp/CRED42' } })).toBe(false);
    expect(insensitive({ file: { path: '/tmp/CRED42' } })).toBe(true);
  });

  it('a compiled regex holds no lastIndex between events', () => {
    const m = compileStep('file', ["file.path|re: 'secret'"]);
    const doc = { file: { path: '/tmp/secret' } };
    expect([m(doc), m(doc), m(doc)]).toEqual([true, true, true]);
  });

  it('a list of values is OR', () => {
    const m = compileStep('file', ['event.action:', '  - file-created', '  - file-deleted']);
    expect(m({ event: { action: 'file-created' } })).toBe(true);
    expect(m({ event: { action: 'file-deleted' } })).toBe(true);
    expect(m({ event: { action: 'file-modified' } })).toBe(false);
  });

  it('a map of fields is AND', () => {
    const m = compileStep('network', [
      'destination.port: 443',
      'destination.domain: api.example.com',
    ]);
    expect(m({ destination: { port: 443, domain: 'api.example.com' } })).toBe(true);
    expect(m({ destination: { port: 443, domain: 'cdn.example.com' } })).toBe(false);
    expect(m({ destination: { port: 80, domain: 'api.example.com' } })).toBe(false);
  });

  it('an array in the DOCUMENT is containment — event.type is an ECS array', () => {
    const m = compileStep('file', ['event.type: creation']);
    expect(m({ event: { type: ['creation'] } })).toBe(true);
    expect(m({ event: { category: ['file'], type: ['change'] } })).toBe(false);
  });

  it('an absent field is false, and never a crash', () => {
    const m = compileStep('network', ['destination.ip: 203.0.113.7']);
    expect(m({})).toBe(false);
    expect(m({ destination: {} })).toBe(false);
    expect(m({ file: { path: '/tmp/x' } })).toBe(false);
    expect(m({ destination: 'not-an-object' })).toBe(false);
  });

  it('an absent field is never stringified into a match', () => {
    // The discriminating case for the `_isScalar` guard: a matcher that reached
    // `String(undefined)` would answer TRUE on a document that carries nothing at all, and every
    // assertion above would still be green. Each of the three value shapes stringifies to a
    // string a naive comparison would accept.
    const equality = compileStep('network', ["destination.domain: 'undefined'"]);
    const contains = compileStep('network', ["destination.domain|contains: 'undefin'"]);
    const regex = compileStep('network', ["destination.domain|re: 'undef'"]);

    for (const m of [equality, contains, regex]) expect(m({})).toBe(false);
    for (const m of [equality, contains, regex]) {
      expect(m({ destination: { domain: 'undefined' } })).toBe(true);
    }
  });

  it('a number in the YAML and a number in the document are the same value', () => {
    const m = compileStep('network', ['destination.port: 443']);
    expect(m({ destination: { port: 443 } })).toBe(true);
    expect(m({ destination: { port: 4433 } })).toBe(false);
  });

  it('matches the real projection of a real carrier, not a hand-built shape', () => {
    const out = loader.loadFromString(read(ACCEPTED_DIR, 'canonical.yaml'), 'canonical.yaml');
    const [fileStep, networkStep] = out.rules[0].steps;

    const fileDoc = normalizeToEcs({
      file: 'C:\\Users\\me\\.aws\\credentials',
      action: 'accessed',
      timestamp: 1_700_000_000_000,
      instanceId: '4242:1700000000000',
      pid: 4242,
      agent: 'Claude Code',
      attribution: { status: 'confirmed', evidence: ['os-file-handle'] },
    });
    expect(fileStep.matcher(fileDoc)).toBe(true);
    expect(networkStep.matcher(fileDoc)).toBe(false);

    const netDoc = normalizeToEcs({
      remoteIp: '203.0.113.7',
      remotePort: 443,
      domain: 'api.anthropic.com',
      instanceId: '4242:1700000000000',
      pid: 4242,
      agent: 'Claude Code',
    });
    expect(networkStep.matcher(netDoc)).toBe(true);
    expect(fileStep.matcher(netDoc)).toBe(false);

    // The same carrier with an ordinary path fails the credential step, so the regex is
    // doing the work rather than the category.
    const plainDoc = normalizeToEcs({
      file: 'C:\\Users\\me\\notes.md',
      action: 'accessed',
      timestamp: 1_700_000_000_000,
      instanceId: '4242:1700000000000',
    });
    expect(fileStep.matcher(plainDoc)).toBe(false);
  });
});
