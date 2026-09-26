import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright';
import { mkdtemp, writeFile, lstat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

// Run after build:renderer. Exercises the real main window with a disposable profile.
const repo = process.cwd();
const owned = await mkdtemp(join(tmpdir(), 'aegis-external-url-'));
const foreign = join(owned, 'foreign.html');
await writeFile(foreign, '<!doctype html><title>Foreign fixture</title>');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({
    args: [repo, '--user-data-dir=' + join(owned, 'profile')],
    env,
    timeout: 45000,
  });
  const page = await app.firstWindow();
  await page.getByRole('heading', { name: 'Monitoring', exact: true, level: 1 }).waitFor({
    timeout: 30000,
  });
  const appDocument = page.url();
  assert.equal(appDocument, pathToFileURL(resolve(repo, 'dist/renderer/index.html')).href);
  const invalid = await page.evaluate(() =>
    window.aegis.openExternalUrl({ url: 'https://example.com' }),
  );
  assert.equal(invalid.error, 'Invalid external URL', 'the real top-level IPC sender was denied');

  // The previous file:// prefix check allowed this harmless sibling fixture.
  await page.evaluate((url) => {
    window.location.href = url;
  }, pathToFileURL(foreign).href);
  await page.waitForTimeout(250);
  assert.equal(page.url(), appDocument, 'renderer navigated to a foreign local file');

  await page.evaluate(() => window.open('about:blank', '_blank'));
  await page.waitForTimeout(250);
  const windows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  assert.equal(windows, 1, 'renderer created a popup');
  assert.equal(page.url(), appDocument);
} finally {
  try {
    if (app) await app.close();
  } finally {
    const target = resolve(owned);
    const parent = resolve(tmpdir()) + sep;
    assert(target.startsWith(parent), 'cleanup target left the disposable temp root');
    assert.equal((await lstat(target)).isSymbolicLink(), false);
    await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
console.log('External URL native navigation and popup smoke passed; disposable profile removed.');
