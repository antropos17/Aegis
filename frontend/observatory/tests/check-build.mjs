import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { chromium } from 'playwright';

const repo = process.cwd();
const roots = {
  '/preview/': resolve(repo, 'dist/frontend-preview'),
  '/desktop/': resolve(repo, 'dist/renderer'),
};
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    const prefix = Object.keys(roots).find((prefix) => url.pathname.startsWith(prefix));
    if (!prefix) {
      res.writeHead(404).end();
      return;
    }
    const root = roots[prefix];
    const path = resolve(
      root,
      decodeURIComponent(url.pathname.slice(prefix.length)) || 'index.html',
    );
    if (!path.startsWith(root + sep)) {
      res.writeHead(403).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream' });
    res.end(await readFile(path));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const out = process.env.FRONTEND_QA_DIR || resolve(repo, 'dist/frontend-qa');
await mkdir(out, { recursive: true });
const errors = [];
try {
  for (const file of await readdir(resolve(roots['/desktop/'], 'assets'))) {
    if (!file.endsWith('.js')) continue;
    const js = await readFile(resolve(roots['/desktop/'], 'assets', file), 'utf8');
    assert(!js.includes('demo:observatory:'), 'desktop includes preview identities');
    assert(!js.includes('service-0.example.test'), 'desktop includes fixture endpoints');
    assert(!js.includes('PendingIntegration'), 'desktop still includes pending gate');
  }
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    window.bridgeCalls = 0;
    window.aegis = new Proxy(
      {},
      {
        get: () => () => {
          window.bridgeCalls++;
          throw new Error('Preview touched real IPC');
        },
      },
    );
  });
  await page.goto(base + '/preview/');
  await page.getByRole('heading', { name: 'Agent radar', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Select Claude Code, PID 10000', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.bridgeCalls), 0);
  const views = [
    'Monitoring',
    'Agents',
    'Events',
    'Network',
    'Rules & permissions',
    'Agent catalog',
    'AI analysis',
    'Reports',
    'Audit',
    'Statistics',
    'Settings',
  ];
  for (const size of [
    { width: 1200, height: 800 },
    { width: 1050, height: 700 },
    { width: 900, height: 600 },
  ]) {
    await page.setViewportSize(size);
    for (const scale of [1, 1.5]) {
      await page.evaluate(
        (scale) => document.documentElement.style.setProperty('--ui-scale', String(scale)),
        scale,
      );
      for (const theme of ['dark', 'light']) {
        await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme);
        await page.emulateMedia({ reducedMotion: scale === 1.5 ? 'reduce' : 'no-preference' });
        for (const view of views) {
          await page
            .getByRole('navigation', { name: 'Main navigation' })
            .getByRole('button', { name: view, exact: true })
            .click();
          await page.getByRole('heading', { name: view, exact: true, level: 1 }).waitFor();
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth + 2,
          );
          assert.equal(
            overflow,
            false,
            `document overflow: ${view} ${size.width} ${scale} ${theme}`,
          );
        }
      }
    }
  }
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--ui-scale', '1');
    document.documentElement.dataset.theme = 'dark';
  });
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'Monitoring', exact: true })
    .click();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const frameIntervals = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const samples = [];
        let previous = 0;
        function sample(at) {
          if (previous) samples.push(at - previous);
          previous = at;
          if (samples.length === 90) resolve(samples);
          else requestAnimationFrame(sample);
        }
        requestAnimationFrame(sample);
      }),
  );
  const sortedFrames = [...frameIntervals].sort((a, b) => a - b);
  await writeFile(
    resolve(out, 'frames.json'),
    JSON.stringify(
      {
        scope:
          'Headless preview, four fixture agents, Monitoring, 1200x800; not a whole-app performance guarantee',
        samples: frameIntervals.length,
        medianMs: sortedFrames[45],
        p95Ms: sortedFrames[85],
        maxMs: sortedFrames.at(-1),
      },
      null,
      2,
    ),
  );
  await page.screenshot({ path: resolve(out, 'monitoring.png') });
  await page.getByRole('button', { name: 'Select Claude Code, PID 10000', exact: true }).click();
  await page.getByRole('button', { name: 'Open instance details', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  await page.screenshot({ path: resolve(out, 'instance.png') });
  assert.equal(await page.locator('button button, button a').count(), 0);
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => window.bridgeCalls), 0);
  await page.close();
  const desktop = await browser.newPage();
  desktop.on('pageerror', (e) => errors.push(e.message));
  await desktop.goto(base + '/desktop/');
  await desktop.getByText('Desktop bridge unavailable.', { exact: false }).waitFor();
  assert.equal(await desktop.locator('.radar-point').count(), 0);
  await desktop.close();
  assert.deepEqual(errors, [], 'browser runtime errors');
  console.log(
    'Shared Svelte preview: 132 viewport/theme/scale view checks; isolated bridge; dialog; desktop unavailable state; production fixture exclusion passed.',
  );
} finally {
  await browser.close();
  server.close();
}
