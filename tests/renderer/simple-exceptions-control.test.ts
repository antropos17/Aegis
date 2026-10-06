import { expect, it, vi } from 'vitest';
import {
  changeExactException,
  exactExceptionTarget,
  readExactException,
} from '../../frontend/observatory/runtime/false-positive-control';
import { matchesFalsePositive } from '../../src/shared/false-positive-match.js';
import type { Host } from '../../frontend/observatory/runtime/host';
import type { FalsePositiveEntry } from '../../src/shared/types';

const target = { agentName: 'Claude', file: 'C:/work/.env', pattern: '^C:/work/\\.env$' };
it('simple-exceptions: serializes concurrent same-file saves without appending duplicate exceptions', async () => {
  let saved: FalsePositiveEntry[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const add = vi.fn(async (entry: FalsePositiveEntry) => {
    await gate;
    saved = [...saved, entry];
    return { success: true };
  });
  const host = {
    getFalsePositives: vi.fn(async () => saved.slice()),
    addFalsePositive: add,
  } as unknown as Host;
  const refresh = vi.fn(async () => {});
  const first = changeExactException(host, target, true, refresh);
  const second = changeExactException(host, target, true, refresh);
  await vi.waitFor(() => expect(add).toHaveBeenCalledTimes(1));
  release();
  expect(await first).toEqual({ muted: true, excluded: true });
  expect(await second).toEqual({ muted: true, excluded: true });
  expect(add).toHaveBeenCalledTimes(1);
});
it('simple-exceptions: queued undo reads the population after an overlapping different-file mute', async () => {
  const otherTarget = { agentName: 'Codex', file: 'C:/other/.env', pattern: '^C:/other/\\.env$' };
  let saved: FalsePositiveEntry[] = [
    { agentName: target.agentName, pattern: target.pattern, timestamp: 1 },
  ];
  const host = {
    getFalsePositives: vi.fn(async () => saved.slice()),
    addFalsePositive: vi.fn(async (entry: FalsePositiveEntry) => {
      saved.push(entry);
      return { success: true };
    }),
    saveSettings: vi.fn(async (patch: { falsePositivePatterns: FalsePositiveEntry[] }) => {
      saved = patch.falsePositivePatterns;
      return { success: true };
    }),
  } as unknown as Host;
  await Promise.all([
    changeExactException(host, otherTarget, true, async () => {}),
    changeExactException(host, target, false, async () => {}),
  ]);
  expect(saved).toEqual([
    expect.objectContaining({ agentName: 'Codex', pattern: otherTarget.pattern }),
  ]);
});
it('simple-exceptions: rejected scoring refresh cannot claim final success after a confirmed save', async () => {
  let saved: FalsePositiveEntry[] = [];
  const host = {
    getFalsePositives: vi.fn(async () => saved.slice()),
    addFalsePositive: vi.fn(async (entry: FalsePositiveEntry) => {
      saved = [entry];
      return { success: true };
    }),
  } as unknown as Host;
  await expect(
    changeExactException(host, target, true, async () => {
      throw new Error('refresh denied');
    }),
  ).rejects.toThrow('could not be verified');
  expect(await readExactException(host, target)).toEqual({ muted: true, excluded: true });
  expect(host.addFalsePositive).toHaveBeenCalledTimes(1);
});
it('simple-exceptions: exact undo retains broader legacy patterns and reports their remaining effect', async () => {
  const broad = { agentName: 'Claude', pattern: '/work/', timestamp: 2 };
  let saved: FalsePositiveEntry[] = [
    { agentName: target.agentName, pattern: target.pattern, timestamp: 1 },
    broad,
  ];
  const host = {
    getFalsePositives: vi.fn(async () => saved.slice()),
    saveSettings: vi.fn(async (patch: { falsePositivePatterns: FalsePositiveEntry[] }) => {
      saved = patch.falsePositivePatterns;
      return { success: true };
    }),
  } as unknown as Host;
  expect(await changeExactException(host, target, false, async () => {})).toEqual({
    muted: false,
    excluded: true,
  });
  expect(saved).toEqual([broad]);
});
it('simple-exceptions: escapes the exact original Windows path without broadening case or separator matching', () => {
  const row = { agent: 'Claude', file: 'C:\\work\\a[1].env', attribution: { status: 'inferred' } };
  const selected = exactExceptionTarget(row)!;
  const entries = [{ agentName: selected.agentName, pattern: selected.pattern, timestamp: 1 }];
  expect(matchesFalsePositive(row, entries)).toBe(true);
  expect(matchesFalsePositive({ ...row, file: 'C:\\work\\a1.env' }, entries)).toBe(false);
  expect(matchesFalsePositive({ ...row, file: 'c:\\work\\a[1].env' }, entries)).toBe(false);
  expect(matchesFalsePositive({ ...row, file: 'C:/work/a[1].env' }, entries)).toBe(false);
});
it('simple-exceptions: skips invalid and oversized legacy patterns without mutating saved entries', () => {
  const entries = [
    { agentName: 'Claude', pattern: '[', timestamp: 1 },
    { agentName: 'Claude', pattern: 'x'.repeat(257), timestamp: 2 },
  ];
  const before = structuredClone(entries);
  expect(matchesFalsePositive({ agent: 'Claude', file: 'C:/work/.env' }, entries)).toBe(false);
  expect(entries).toEqual(before);
});

it('simple-exceptions: rejects legacy unattributed stamps for controls and saved matching', () => {
  const row = { agent: 'Claude', file: target.file, attribution: 'unattributed' };
  expect(exactExceptionTarget(row)).toBeNull();
  expect(
    matchesFalsePositive(row, [{ agentName: 'Claude', pattern: target.pattern, timestamp: 1 }]),
  ).toBe(false);
});
