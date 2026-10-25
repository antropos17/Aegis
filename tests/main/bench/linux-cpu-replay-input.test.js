import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { createBundle, cleanup, files } from './linux-cpu-replay-fixtures.js';
const require = createRequire(import.meta.url);
const { replayLinuxCpu } = require('../../../bench/lib/linux-cpu-replay');
const j = require('../../../bench/lib/resource-replay-json');
afterEach(cleanup);
describe('closed offline CPU input admission', () => {
  it.each(['getter', 'extra', 'array', 'prototype', 'symbol', 'nonenumerable'])(
    'refuses %s public options before IO',
    async (type) => {
      let getters = 0;
      const lstat = vi.spyOn(fs, 'lstatSync');
      let o = { input: 'private-input', out: 'private-output' };
      if (type === 'getter')
        Object.defineProperty(o, 'input', {
          get() {
            getters++;
            return 'private';
          },
          enumerable: true,
        });
      if (type === 'extra') o.extra = 'private';
      if (type === 'array') o = [];
      if (type === 'prototype') o = Object.assign(Object.create({ private: true }), o);
      if (type === 'symbol') o[Symbol('private')] = true;
      if (type === 'nonenumerable')
        Object.defineProperty(o, 'input', { value: 'private', enumerable: false });
      expect((await replayLinuxCpu(o)).exitCode).toBe(2);
      expect(getters).toBe(0);
      expect(lstat).not.toHaveBeenCalled();
    },
  );
  it.each(['same', 'inside', 'outside'])('refuses %s overlap before IO', async (type) => {
    const b = createBundle();
    const out =
      type === 'same' ? b.input : type === 'inside' ? path.join(b.input, 'nested') : b.base;
    const lstat = vi.spyOn(fs, 'lstatSync');
    expect((await replayLinuxCpu({ input: b.input, out })).exitCode).toBe(2);
    expect(lstat).not.toHaveBeenCalled();
  });
  it.each([
    ['duplicate', Buffer.from('{"version":1,"version":2}')],
    [
      'invalid UTF8',
      Buffer.concat([Buffer.from('{"x":"'), Buffer.from([0xff]), Buffer.from('"}')]),
    ],
    ['danger key', Buffer.from('{"__proto__":{"x":1}}')],
    ['nested constructor', Buffer.from('{"safe":{"constructor":0}}')],
    ['unsafe integer', Buffer.from('{"x":9007199254740992}')],
    ['numeric overflow', Buffer.from('{"x":1e400}')],
    ['too deep', Buffer.from('['.repeat(26) + '0' + ']'.repeat(26))],
    ['long string', Buffer.from(JSON.stringify({ x: 'x'.repeat(4097) }))],
  ])('refuses %s even with another artifact missing', async (_label, bytes) => {
    const b = createBundle();
    fs.writeFileSync(path.join(b.input, files[0]), bytes);
    fs.unlinkSync(path.join(b.input, files[2]));
    expect((await replayLinuxCpu({ input: b.input, out: b.out })).exitCode).toBe(4);
  });
  it('records every filename missing rather than creating historical evidence', async () => {
    const b = createBundle();
    for (const n of files) fs.unlinkSync(path.join(b.input, n));
    const r = await replayLinuxCpu({ input: b.input, out: b.out });
    expect(r.exitCode).toBe(3);
    expect(r.report.missing).toEqual(files);
    expect(r.report.runId).toBeNull();
    expect(fs.readdirSync(b.input)).toEqual([]);
  });
  it('retains source-independent raw byte digests and original bytes', async () => {
    const b = createBundle();
    const before = files.map((n) => fs.readFileSync(path.join(b.input, n)));
    const r = await replayLinuxCpu({ input: b.input, out: b.out });
    expect(r.exitCode).toBe(0);
    r.report.inputs.forEach((x, i) => {
      expect(x.sha256).toBe(j.hash(before[i]));
      expect(x.byteLength).toBe(before[i].length);
      expect(fs.readFileSync(path.join(b.input, x.file))).toEqual(before[i]);
    });
  });
  it('keeps decoded public data free of fixture paths/private values', async () => {
    const b = createBundle();
    const r = await replayLinuxCpu({ input: b.input, out: b.out });
    const strings = [];
    const visit = (v) => {
      if (typeof v === 'string') strings.push(v);
      else if (v && typeof v === 'object') Object.values(v).forEach(visit);
    };
    visit(r.report);
    for (const privateValue of [b.base, b.input, b.out])
      expect(strings.some((v) => v.includes(privateValue))).toBe(false);
    expect(r.report.originalFinalPublication).toBe('unknown');
  });
});
