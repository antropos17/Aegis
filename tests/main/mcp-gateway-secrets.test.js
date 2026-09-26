import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { captureSecretPolicy } = require('../../src/main/mcp-gateway-secrets');
const secret = 'synthetic-秘密/"🔐+';
const blocked = 'gateway-content-blocked';
let dir, filename, controller;
const guards = [];
const policy = (values = [secret]) => ({ schemaVersion: 1, values });
const write = (value) => fs.writeFile(filename, JSON.stringify(value));
const capture = async () => {
  const guard = await captureSecretPolicy(filename, controller.signal);
  guards.push(guard);
  return guard;
};

beforeEach(async () => {
  dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'aegis-secret-unit-')));
  filename = path.join(dir, 'policy.json');
  controller = new AbortController();
  await write(policy());
});
afterEach(async () => {
  guards.splice(0).forEach((guard) => guard.close());
  controller.abort();
  if (
    path.basename(dir).startsWith('aegis-secret-unit-') &&
    !(await fs.lstat(dir)).isSymbolicLink()
  )
    await fs.rm(dir, { recursive: true, force: true });
});

describe('explicit known-secret policy', () => {
  const bytes = Buffer.from(secret);
  const base64 = bytes.toString('base64');
  const url64 = base64.replace(/\+/g, '-').replace(/\//g, '_');
  const hex = bytes.toString('hex');
  it.each([
    ['literal', secret],
    ['base64 padded', base64],
    ['base64 unpadded', base64.replace(/=+$/, '')],
    ['base64url padded', url64],
    ['base64url unpadded', url64.replace(/=+$/, '')],
    ['hex lower', hex],
    ['hex upper', hex.toUpperCase()],
    ['URI component', encodeURIComponent(secret)],
    [
      'URI component lower escapes',
      encodeURIComponent(secret).replace(/%[0-9A-F]{2}/g, (v) => v.toLowerCase()),
    ],
    ['full percent lower', hex.replace(/../g, '%$&')],
    ['full percent upper', hex.replace(/../g, '%$&').toUpperCase()],
    ['JSON escaped', JSON.stringify(secret).slice(1, -1)],
  ])('blocks %s substrings in decoded values and keys', async (_, encoded) => {
    const guard = await capture();
    expect(() => guard.assertSafe({ nested: [{ payload: `prefix:${encoded}:suffix` }] })).toThrow(
      blocked,
    );
    expect(() => guard.assertSafe({ [`prefix:${encoded}:suffix`]: 'clean' })).toThrow(blocked);
  });

  it('blocks metadata and JSON-escaped wire input after decoding', async () => {
    const guard = await capture();
    expect(() => guard.assertSafe({ tools: [{ description: secret }] })).toThrow(blocked);
    const escaped = [...'synthetic-secret']
      .map((c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
      .join('');
    await write(policy(['synthetic-secret']));
    const other = await capture();
    expect(() => other.assertSafe(JSON.parse(`{"content":"${escaped}"}`))).toThrow(blocked);
  });

  it('allows bounded ordinary JSON without modifying it', async () => {
    const guard = await capture();
    const value = {
      tools: [{ description: 'ordinary metadata' }],
      result: [null, true, 4, 'clean'],
    };
    const before = JSON.stringify(value);
    expect(() => guard.assertSafe(value)).not.toThrow();
    expect(JSON.stringify(value)).toBe(before);
    await expect(guard.recheck()).resolves.toBeUndefined();
  });

  it.each([
    null,
    [],
    { schemaVersion: 2, values: [secret] },
    { schemaVersion: 1, values: [secret], extra: true },
    { values: [secret] },
    policy([]),
    policy([secret, secret]),
    policy(['short']),
    policy(['x'.repeat(257)]),
    policy(['a'.repeat(7) + '\n']),
    policy(['a'.repeat(7) + '\u007f']),
    policy(['a'.repeat(7) + '\ud800']),
    policy([42]),
    policy(Array.from({ length: 33 }, (_, i) => `synthetic-${i}`)),
    policy(Array.from({ length: 17 }, (_, i) => `${i}`.padEnd(256, 'a'))),
  ])('rejects an invalid policy without disclosing its data %#', async (value) => {
    await write(value);
    await expect(capture()).rejects.toThrow(new Error(blocked));
  });

  it('accepts UTF-8 byte boundaries, 32 entries and the 4096-byte aggregate', async () => {
    await write(policy(Array.from({ length: 32 }, (_, i) => `${i}`.padEnd(128, 'x'))));
    const guard = await capture();
    expect(() => guard.assertSafe('ordinary text')).not.toThrow();
    expect(() => guard.assertSafe('31'.padEnd(128, 'x'))).toThrow(blocked);
    await write(policy(['éééé', 'é'.repeat(128)]));
    await expect(capture()).resolves.toBeDefined();
    await write(policy(['é'.repeat(129)]));
    await expect(capture()).rejects.toThrow(blocked);
  });

  it('fails closed on unreadable, non-file, invalid UTF-8 and oversized sources', async () => {
    await fs.unlink(filename);
    await expect(capture()).rejects.toThrow(blocked);
    await expect(captureSecretPolicy(dir, controller.signal)).rejects.toThrow(blocked);
    await fs.writeFile(filename, Buffer.from([0xff]));
    await expect(capture()).rejects.toThrow(blocked);
    await fs.writeFile(filename, ' '.repeat(65537));
    await expect(capture()).rejects.toThrow(blocked);
    await expect(captureSecretPolicy('', controller.signal)).rejects.toThrow(blocked);
    await expect(captureSecretPolicy(null, controller.signal)).rejects.toThrow(blocked);
  });

  it('pins exact bytes and remains closed after a changed policy is restored', async () => {
    const guard = await capture();
    const original = await fs.readFile(filename);
    await fs.appendFile(filename, '\n');
    await expect(guard.recheck()).rejects.toThrow(blocked);
    await fs.writeFile(filename, original);
    await expect(guard.recheck()).rejects.toThrow(blocked);
    expect(() => guard.assertSafe('clean')).toThrow(blocked);
  });

  it('closes on missing policy, explicit close and owner abort', async () => {
    const guard = await capture();
    await fs.unlink(filename);
    await expect(guard.recheck()).rejects.toThrow(blocked);
    expect(() => guard.assertSafe('clean')).toThrow(blocked);
    await write(policy());
    const explicit = await capture();
    explicit.close();
    explicit.close();
    expect(() => explicit.assertSafe('clean')).toThrow(blocked);
    const aborted = await capture();
    controller.abort();
    await expect(aborted.recheck()).rejects.toThrow(blocked);
    expect(() => aborted.assertSafe('clean')).toThrow(blocked);
    await expect(capture()).rejects.toThrow(blocked);
  });

  it('rejects aborted capture while the private file read is pending', async () => {
    const pending = capture();
    controller.abort();
    await expect(pending).rejects.toThrow(blocked);
  });

  it('leaves the omitted-policy compatibility path disabled', async () => {
    const guard = await captureSecretPolicy(undefined, controller.signal);
    expect(() => guard.assertSafe(secret)).not.toThrow();
    await expect(guard.recheck()).resolves.toBeUndefined();
    guard.close();
  });

  it('enforces node, nesting and serialized UTF-8 budgets', async () => {
    const guard = await capture();
    expect(() => guard.assertSafe(Array(2047).fill(null))).not.toThrow();
    expect(() => guard.assertSafe(Array(2048).fill(null))).toThrow(blocked);
    let nested = 'clean';
    for (let i = 0; i < 8; i++) nested = { child: nested };
    expect(() => guard.assertSafe(nested)).not.toThrow();
    expect(() => guard.assertSafe({ child: nested })).toThrow(blocked);
    expect(() => guard.assertSafe('x'.repeat(65534))).not.toThrow();
    expect(() => guard.assertSafe('x'.repeat(65535))).toThrow(blocked);
    expect(() => guard.assertSafe('é'.repeat(32768))).toThrow(blocked);
    expect(() => guard.assertSafe('\n'.repeat(32768))).toThrow(blocked);
  });

  it('rejects non-JSON values without evaluating accessors or serializers', async () => {
    const guard = await capture();
    let invoked = false;
    const accessor = Object.defineProperty({}, 'content', {
      enumerable: true,
      get() {
        invoked = true;
        return secret;
      },
    });
    const serializer = {
      toJSON() {
        invoked = true;
        return secret;
      },
    };
    const cyclic = {};
    cyclic.self = cyclic;
    const hidden = Object.defineProperty({}, 'content', { value: secret });
    const sparse = new Array(2);
    for (const value of [
      undefined,
      NaN,
      Infinity,
      1n,
      () => {},
      Symbol('x'),
      new Date(),
      accessor,
      serializer,
      cyclic,
      hidden,
      sparse,
      { [Symbol('content')]: secret },
      '\ud800',
      { '\ud800': 'clean' },
    ])
      expect(() => guard.assertSafe(value)).toThrow(blocked);
    expect(invoked).toBe(false);
  });
});
