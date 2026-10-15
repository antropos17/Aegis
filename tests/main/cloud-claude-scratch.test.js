import fs from 'node:fs';
import os from 'node:os';
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
  const state = { mode, disappeared: false, scans: 0 };
  const result = { scratchObservation: null };
  const io = {
    readdirSync() {
      state.scans++;
      if (state.mode === 'missing-root') {
        const error = new Error('private root');
        error.code = 'ENOENT';
        throw error;
      }
      return state.mode === 'entries'
        ? Array.from({ length: 257 }, (_, i) => `${i}.tmp`)
        : ['private-name.tmp'];
    },
    lstatSync() {
      if (
        ['vanishes-once', 'over-budget-after-vanish'].includes(state.mode) &&
        !state.disappeared
      ) {
        state.disappeared = true;
        const error = new Error('private vanished child');
        error.code = 'ENOENT';
        throw error;
      }
      if (['ENOENT', 'EACCES', 'private-error'].includes(state.mode)) {
        const error = new Error('private path and content must never enter a receipt');
        error.code = state.mode;
        throw error;
      }
      return {
        isSymbolicLink: () => state.mode === 'symlink',
        isDirectory: () => state.mode === 'depth',
        isFile: () => state.mode !== 'type',
        size: ['bytes', 'over-budget-after-vanish'].includes(state.mode)
          ? Number.MAX_SAFE_INTEGER
          : 1,
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
      retries: 0,
      recoveries: 0,
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
      'recoveries',
      'retries',
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
  it('finishes one immediate fresh observation after a child disappears', () => {
    const t = setup('vanishes-once');
    t.check();
    expect(t.state.scans).toBe(2);
    expect(t.result.scratchObservation).toMatchObject({
      reason: 'within-budget',
      retries: 1,
      recoveries: 1,
    });
    t.state.mode = 'ordinary';
    t.check();
    expect(t.result.scratchObservation).toMatchObject({ retries: 1, recoveries: 1 });
  });
  it('refuses repeated disappearance after exactly one rescan', () => {
    const t = setup('ENOENT');
    expect(t.check).toThrow('scratch-limit');
    expect(t.state.scans).toBe(2);
    expect(t.result.scratchObservation).toMatchObject({
      reason: 'unavailable',
      retries: 1,
      recoveries: 0,
    });
  });
  it.each(['missing-root', 'EACCES', 'bytes'])('never retries %s', (mode) => {
    const t = setup(mode);
    expect(t.check).toThrow('scratch-limit');
    expect(t.state.scans).toBe(1);
    expect(t.result.scratchObservation).toMatchObject({ retries: 0, recoveries: 0 });
  });
  it('still refuses an actual byte overrun after disappearance', () => {
    const t = setup('over-budget-after-vanish');
    expect(t.check).toThrow('scratch-limit');
    expect(t.result.scratchObservation).toMatchObject({
      reason: 'bytes',
      bytes: 16777217,
      retries: 1,
      recoveries: 0,
    });
  });
  it.each(['file', 'directory'])(
    'recovers from a real %s disappearing during traversal',
    (kind) => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-scratch-race-'));
      const leaf = path.join(root, 'ephemeral.tmp');
      const result = { scratchObservation: null };
      let removed = false;
      try {
        if (kind === 'directory') fs.mkdirSync(leaf);
        else fs.writeFileSync(leaf, 'fixed disposable bytes');
        const io = {
          ...fs,
          lstatSync(selected) {
            if (selected === leaf && !removed && kind === 'file') {
              fs.unlinkSync(leaf);
              removed = true;
            }
            return fs.lstatSync(selected);
          },
          readdirSync(selected) {
            if (selected === leaf && !removed && kind === 'directory') {
              fs.rmdirSync(leaf);
              removed = true;
            }
            return fs.readdirSync(selected);
          },
        };
        const context = vm.createContext({
          fs: io,
          path,
          p: { ROOT: root },
          result,
          refuse(code) {
            throw new Error(code);
          },
        });
        vm.runInContext(source.slice(begin, end) + '\nscratchBudget();', context);
        expect(removed).toBe(true);
        expect(result.scratchObservation).toEqual({
          reason: 'within-budget',
          entries: 0,
          bytes: 0,
          depth: 0,
          error: null,
          retries: 1,
          recoveries: 1,
        });
        expect(fs.readdirSync(root)).toEqual([]);
      } finally {
        expect(fs.lstatSync(root).isSymbolicLink()).toBe(false);
        if (fs.existsSync(leaf)) {
          if (kind === 'directory') fs.rmdirSync(leaf);
          else fs.unlinkSync(leaf);
        }
        fs.rmdirSync(root);
      }
    },
  );
});
