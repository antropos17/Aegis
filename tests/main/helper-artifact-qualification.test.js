import fs from 'node:fs/promises';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { qualifyHelperArtifacts } from '../../scripts/qualification/qualify-helper-artifacts.mjs';
it('independently compares actual retained byte sentinels across accepted/rejected/interrupted and failed rollback cases', async () => {
  const value = await qualifyHelperArtifacts();
  expect(value.passed).toBe(true);
  expect(value.cases).toHaveLength(19);
  expect(value.cases.every((row) => row.retainedSentinels && row.stageClean)).toBe(true);
  expect(value.cases.find((row) => row.mode === 'failed-rollback')).toMatchObject({
    passed: true,
    publication: 'none',
  });
  expect(value.cases.find((row) => row.mode === 'source-snapshot')).toMatchObject({
    passed: true,
    publication: 'published',
  });
  expect(value.launchAllowed).toBe(false);
  expect(JSON.stringify(value)).not.toMatch(/INERT-|aegis-helper-artifacts-/);
});

it('reports uncertainty when cleanup fails after actual exclusive publication rather than asserting no artifact', async () => {
  const unlink = fs.unlink.bind(fs);
  let faulted = false;
  const spy = vi.spyOn(fs, 'unlink').mockImplementation(async (file) => {
    if (!faulted && path.basename(file).startsWith('.stage-')) {
      faulted = true;
      throw Object.assign(Error('fixture-stage-cleanup'), { code: 'EIO' });
    }
    return unlink(file);
  });
  try {
    const value = await qualifyHelperArtifacts();
    expect(faulted).toBe(true);
    expect(value.passed).toBe(false);
    expect(value.cases[0]).toMatchObject({
      publication: 'outcome-unknown',
      retainedSentinels: true,
    });
  } finally {
    spy.mockRestore();
  }
});
