import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { dump } from 'js-yaml';
import ruleLoader from '../../src/main/rule-loader.js';

// The loader calls the CommonJS export, not the ESM interop wrapper.
const logger = require('../../src/main/logger.js');
const SCHEMA = path.resolve(__dirname, '../../rules/_schema.json');

function rule(id, overrides = {}) {
  return {
    id,
    name: `Fixture ${id}`,
    pattern: `${id}$`,
    reason: 'Disposable fixture',
    category: 'secrets',
    ...overrides,
  };
}

function document(rules) {
  return { version: 1, category: 'secrets', description: 'Disposable fixture', rules };
}

describe('rule-loader — YAML failure boundaries (#73)', () => {
  let directory;
  let warnings;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-yaml-cases-'));
    fs.copyFileSync(SCHEMA, path.join(directory, '_schema.json'));
    warnings = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    // Every rejection case must leave this unrelated, valid file usable.
    write('control.yaml', document([rule('TS900')]));
  });

  afterEach(() => {
    if (directory) {
      ruleLoader.reloadRules(path.join(directory, 'absent'));
      fs.rmSync(directory, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  function write(name, contents) {
    fs.writeFileSync(
      path.join(directory, name),
      typeof contents === 'string' ? contents : dump(contents),
      'utf8',
    );
  }

  function expectRejected(message) {
    const loaded = ruleLoader.reloadRules(directory);
    expect([...loaded.keys()]).toEqual(['TS900']);
    expect(ruleLoader.getRulesByCategory('secrets', directory).map((r) => r.id)).toEqual(['TS900']);
    expect(warnings).toHaveBeenCalledWith(
      'rule-loader',
      message,
      expect.objectContaining({ file: 'bad.yaml' }),
    );
  }

  it.each([
    ['invalid indentation', 'rules:\n  - id: TS001\n   name: misplaced\n'],
    ['unterminated sequence', 'rules: [\n'],
  ])('rejects %s without losing a valid sibling', (_label, source) => {
    write('bad.yaml', source);
    expectRejected('Failed to parse');
  });

  it.each([
    ['zero-byte file', ''],
    ['comment-only file', '# No rules here\n'],
    ['empty YAML document', '---\n'],
  ])('rejects a %s', (_label, source) => {
    write('bad.yaml', source);
    // Blank input may fail in the YAML parser; an explicit null document reaches
    // schema validation. Both must warn and leave the valid sibling available.
    expectRejected(expect.any(String));
  });

  it.each(['version', 'category', 'description', 'rules'])(
    'rejects a document missing required field %s',
    (field) => {
      const source = document([rule('TS001')]);
      delete source[field];
      write('bad.yaml', source);
      expectRejected('Invalid ruleset');
    },
  );

  it.each(['id', 'name', 'pattern', 'reason', 'category'])(
    'rejects a document containing a rule without %s',
    (field) => {
      const incomplete = rule('TS001');
      delete incomplete[field];
      write('bad.yaml', document([incomplete]));
      expectRejected('Invalid ruleset');
    },
  );

  it('warns on a real duplicate, keeps the first rule and indexes only accepted rules', () => {
    write(
      'duplicates.yaml',
      document([
        rule('TS001', { name: 'First', pattern: 'first$', category: 'ssh' }),
        rule('TS001', { name: 'Replacement', pattern: 'replacement$', category: 'cloud' }),
        rule('TS002'),
      ]),
    );
    const loaded = ruleLoader.reloadRules(directory);
    expect([...loaded.keys()].sort()).toEqual(['TS001', 'TS002', 'TS900']);
    expect(loaded.get('TS001')).toMatchObject({ name: 'First', category: 'ssh' });
    expect(loaded.get('TS001').pattern.test('first')).toBe(true);
    expect(loaded.get('TS001').pattern.test('replacement')).toBe(false);
    expect(ruleLoader.getRulesByCategory('ssh', directory).map((r) => r.id)).toEqual(['TS001']);
    expect(ruleLoader.getRulesByCategory('cloud', directory)).toEqual([]);
    expect(warnings.mock.calls.filter((c) => c[1] === 'Duplicate rule ID — skipping')).toEqual([
      ['rule-loader', 'Duplicate rule ID — skipping', { ruleId: 'TS001', file: 'duplicates.yaml' }],
    ]);
  });

  it('rejects the whole schema-invalid document even when valid rules surround the bad one', () => {
    write('bad.yaml', document([rule('TS001'), rule('BADID'), rule('TS002')]));
    expectRejected('Invalid ruleset');
  });

  it('skips an invalid regex but preserves valid rules on both sides in the same document', () => {
    write('bad.yaml', document([rule('TS001'), rule('TS002', { pattern: '[' }), rule('TS003')]));
    const loaded = ruleLoader.reloadRules(directory);
    expect([...loaded.keys()].sort()).toEqual(['TS001', 'TS003', 'TS900']);
    expect(loaded.get('TS001').pattern.test('TS001')).toBe(true);
    expect(loaded.get('TS003').pattern.test('TS003')).toBe(true);
    expect(
      ruleLoader
        .getRulesByCategory('secrets', directory)
        .map((r) => r.id)
        .sort(),
    ).toEqual(['TS001', 'TS003', 'TS900']);
    expect(warnings).toHaveBeenCalledWith(
      'rule-loader',
      'Invalid pattern in rule',
      expect.objectContaining({ ruleId: 'TS002', file: 'bad.yaml' }),
    );
  });
});
