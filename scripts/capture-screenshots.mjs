/**
 * Capture the current Observatory with simulated data for public documentation.
 * Run: node scripts/capture-screenshots.mjs
 * @since v0.17.0-alpha
 */
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const captures = [
  { view: 'overview', heading: 'Monitoring', file: 'docs/screenshots/01-monitoring.png' },
  { view: 'agents', heading: 'Agents', file: 'docs/screenshots/02-agents.png' },
  { view: 'events', heading: 'Events', file: 'docs/screenshots/03-events.png' },
  {
    view: 'local-security',
    heading: 'Local security',
    file: 'docs/screenshots/04-local-security.png',
  },
  {
    view: 'action-control',
    heading: 'Action control',
    file: 'docs/screenshots/05-action-control.png',
  },
  { view: 'settings', heading: 'Settings', file: 'docs/screenshots/06-settings.png' },
  { view: 'guide', heading: 'Start here', file: 'docs/images/observatory-guide.png' },
];

const server = await createServer({
  configFile: join(root, 'vite.frontend.config.ts'),
  mode: 'preview',
  logLevel: 'error',
  server: { host: '127.0.0.1', port: 0, strictPort: false },
});
let browser;
try {
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === 'string') throw new Error('Preview port unavailable');
  const base = `http://127.0.0.1:${address.port}`;
  let launchError;
  for (const options of [{}, { channel: 'chrome' }, { channel: 'msedge' }]) {
    try {
      browser = await chromium.launch({ headless: true, ...options });
      break;
    } catch (error) {
      launchError = error;
    }
  }
  if (!browser) throw launchError;
  const page = await browser.newPage({
    viewport: { width: 1200, height: 800 },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
  });
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await mkdir(join(root, 'docs', 'screenshots'), { recursive: true });
  await mkdir(join(root, 'docs', 'images'), { recursive: true });
  for (const capture of captures) {
    await page.goto(`${base}/?view=${encodeURIComponent(capture.view)}`);
    await page.getByRole('heading', { level: 1, name: capture.heading }).waitFor();
    await page.waitForFunction(() => !document.documentElement.dataset.transitionSurface);
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await page.waitForTimeout(350);
    if (pageErrors.length) throw new Error(`Preview error: ${pageErrors.join('; ')}`);
    const dismiss = page.getByRole('button', { name: 'Dismiss notification', exact: true });
    for (let attempt = 0; attempt < 8 && (await dismiss.count()); attempt++)
      await dismiss.first().click();
    if (await dismiss.count()) throw new Error('Preview notifications did not clear');
    await page.screenshot({ path: join(root, capture.file), animations: 'disabled' });
    console.log(`Captured ${capture.file}`);
  }
  await page.setViewportSize({ width: 1280, height: 640 });
  await page.goto(pathToFileURL(join(root, 'docs', 'social-preview.html')).href);
  await page.waitForFunction(() =>
    [...document.images].every((image) => image.complete && image.naturalWidth > 0),
  );
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await page.screenshot({ path: join(root, 'docs', 'social-preview.png'), animations: 'disabled' });
  console.log('Captured docs/social-preview.png');
} finally {
  await browser?.close();
  await server.close();
}
