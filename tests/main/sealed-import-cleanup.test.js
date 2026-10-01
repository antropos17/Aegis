import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSealedImportHarness } from '../fixtures/sealed-import/harness.mjs';

let scratch;
beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-sealed-cleanup-test-'));
  vi.stubEnv('AEGIS_SEALED_IMPORT_TEST_TMP', scratch);
  vi.stubEnv('AEGIS_SEALED_IMPORT_TEST_RECEIPT', '');
});
afterEach(async () => {
  vi.unstubAllEnvs();
  expect(path.dirname(scratch)).toBe(path.resolve(os.tmpdir()));
  await fs.promises.rm(scratch, { recursive: true, maxRetries: 20, retryDelay: 25 });
});

describe('sealed import disposable corpus lifetime', () => {
  it('removes only this harness corpora even without a receipt or compilation', async () => {
    const first = createSealedImportHarness();
    const second = createSealedImportHarness();
    const owned = first.corpus('owned');
    const unrelated = second.corpus('other-owner');
    fs.mkdirSync(path.join(owned.source, 'nested'));
    fs.writeFileSync(path.join(owned.source, 'nested', 'fixture.bin'), Buffer.alloc(4096));
    await first.finish();
    expect(fs.existsSync(owned.root)).toBe(false);
    expect(fs.readFileSync(path.join(unrelated.source, 'readme.txt'), 'utf8')).toBe(
      'DISPOSABLE_CLEAN_CORPUS\n',
    );
    await second.finish();
    expect(fs.existsSync(unrelated.root)).toBe(false);
  });

  it.skipIf(process.platform !== 'win32' || process.arch !== 'x64')(
    'preserves a native receipt and still cleans corpora if receipt creation fails',
    async () => {
      const destination = path.join(scratch, 'verification-receipt.json');
      vi.stubEnv('AEGIS_SEALED_IMPORT_TEST_RECEIPT', destination);
      const harness = createSealedImportHarness();
      harness.setup();
      const fixture = harness.corpus('native-receipt');
      expect(harness.run(fixture).status).toBe(0);
      await harness.finish();
      expect(fs.existsSync(fixture.root)).toBe(false);
      expect(
        fs.readdirSync(scratch).filter((name) => name.startsWith('aegis-sealed-build-')),
      ).toEqual([]);
      const preserved = fs.readFileSync(destination, 'utf8');
      expect(JSON.parse(preserved).nativeCases).toHaveLength(1);
      expect(JSON.parse(preserved).launchAllowed).toBe(false);

      const later = harness.corpus('receipt-collision');
      await expect(harness.finish()).rejects.toMatchObject({ code: 'EEXIST' });
      expect(fs.existsSync(later.root)).toBe(false);
      expect(fs.readFileSync(destination, 'utf8')).toBe(preserved);
    },
    40000,
  );
});
