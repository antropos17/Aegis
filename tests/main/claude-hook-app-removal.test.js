import { expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const {
  planObservedRemoval,
  prepareObservedRemoval,
} = require('../../src/main/claude-hook-app-removal');
const { IO_CONTRACT } = require('../../src/main/claude-hook-writer');
const selection = {
  target: path.resolve('fixture/settings.json'),
  executable: process.execPath,
  appPath: path.resolve('fixture/app'),
  now: () => 100,
};
const slash = (value) => value.replaceAll('\\', '/');
const command = `"${slash(selection.executable)}" "${slash(selection.appPath)}" --action-policy-hook "${slash(path.resolve('fixture/policy.json'))}"`;
const entry = { matcher: 'Bash', hooks: [{ type: 'command', command, timeout: 5 }] };
const encoded = JSON.stringify(entry);
const foreign = '{"matcher":"Read","hooks":[{"type":"command","command":"unrelated"}]}';
const profile = (array) =>
  `{\r\n "private":"é😀", "hooks":{"PostToolUse":[],"PreToolUse":[${array}]},"tail": 7\r\n}\n`;

it.each([
  [encoded, ''],
  [encoded + ',' + foreign, foreign],
  [foreign + ',' + encoded, foreign],
  [foreign + ',' + encoded + ',' + foreign, foreign + ',' + foreign],
])(
  'removes only the selected entry while retaining every unrelated UTF-8 byte (%s)',
  (before, expected) => {
    const plan = planObservedRemoval(Buffer.from(profile(before)), selection);
    expect(plan.ok).toBe(true);
    expect(plan.after).toEqual(Buffer.from(profile(expected)));
    expect(plan.review.changedFragments.every((fragment) => fragment.contextOmitted === true)).toBe(
      true,
    );
    expect(plan.review.changedFragments.map((fragment) => fragment.removed).join('')).toContain(
      encoded,
    );
  },
);

it.each([
  [{ ...entry, matcher: 'Read' }, 'PLAN_REFUSED'],
  [{ ...entry, extra: true }, 'PLAN_REFUSED'],
  [{ ...entry, hooks: [{ ...entry.hooks[0], timeout: 6 }] }, 'PLAN_REFUSED'],
  [{ ...entry, hooks: [{ ...entry.hooks[0], type: 'prompt' }] }, 'PLAN_REFUSED'],
  [{ ...entry, hooks: [...entry.hooks, { type: 'command', command: 'other' }] }, 'PLAN_REFUSED'],
  [
    { ...entry, hooks: [{ ...entry.hooks[0], command: command + ' && other' }] },
    'NO_MATCHING_HOOK',
  ],
  [
    {
      ...entry,
      hooks: [
        { ...entry.hooks[0], command: command.replace('--action-policy-hook', '--different-hook') },
      ],
    },
    'NO_MATCHING_HOOK',
  ],
])('refuses changed or unrecognized entries without producing editable bytes', (changed, code) => {
  expect(planObservedRemoval(Buffer.from(profile(JSON.stringify(changed))), selection)).toEqual({
    code,
  });
});

it('refuses duplicate candidates and duplicate JSON keys', () => {
  expect(planObservedRemoval(Buffer.from(profile(encoded + ',' + encoded)), selection)).toEqual({
    code: 'AMBIGUOUS_HOOK',
  });
  expect(planObservedRemoval(Buffer.from('{"hooks":{},"hooks":{}}'), selection)).toEqual({
    code: 'PLAN_REFUSED',
  });
});

function fixture() {
  let current = Buffer.from(profile(encoded)),
    identity = 'original';
  const records = new Map();
  const io = {
    contract: IO_CONTRACT,
    readTarget: vi.fn(async () => ({ identity, bytes: Buffer.from(current) })),
    retainPrivate: vi.fn(async (record) => {
      const ref = {};
      records.set(ref, { bytes: Buffer.from(record.bytes), manifest: record.manifest });
      return ref;
    }),
    readPrivate: vi.fn(async (ref) => {
      const record = records.get(ref);
      return { bytes: Buffer.from(record.bytes), manifest: record.manifest };
    }),
    compareAndWrite: vi.fn(async ({ beforeBytes, afterBytes }) => {
      if (!current.equals(beforeBytes)) return 'stale';
      current = Buffer.from(afterBytes);
      return 'written';
    }),
  };
  return {
    io,
    records,
    current: () => current,
    change: () => {
      current = Buffer.from(profile(encoded).replace('"tail": 7', '"tail": 8'));
    },
    replace: () => {
      identity = 'replacement';
    },
  };
}

it('uses only a fresh verified backup and a one-shot private confirmation capability', async () => {
  const state = fixture();
  const prepared = await prepareObservedRemoval(state.io, selection);
  expect(state.io.retainPrivate).not.toHaveBeenCalled();
  expect(await prepared.confirm(true)).toEqual({ code: 'OBSERVED_REMOVED' });
  expect(state.current()).toEqual(Buffer.from(profile('')));
  expect(state.records.size).toBe(1);
  expect(state.io.readPrivate.mock.calls[0][0]).toBe([...state.records.keys()][0]);
  expect(await prepared.confirm(true)).toEqual({ code: 'INVALID_APPROVAL' });
  expect(state.io.compareAndWrite).toHaveBeenCalledOnce();
});

it.each(['cancel', 'expiry', 'changed', 'identity', 'backup'])(
  'refuses %s before any write',
  async (mode) => {
    const state = fixture();
    let now = 100;
    const prepared = await prepareObservedRemoval(state.io, { ...selection, now: () => now });
    const expected = {
      cancel: 'INVALID_APPROVAL',
      expiry: 'EXPIRED',
      changed: 'TARGET_CHANGED',
      identity: 'TARGET_IDENTITY_CHANGED',
      backup: 'BACKUP_TAMPERED',
    };
    if (mode === 'cancel') prepared.cancel();
    if (mode === 'expiry') now += 90000;
    if (mode === 'changed') state.change();
    if (mode === 'identity') state.replace();
    if (mode === 'backup')
      state.io.readPrivate.mockResolvedValue({ bytes: Buffer.from('different'), manifest: '{}' });
    expect(await prepared.confirm(true)).toEqual({ code: expected[mode] });
    expect(state.io.compareAndWrite).not.toHaveBeenCalled();
  },
);

it('does not let cancel interrupt an already dispatched confirmed transaction', async () => {
  const state = fixture();
  let release, entered;
  const blocked = new Promise((resolve) => {
    entered = resolve;
  });
  const actual = state.io.compareAndWrite.getMockImplementation();
  state.io.compareAndWrite.mockImplementation(async (value) => {
    entered();
    await new Promise((resolve) => {
      release = resolve;
    });
    return actual(value);
  });
  const prepared = await prepareObservedRemoval(state.io, selection);
  const applying = prepared.confirm(true);
  await blocked;
  prepared.cancel();
  release();
  expect(await applying).toEqual({ code: 'OBSERVED_REMOVED' });
  expect(state.current()).toEqual(Buffer.from(profile('')));
});

it.each(['throw', 'readback'])('retains uncertainty for %s after dispatch', async (mode) => {
  const state = fixture();
  if (mode === 'throw') state.io.compareAndWrite.mockRejectedValue(new Error('PRIVATE_FAILURE'));
  else state.io.compareAndWrite.mockImplementation(async () => 'written');
  const prepared = await prepareObservedRemoval(state.io, selection);
  expect(await prepared.confirm(true)).toEqual({
    code: mode === 'throw' ? 'WRITE_UNCERTAIN' : 'READBACK_FAILED',
  });
  expect(state.records.size).toBe(1);
});

const afterCommand = command.replace('--action-policy-hook', '--action-policy-after-hook');
const afterEntry = {
  matcher: 'Bash',
  hooks: [{ type: 'command', command: afterCommand, timeout: 5 }],
};
const fullProfile = (post = [afterEntry], failure = [afterEntry]) =>
  JSON.stringify({
    private: 'é😀',
    hooks: { PreToolUse: [entry], PostToolUse: post, PostToolUseFailure: failure },
    tail: 7,
  });

it('removes a complete three-event group and preserves unrelated exact bytes', () => {
  const before = fullProfile([JSON.parse(foreign), afterEntry], [afterEntry, JSON.parse(foreign)]);
  const plan = planObservedRemoval(Buffer.from(before), selection);
  expect(plan.mode).toBe('three-hook');
  expect(plan.review.eventNames).toEqual(['PreToolUse', 'PostToolUse', 'PostToolUseFailure']);
  expect(plan.after.toString()).toBe(
    fullProfile([JSON.parse(foreign)], [JSON.parse(foreign)]).replace(JSON.stringify(entry), ''),
  );
});

it.each([
  [[], [afterEntry]],
  [[afterEntry], []],
  [[afterEntry, afterEntry], [afterEntry]],
  [[{ ...afterEntry, hooks: [{ ...afterEntry.hooks[0], timeout: 6 }] }], [afterEntry]],
  [
    [
      {
        ...afterEntry,
        hooks: [
          { ...afterEntry.hooks[0], command: afterCommand.replace('policy.json', 'other.json') },
        ],
      },
    ],
    [afterEntry],
  ],
  [
    [{ ...afterEntry, hooks: [...afterEntry.hooks, { type: 'command', command: 'other' }] }],
    [afterEntry],
  ],
])('refuses an incomplete, duplicated or tampered after group', (post, failure) => {
  const plan = planObservedRemoval(Buffer.from(fullProfile(post, failure)), selection);
  expect(plan.ok).not.toBe(true);
  expect(plan.after).toBeUndefined();
});

it('refuses a group with after or before hooks installed in the wrong event', () => {
  const misplacedAfter = JSON.stringify({ hooks: { PreToolUse: [entry, afterEntry] } });
  const misplacedBefore = JSON.stringify({
    hooks: {
      PreToolUse: [entry],
      PostToolUse: [entry, afterEntry],
      PostToolUseFailure: [afterEntry],
    },
  });
  expect(planObservedRemoval(Buffer.from(misplacedAfter), selection)).toEqual({
    code: 'PLAN_REFUSED',
  });
  expect(planObservedRemoval(Buffer.from(misplacedBefore), selection)).toEqual({
    code: 'PLAN_REFUSED',
  });
});

it.each(['--action-policy-hook.json', '--action-policy-after-hook.json'])(
  'allows exact profile removal when the policy filename is %s',
  (filename) => {
    const {
      profileCommand,
      profileAfterCommand,
    } = require('../../src/main/claude-hook-app-profile');
    const policy = path.resolve('fixture', filename);
    const make = (value) => ({
      matcher: 'Bash',
      hooks: [{ type: 'command', command: value, timeout: 5 }],
    });
    const hooks = {
      PreToolUse: [make(profileCommand(selection.executable, selection.appPath, policy))],
      PostToolUse: [make(profileAfterCommand(selection.executable, selection.appPath, policy))],
      PostToolUseFailure: [
        make(profileAfterCommand(selection.executable, selection.appPath, policy)),
      ],
    };
    expect(planObservedRemoval(Buffer.from(JSON.stringify({ hooks })), selection).mode).toBe(
      'three-hook',
    );
  },
);

it('preserves an unrelated legacy post command containing a flag as ordinary text', () => {
  const hooks = {
    PreToolUse: [entry],
    PostToolUse: [
      { matcher: 'Read', hooks: [{ type: 'command', command: 'echo --action-policy-hook' }] },
    ],
  };
  const plan = planObservedRemoval(Buffer.from(JSON.stringify({ hooks })), selection);
  expect(plan.mode).toBe('legacy');
  expect(JSON.parse(plan.after).hooks.PostToolUse).toEqual(hooks.PostToolUse);
});

it.each([
  [afterCommand, afterCommand, true],
  [afterCommand + ' > /dev/null', afterCommand + ' > /dev/null', true],
  [afterCommand, afterCommand + ' > /dev/null', false],
  [afterCommand + ' > /dev/null', afterCommand, false],
  [afterCommand + ' > /dev/null 2>&1', afterCommand + ' > /dev/null 2>&1', false],
  [afterCommand + ' > /dev/null; echo x', afterCommand + ' > /dev/null; echo x', false],
])(
  'accepts only matching exact legacy or redirected post-hook commands',
  (post, failure, allowed) => {
    const make = (value) => ({
      matcher: 'Bash',
      hooks: [{ type: 'command', command: value, timeout: 5 }],
    });
    const plan = planObservedRemoval(
      Buffer.from(fullProfile([make(post)], [make(failure)])),
      selection,
    );
    expect(plan.ok === true).toBe(allowed);
  },
);
