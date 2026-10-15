import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const file = fileURLToPath(new URL('../../scripts/qualification/claude-task.cjs', import.meta.url));
const source = fs.readFileSync(file, 'utf8');
const begin = source.indexOf('function scratchBudget() {');
const end = source.indexOf('\nfunction client(', begin);
if (begin < 0 || end <= begin) throw new Error('actual scratch observer unavailable');

function setup(mode = 'ordinary') {
  const state = { mode };
  const result = { scratchObservation: null };
  const io = {
    readdirSync() {
      return state.mode === 'entries'
        ? Array.from({ length: 257 }, (_, i) => `${i}.tmp`)
        : ['private-name.tmp'];
    },
    lstatSync() {
      if (['ENOENT', 'EACCES', 'private-error'].includes(state.mode)) {
        const error = new Error('private path and content must never enter a receipt');
        error.code = state.mode;
        throw error;
      }
      return {
        isSymbolicLink: () => state.mode === 'symlink',
        isDirectory: () => state.mode === 'depth',
        isFile: () => state.mode !== 'type',
        size: state.mode === 'bytes' ? Number.MAX_SAFE_INTEGER : 1,
      };
    },
  };
  const context = vm.createContext({
    fs: io,
    path,
    p: { ROOT: 'fixture-only' },
    result,
    refuse(code) {
      throw new Error(code);
    },
  });
  const check = vm.runInContext(source.slice(begin, end) + '\nscratchBudget;', context);
  return { state, result, check };
}

describe('actual fixed Claude scratch observer', () => {
  it('records a bounded successful observation', () => {
    const t = setup();
    t.check();
    expect(t.result.scratchObservation).toEqual({
      reason: 'within-budget',
      entries: 1,
      bytes: 1,
      depth: 0,
      error: null,
    });
  });
  it.each([
    ['bytes', { reason: 'bytes', bytes: 16777217 }],
    ['entries', { reason: 'entries', entries: 257 }],
    ['depth', { reason: 'depth', depth: 9 }],
    ['symlink', { reason: 'symlink' }],
    ['type', { reason: 'type' }],
    ['ENOENT', { reason: 'unavailable', error: 'ENOENT' }],
    ['EACCES', { reason: 'unavailable', error: 'EACCES' }],
    ['private-error', { reason: 'unavailable', error: 'other' }],
  ])('retains a precise refusal for %s without private text', (mode, expected) => {
    const t = setup(mode);
    expect(t.check).toThrow('scratch-limit');
    expect(t.result.scratchObservation).toMatchObject(expected);
    expect(Object.keys(t.result.scratchObservation).sort()).toEqual([
      'bytes',
      'depth',
      'entries',
      'error',
      'reason',
    ]);
    expect(JSON.stringify(t.result)).not.toMatch(/private|fixture-only/);
  });
  it('retains the first failure when a later observation would pass', () => {
    const t = setup('ENOENT');
    expect(t.check).toThrow('scratch-limit');
    const first = t.result.scratchObservation;
    t.state.mode = 'ordinary';
    expect(t.check).toThrow('scratch-limit');
    expect(t.result.scratchObservation).toBe(first);
  });
});
