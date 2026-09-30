import fs from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import { qualifyResultReview } from '../../scripts/qualification/qualify-result-review.mjs';

it('executes actual disposable publication and all refusal/collision/interruption byte oracles', async () => {
  const value = await qualifyResultReview();
  expect(value.passed).toBe(true);
  expect(value.cases).toHaveLength(11);
  expect(value.cases.every((entry) => entry.passed)).toBe(true);
  expect(value).toMatchObject({
    launchAllowed: false,
    projectExportAllowed: false,
    developerOnly: true,
  });
  expect(value.cases.find((entry) => entry.name === 'swapped-bytes')).toMatchObject({
    published: true,
    originalFilesUnchanged: true,
  });
  expect(value.cases.find((entry) => entry.name === 'original-conflict').published).toBe(false);
  expect(JSON.stringify(value)).not.toContain('aegis-result-review-');
  await expect(qualifyResultReview('../arbitrary')).rejects.toThrow('fixture-selector-invalid');
});

it('reports no publication after the actual exclusive final link fails', async () => {
  const failure = Object.assign(Error('fixture-final-link-failed'), { code: 'EIO' });
  const link = vi.spyOn(fs, 'link').mockRejectedValueOnce(failure);
  try {
    const value = await qualifyResultReview('selected');
    expect(link).toHaveBeenCalledOnce();
    expect(value.passed).toBe(false);
    expect(value.cases[0]).toMatchObject({
      published: false,
      originalFilesUnchanged: true,
    });
  } finally {
    link.mockRestore();
  }
});
