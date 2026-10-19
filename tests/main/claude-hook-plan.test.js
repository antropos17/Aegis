import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const { planInstall, planRemoval, CONTRACT } = require('../../src/main/claude-hook-plan');
const file = 'X:/explicit/settings.json';
const command = 'node "X:/selected/main.js" --action-policy-hook "X:/private/policy.json"';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const install = (text, overrides = {}) =>
  planInstall({
    configPath: file,
    configBytes: Buffer.from(text),
    command,
    contract: CONTRACT,
    timeoutSeconds: 5,
    ...overrides,
  });
const apply = (bytes, plan) => {
  let result = Buffer.from(bytes);
  for (const edit of [...plan.edits].reverse())
    result = Buffer.concat([
      result.subarray(0, edit.startByte),
      Buffer.from(edit.replacementUtf8),
      result.subarray(edit.endByte),
    ]);
  return result;
};
const remove = (bytes, manifest) =>
  planRemoval({ configPath: file, configBytes: bytes, manifest, manifestSha256: hash(manifest) });
const entry = { matcher: 'Bash', hooks: [{ type: 'command', command, timeout: 5 }] };

describe('explicit Claude hook configuration planner', () => {
  it.each(['{}', '{"hooks":{}}', '{"hooks":{"PreToolUse":[]}}'])(
    'adds only the selected command through reversible edits: %s',
    (before) => {
      const plan = install(before);
      expect(plan.ok).toBe(true);
      expect(plan.status).toBe('planned');
      const after = apply(Buffer.from(before), plan);
      expect(JSON.parse(after).hooks.PreToolUse).toEqual([entry]);
      expect(plan.beforeSha256).toBe(hash(Buffer.from(before)));
      expect(plan.afterSha256).toBe(hash(after));
      expect(plan.presence).toBe('Unknown');
      expect(plan.plannedPresence).toBe('Configured');
      expect(plan.requirements).toEqual([
        'owner-confirmed-exact-plan',
        'verified-private-backup',
        'revalidate-current-bytes',
        'verify-written-readback',
      ]);
      const rollback = remove(after, plan.manifest);
      expect(rollback.mode).toBe('exact-rollback');
      expect(apply(after, rollback).toString()).toBe(before);
    },
  );

  it.each(['\n', '\r\n'])(
    'preserves unrelated values, escaped strings and original %j bytes',
    (newline) => {
      const before = ` {${newline}  "secret": "hidden-credential",${newline}  "unicode": "é😀",${newline}  "hooks": { "Other": [true], "PreToolUse": [{"matcher":"Read","hooks":[]}] }${newline}}${newline}`;
      const plan = install(before);
      const after = apply(Buffer.from(before), plan);
      expect(
        after
          .subarray(0, plan.edits[0].startByte)
          .equals(Buffer.from(before).subarray(0, plan.edits[0].startByte)),
      ).toBe(true);
      const parsed = JSON.parse(after);
      expect(parsed.secret).toBe('hidden-credential');
      expect(parsed.unicode).toBe('é😀');
      expect(parsed.hooks.Other).toEqual([true]);
      expect(parsed.hooks.PreToolUse).toEqual([{ matcher: 'Read', hooks: [] }, entry]);
      expect(JSON.stringify(plan)).not.toContain('hidden-credential');
      expect(JSON.stringify(plan)).not.toContain('é😀');
      expect(after.toString().match(/\r?\n/g)).toEqual(before.match(/\r?\n/g));
      expect(apply(after, remove(after, plan.manifest)).toString()).toBe(before);
    },
  );

  it('reports exact fragments with UTF-8 byte offsets and UTF-16 line/column units', () => {
    const before = '{\r\n "é😀":0, "hooks":{"PreToolUse":[]}\r\n}';
    const plan = install(before);
    const offset = before.indexOf('[]') + 1;
    const fragment = plan.changedFragments[0];
    expect(fragment.file).toBe(file);
    expect(fragment.startByte).toBe(Buffer.byteLength(before.slice(0, offset)));
    expect(fragment.before.start).toEqual({ line: 2, column: offset - before.indexOf('\n') });
    expect(fragment.before.end).toEqual(fragment.before.start);
    expect(fragment.removed).toBe('');
    expect(fragment.inserted).toBe(JSON.stringify(entry));
    expect(fragment.contextOmitted).toBe(true);
    expect(fragment.after.end.column - fragment.after.start.column).toBe(fragment.inserted.length);
  });

  it('preserves escaped names and prototype-like settings without materializing them', () => {
    const before =
      '{"__proto__":{"private":"keep-me"},"constructor":null,"\\u0068ooks":{"PreToolUse":[]},"number":1.000e+02}';
    const plan = install(before);
    const after = apply(Buffer.from(before), plan).toString();
    expect(after).toContain('"__proto__":{"private":"keep-me"}');
    expect(after).toContain('"\\u0068ooks"');
    expect(after).toContain('"number":1.000e+02');
    expect(JSON.stringify(plan)).not.toContain('keep-me');
    expect(Object.prototype.private).toBeUndefined();
    expect(apply(Buffer.from(after), remove(Buffer.from(after), plan.manifest)).toString()).toBe(
      before,
    );
  });

  it('keeps exact changed fragments and hashes for a non-ASCII selected command', () => {
    const plan = install('{}', { command: 'owner-command "é😀"' });
    const after = apply(Buffer.from('{}'), plan);
    expect(plan.afterSha256).toBe(hash(after));
    expect(
      plan.changedFragments[0].after.end.column - plan.changedFragments[0].after.start.column,
    ).toBe(plan.edits[0].replacementUtf8.length);
    const rollback = remove(after, plan.manifest);
    expect(rollback.edits[0].endByte - rollback.edits[0].startByte).toBe(
      Buffer.byteLength(plan.edits[0].replacementUtf8),
    );
    expect(apply(after, rollback).toString()).toBe('{}');
  });

  it('preserves a pre-existing equal hook without manufacturing ownership', () => {
    const before = JSON.stringify({ privateValue: 'keep-private', hooks: { PreToolUse: [entry] } });
    const plan = install(before);
    expect(plan.status).toBe('configured');
    expect(plan.presence).toBe('Configured');
    expect(plan.edits).toEqual([]);
    expect(plan.changedFragments).toEqual([]);
    expect(plan.manifest).toBeUndefined();
    expect(plan.afterSha256).toBe(hash(Buffer.from(before)));
    expect(apply(Buffer.from(before), plan).toString()).toBe(before);
    expect(JSON.stringify(plan)).not.toContain('keep-private');
    const first = install('{}');
    const repeated = install(apply(Buffer.from('{}'), first).toString());
    expect(repeated.status).toBe('configured');
    expect(repeated.manifest).toBeUndefined();
  });

  describe.each(['equal before conflict', 'conflict before equal'])('%s', (order) => {
    it.each([
      ['matcher', { ...entry, matcher: 'Read' }],
      ['timeout', { matcher: 'Bash', hooks: [{ type: 'command', command, timeout: 4 }] }],
      ['extra field', { ...entry, extra: true }],
    ])('refuses an equal entry mixed with a conflicting %s', (_kind, conflict) => {
      const hooks = order === 'equal before conflict' ? [entry, conflict] : [conflict, entry];
      const before = Buffer.from(
        JSON.stringify({ privateValue: 'keep-private', hooks: { PreToolUse: hooks } }),
      );
      const original = Buffer.from(before);
      const plan = install('', { configBytes: before });
      expect(plan).toEqual({ ok: false, reason: 'SELECTED_COMMAND_CONFLICT' });
      expect(before.equals(original)).toBe(true);
      expect(JSON.stringify(plan)).not.toContain('keep-private');
    });
  });

  it.each(['\n', '\r'])(
    'uses literal coordinates for two targeted-removal edits with %j breaks',
    (newline) => {
      const initial = '{"hooks":{"PreToolUse":[{"matcher":"Read","hooks":[]}]}}';
      const insertion = install(initial, { command: 'c' });
      const current = [
        '{',
        '"other":1,',
        '"hooks":{"PreToolUse":[',
        '{"matcher":"Read","hooks":[]},',
        '{"matcher":"Bash","hooks":[{"type":"command","command":"c","timeout":5}]},',
        '{"matcher":"Last","hooks":[]}',
        ']}',
        '}',
      ].join(newline);
      const removal = remove(Buffer.from(current), insertion.manifest);
      expect(removal.mode).toBe('targeted-removal');
      expect(removal.edits).toEqual([
        { startByte: 66, endByte: 67, replacementUtf8: '' },
        { startByte: 68, endByte: 141, replacementUtf8: '' },
      ]);
      expect(
        removal.changedFragments.map(({ before, after, removed, inserted }) => ({
          before,
          after,
          removed,
          inserted,
        })),
      ).toEqual([
        {
          before: { start: { line: 4, column: 30 }, end: { line: 4, column: 31 } },
          after: { start: { line: 4, column: 30 }, end: { line: 4, column: 30 } },
          removed: ',',
          inserted: '',
        },
        {
          before: { start: { line: 5, column: 1 }, end: { line: 5, column: 74 } },
          after: { start: { line: 5, column: 1 }, end: { line: 5, column: 1 } },
          removed: '{"matcher":"Bash","hooks":[{"type":"command","command":"c","timeout":5}]}',
          inserted: '',
        },
      ]);
      expect(apply(Buffer.from(current), removal).toString()).toBe(
        [
          '{',
          '"other":1,',
          '"hooks":{"PreToolUse":[',
          '{"matcher":"Read","hooks":[]}',
          ',',
          '{"matcher":"Last","hooks":[]}',
          ']}',
          '}',
        ].join(newline),
      );
    },
  );

  it.each([
    ['{"hooks":{},"hooks":{}}', 'DUPLICATE_KEY'],
    ['{"x":{"a":1,"\\u0061":2}}', 'DUPLICATE_KEY'],
    ['{"hooks":null}', 'UNSUPPORTED_STRUCTURE'],
    ['{"hooks":{"PreToolUse":{}}}', 'UNSUPPORTED_STRUCTURE'],
    ['[]', 'UNSUPPORTED_STRUCTURE'],
    ['{"x":1,}', 'INVALID_JSON'],
    ['{"x":01}', 'INVALID_JSON'],
    ['{"x":"bad\nstring"}', 'INVALID_JSON'],
    ['{"x":1} trailing', 'INVALID_JSON'],
    ['/* comment */{}', 'INVALID_JSON'],
    ['\ufeff{}', 'INVALID_JSON'],
  ])('refuses unsupported or ambiguous input without source diagnostics: %s', (before, reason) => {
    expect(install(before)).toEqual({ ok: false, reason });
  });

  it('bounds bytes, nesting, nodes and UTF-8 decoding', () => {
    expect(install(' '.repeat(262145))).toEqual({ ok: false, reason: 'CONFIG_TOO_LARGE' });
    expect(install('{"x":'.repeat(35) + '0' + '}'.repeat(35))).toEqual({
      ok: false,
      reason: 'CONFIG_COMPLEXITY',
    });
    expect(install('{"x":[' + '0,'.repeat(20001) + '0]}')).toEqual({
      ok: false,
      reason: 'CONFIG_COMPLEXITY',
    });
    expect(install('{}', { configBytes: Buffer.from([0xc0, 0xaf]) })).toEqual({
      ok: false,
      reason: 'INVALID_ENCODING',
    });
  });

  it('rejects accessors without invoking them, including inherited options', () => {
    let calls = 0;
    const options = {
      configPath: file,
      configBytes: Buffer.from('{}'),
      command,
      contract: CONTRACT,
      timeoutSeconds: 5,
    };
    Object.defineProperty(options, 'command', {
      get() {
        calls++;
        throw Error('private-details');
      },
    });
    expect(planInstall(options)).toEqual({ ok: false, reason: 'INVALID_OPTIONS' });
    expect(calls).toBe(0);
    expect(planInstall(Object.create(options))).toEqual({ ok: false, reason: 'INVALID_OPTIONS' });
    expect(install('{}', { unknown: 'private-details' })).toEqual({
      ok: false,
      reason: 'INVALID_OPTIONS',
    });
  });

  it('does not invoke custom Buffer getters or inspect hostile exception messages', () => {
    let calls = 0;
    const bytes = Buffer.from('{}');
    for (const key of ['length', 'copy', 'valueOf', Symbol.toPrimitive])
      Object.defineProperty(bytes, key, {
        get() {
          calls++;
          throw Error('private-details');
        },
      });
    expect(install('{}', { configBytes: bytes }).ok).toBe(true);
    const thrown = Object.defineProperty(new Error(), 'message', {
      get() {
        calls++;
        throw Error('private-details');
      },
    });
    const options = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw thrown;
        },
      },
    );
    expect(planInstall(options)).toEqual({ ok: false, reason: 'INVALID_OPTIONS' });
    expect(calls).toBe(0);
  });

  it.each([
    { command: 'x\nsecret' },
    { command: '' },
    { command: 'x'.repeat(4097) },
    { contract: 'other' },
    { timeoutSeconds: 1 },
    { timeoutSeconds: 61 },
    { timeoutSeconds: 2.1 },
    { configPath: 'relative.json' },
    { configPath: 'X:/private\nfile' },
    { configPath: 'X:/invalid\ud800.json' },
  ])('rejects invalid selected contracts and bounds: %j', (options) => {
    expect(install('{}', options).ok).toBe(false);
  });

  it('preserves the selected shell command literally without qualifying its safety', () => {
    const selected = 'explicit-owner-command "$HOME" && odd-command';
    const plan = install('{}', { command: selected });
    expect(JSON.parse(apply(Buffer.from('{}'), plan)).hooks.PreToolUse[0].hooks[0].command).toBe(
      selected,
    );
    expect(plan.commandQualification).toBe('owner-selected-unqualified');
  });

  it('refuses to duplicate a command already configured with different or additional fields', () => {
    for (const changed of [
      { matcher: 'Bash', hooks: [{ type: 'command', command, timeout: 4 }] },
      { matcher: 'Bash', hooks: [{ type: 'command', command, timeout: 5, async: true }] },
      { matcher: 'Read', hooks: [{ type: 'command', command, timeout: 5 }] },
      { ...entry, extra: true },
    ])
      expect(install(JSON.stringify({ hooks: { PreToolUse: [changed] } }))).toEqual({
        ok: false,
        reason: 'SELECTED_COMMAND_CONFLICT',
      });
  });

  it.each([0, 1, 2])(
    'targeted removal preserves concurrent unrelated values and all other hooks at index %i',
    (index) => {
      const before = JSON.stringify({
        secret: 'before-private',
        hooks: {
          PreToolUse: Array.from({ length: index }, (_, i) => ({
            matcher: `Other${i}`,
            hooks: [],
          })),
        },
      });
      const plan = install(before);
      const after = JSON.parse(apply(Buffer.from(before), plan));
      after.secret = 'concurrent-private';
      after.hooks.PreToolUse.push({ matcher: 'Last', hooks: [] });
      const current = Buffer.from(JSON.stringify(after));
      const removal = remove(current, plan.manifest);
      expect(removal.ok).toBe(true);
      expect(removal.mode).toBe('targeted-removal');
      const final = JSON.parse(apply(current, removal));
      expect(final.secret).toBe('concurrent-private');
      expect(final.hooks.PreToolUse).toEqual([
        ...after.hooks.PreToolUse.slice(0, index),
        { matcher: 'Last', hooks: [] },
      ]);
      expect(JSON.stringify(removal)).not.toContain('concurrent-private');
      expect(JSON.stringify(removal)).not.toContain('before-private');
    },
  );

  it('removes a sole owned entry after concurrent changes while retaining created containers', () => {
    const plan = install('{}');
    const after = apply(Buffer.from('{}'), plan).toString().replace('{', '{"other":1,');
    const removal = remove(Buffer.from(after), plan.manifest);
    expect(removal.mode).toBe('targeted-removal');
    expect(JSON.parse(apply(Buffer.from(after), removal))).toEqual({
      other: 1,
      hooks: { PreToolUse: [] },
    });
  });

  it('refuses ambiguous, changed, reformatted or absent owned entries', () => {
    const plan = install('{}');
    const after = JSON.parse(apply(Buffer.from('{}'), plan));
    after.hooks.PreToolUse.push(entry);
    expect(remove(Buffer.from(JSON.stringify(after)), plan.manifest)).toEqual({
      ok: false,
      reason: 'AMBIGUOUS_OWNERSHIP',
    });
    after.hooks.PreToolUse = [{ ...entry, matcher: 'Other' }];
    expect(remove(Buffer.from(JSON.stringify(after)), plan.manifest)).toEqual({
      ok: false,
      reason: 'OWNED_ENTRY_CHANGED',
    });
    expect(
      remove(
        Buffer.from(JSON.stringify({ hooks: { PreToolUse: [entry] } }, null, 2)),
        plan.manifest,
      ),
    ).toEqual({ ok: false, reason: 'OWNED_ENTRY_CHANGED' });
    expect(remove(Buffer.from('{}'), plan.manifest)).toEqual({
      ok: false,
      reason: 'OWNED_ENTRY_CHANGED',
    });
  });

  it('refuses changed ownership position or an additional occurrence of the selected command', () => {
    const plan = install('{}');
    const after = JSON.parse(apply(Buffer.from('{}'), plan));
    after.hooks.PreToolUse.unshift({ matcher: 'Other', hooks: [] });
    expect(remove(Buffer.from(JSON.stringify(after)), plan.manifest)).toEqual({
      ok: false,
      reason: 'OWNED_ENTRY_CHANGED',
    });
    after.hooks.PreToolUse.shift();
    after.hooks.PreToolUse.push({
      matcher: 'Other',
      hooks: [{ type: 'command', command, timeout: 5 }],
    });
    expect(remove(Buffer.from(JSON.stringify(after)), plan.manifest)).toEqual({
      ok: false,
      reason: 'AMBIGUOUS_OWNERSHIP',
    });
  });

  it('binds rollback to the path, exact installed bytes and internally consistent manifest', () => {
    const plan = install('{}');
    const after = apply(Buffer.from('{}'), plan);
    expect(
      planRemoval({
        configPath: 'X:/different.json',
        configBytes: after,
        manifest: plan.manifest,
        manifestSha256: plan.manifestSha256,
      }),
    ).toEqual({ ok: false, reason: 'MANIFEST_MISMATCH' });
    expect(
      planRemoval({
        configPath: file,
        configBytes: after,
        manifest: plan.manifest,
        manifestSha256: '0'.repeat(64),
      }),
    ).toEqual({ ok: false, reason: 'MANIFEST_MISMATCH' });
    for (const field of ['beforeSha256', 'entrySha256']) {
      const manifest = JSON.parse(plan.manifest);
      manifest[field] = '0'.repeat(64);
      expect(remove(after, JSON.stringify(manifest)).ok).toBe(false);
    }
    expect(remove(after, '{"version":1,"version":1}')).toEqual({
      ok: false,
      reason: 'INVALID_MANIFEST',
    });
    expect(remove(after, '{}')).toEqual({ ok: false, reason: 'INVALID_MANIFEST' });
    expect(remove(after, 'x'.repeat(16385))).toEqual({ ok: false, reason: 'INVALID_MANIFEST' });
  });
});
