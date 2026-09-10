import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { checkPagination } from './pagination-check.mjs';
import { checkComfort } from './comfort-check.mjs';
import { checkClarity } from './clarity-check.mjs';
import { checkUsability } from './usability-check.mjs';
import { checkGraphs } from './graph-check.mjs';
import { checkDetails } from './detail-check.mjs';
import { checkMotion } from './motion-check.mjs';
import { checkResourceLayers } from './resource-layer-check.mjs';

const repo = process.cwd();
const designRoot = resolve(repo, 'frontend/observatory');
const reference = JSON.parse(await readFile(resolve(designRoot, 'reference/SOURCE.json'), 'utf8'));
for (const file of reference.files) {
  const source = (await readFile(resolve(designRoot, file.path), 'utf8')).replaceAll('\r\n', '\n');
  const hash = createHash('sha256').update(source).digest('hex');
  assert.equal(hash, file.sha256, 'approved template changed: ' + file.path);
}
const imports = [
  ...(await readFile(resolve(designRoot, 'styles.ts'), 'utf8')).matchAll(
    /import '\.\/(styles\/[^']+)'/g,
  ),
].map((match) => match[1]);
assert.deepEqual(
  imports,
  [
    ...reference.stylesheetOrder,
    'styles/radar-clarity.css',
    'styles/feedback.css',
    'styles/desktop.css',
    'styles/coherence.css',
    'styles/detail-layout.css',
    'styles/comfort.css',
  ],
  'approved cascade order',
);

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
  await page.getByRole('button', { name: /Select Claude Code, 1 processes/ }).waitFor();
  assert.equal(await page.evaluate(() => window.bridgeCalls), 0);
  // Measured from the reviewed dialogs-14 prototype at 1200x800. These checks
  // catch a functioning renderer that has silently replaced the approved layout.
  const geometry = await page.evaluate(() => {
    const rect = (selector) => {
      const r = document.querySelector(selector).getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    return {
      sidebar: rect('.sidebar'),
      topbar: rect('.topbar'),
      history: rect('.history-controls'),
      head: rect('.page-head'),
      summary: rect('.summary'),
      radar: rect('.radar-panel'),
    };
  });
  assert.equal(geometry.sidebar.width, 184, 'prototype sidebar density');
  assert(Math.abs(geometry.topbar.height - 46) <= 2, 'prototype toolbar height');
  assert.equal(await page.locator('.workspace-tabs').count(), 0, 'duplicate navigation returned');
  assert(
    geometry.summary.y >= geometry.head.y + geometry.head.height,
    'summary overlaps Monitoring heading',
  );
  assert.equal(await page.locator('.inspector').count(), 0, 'overview retained an empty inspector');
  assert.equal(await page.locator('.summary > .summary-stat').count(), 6);
  assert.equal(await page.locator('.radar-agent-card').count(), 4);
  const sweep = await page.locator('.dial-sweep').elementHandle();
  await page.getByRole('button', { name: /Select Claude Code, 1 processes/ }).click();
  await page.locator('.agent-workspace:visible').waitFor();
  assert.equal(await page.getByRole('dialog').count(), 0);
  await page
    .locator('.agent-context')
    .getByLabel('Selected agent', { exact: true })
    .selectOption('');
  await page.locator('.sidebar').getByRole('button', { name: 'Monitoring', exact: true }).click();
  await page.getByRole('button', { name: 'Files', exact: true }).click();
  await page.getByRole('button', { name: 'Radar', exact: true }).click();
  assert(
    await sweep.evaluate((node) => node === document.querySelector('.dial-sweep')),
    'layer switch recreates sweep',
  );
  await page
    .getByRole('button', { name: 'Clear radar selection', exact: true })
    .click({ position: { x: 10, y: 70 } });
  assert.equal(await page.locator('.radar-blip[aria-pressed="true"]').count(), 0);
  assert(
    await sweep.evaluate((node) => node === document.querySelector('.dial-sweep')),
    'clearing selection recreates sweep',
  );
  await writeFile(resolve(out, 'prototype-geometry.json'), JSON.stringify(geometry, null, 2));
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
      for (const theme of ['dark', 'light', 'dark-hc', 'light-hc']) {
        await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme);
        if (theme.endsWith('-hc')) {
          const contrast = await page.evaluate(() => {
            const style = getComputedStyle(document.documentElement);
            const luminance = (token) => {
              const hex = style.getPropertyValue(token).trim().replace('#', '');
              const channels = [0, 2, 4]
                .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
                .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4));
              return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
            };
            const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
            return {
              text: ratio(luminance('--muted'), luminance('--panel')),
              controls: ratio(luminance('--strong-border'), luminance('--bg')),
              background: style.getPropertyValue('--bg').trim(),
            };
          });
          assert(contrast.text >= 7, 'high contrast secondary text is below 7:1');
          assert(contrast.controls >= 3, 'high contrast controls are below 3:1');
          assert.equal(
            contrast.background,
            theme.startsWith('dark') ? '#171819' : '#f0f0ee',
            'high contrast replaced the template surfaces',
          );
        }
        await page.emulateMedia({ reducedMotion: scale === 1.5 ? 'reduce' : 'no-preference' });
        for (const view of views) {
          await page.locator('.sidebar').getByRole('button', { name: view, exact: true }).click();
          await page.getByRole('heading', { name: view, exact: true, level: 1 }).waitFor();
          await page.waitForFunction(() => !document.documentElement.dataset.transitionSurface);
          if (view === 'Monitoring') {
            const radar = await page.evaluate(() => {
              const rect = (n) => n.getBoundingClientRect();
              const points = [...document.querySelectorAll('.radar-blip')].map(rect);
              const stage = rect(document.querySelector('.radar-stage'));
              const overlaps = (a, b) =>
                a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
              const cards = [...document.querySelectorAll('.radar-agent-card')];
              return {
                collisions: points.some((p, i) => points.slice(i + 1).some((q) => overlaps(p, q))),
                clipped: points.some(
                  (p) =>
                    p.left < stage.left ||
                    p.right > stage.right ||
                    p.top < stage.top ||
                    p.bottom > stage.bottom,
                ),
                crowdedLogos: cards.some(
                  (card) =>
                    rect(card.querySelector('.agent-mark')).right >
                    rect(card.querySelector('.roster-identity')).left - 3,
                ),
                rosterCount: cards.length,
                markerCount: points.length,
                repeatedPanels: document.querySelectorAll('.radar-info, .radar-mini-chart').length,
              };
            });
            assert.equal(radar.collisions, false, `radar marker collision: ${size.width} ${scale}`);
            assert.equal(radar.clipped, false, `clipped radar marker: ${size.width} ${scale}`);
            assert.equal(
              radar.crowdedLogos,
              false,
              `roster logo overlaps name: ${size.width} ${scale}`,
            );
            assert.equal(radar.rosterCount, radar.markerCount);
            assert.equal(radar.repeatedPanels, 0, 'repeated agent panels returned');
          }
          assert.equal(
            await page.locator('.sidebar [aria-current="page"]').getAttribute('aria-label'),
            view,
          );
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth + 2,
          );
          assert.equal(
            overflow,
            false,
            `document overflow: ${view} ${size.width} ${scale} ${theme}`,
          );
          if (
            size.width === 1200 &&
            scale === 1 &&
            ['Monitoring', 'Agents', 'Settings'].includes(view)
          ) {
            await page.screenshot({ path: resolve(out, `${theme}-${view.toLowerCase()}.png`) });
          }
          if (size.width === 1200 && scale === 1 && theme === 'dark') {
            await page.screenshot({ path: resolve(out, `workspace-${views.indexOf(view)}.png`) });
            if (view === 'AI analysis') {
              const panels = await page.evaluate(() => {
                const config = document.querySelector('.analysis-config').getBoundingClientRect();
                const report = document.querySelector('.analysis-output').getBoundingClientRect();
                return {
                  aligned: Math.abs(config.y - report.y) < 1,
                  configWidth: config.width,
                  reportWidth: report.width,
                  bottom: report.bottom,
                };
              });
              assert(
                panels.aligned && panels.reportWidth > panels.configWidth * 2,
                'prototype assessment columns',
              );
              assert(panels.bottom <= 770, 'assessment report extends under footer');
            }
            if (view === 'Settings') {
              const row = await page
                .locator('.setting:has(input[type="checkbox"])')
                .first()
                .evaluate((row) => ({
                  direction: getComputedStyle(row).flexDirection,
                  checkbox: row.querySelector('input').getBoundingClientRect().x,
                  label: row.getBoundingClientRect().x,
                }));
              assert.equal(
                row.direction,
                'row',
                'checkbox form styles regressed to stacked labels',
              );
              assert(row.checkbox > row.label + 100, 'checkbox is not aligned on right');
            }
          }
        }
      }
    }
  }
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.evaluate(() => document.documentElement.style.setProperty('--ui-scale', '1'));
  await page.locator('.sidebar').getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Theme', { exact: true }).selectOption('light-hc');
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await page
    .getByRole('status')
    .filter({ hasText: /^Completed$/ })
    .waitFor();
  await page.reload();
  await page.getByRole('heading', { name: 'Monitoring', level: 1, exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'light-hc');
  await page.getByRole('button', { name: 'Toggle theme', exact: true }).click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await page.locator('.sidebar').getByRole('button', { name: 'Settings', exact: true }).click();
  assert.equal(await page.getByLabel('Theme', { exact: true }).inputValue(), 'dark');
  await page.getByRole('button', { name: 'Toggle theme', exact: true }).click();
  assert.equal(await page.getByLabel('Theme', { exact: true }).inputValue(), 'light');
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--ui-scale', '1');
    document.documentElement.dataset.theme = 'dark';
  });
  await page.locator('.sidebar').getByRole('button', { name: 'Monitoring', exact: true }).click();
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
  await page.getByRole('button', { name: /Select Claude Code, 1 processes/ }).click();
  await page.locator('.agent-workspace:visible').waitFor();
  assert.equal(await page.getByRole('dialog').count(), 0);
  await page
    .locator('.agent-context')
    .getByLabel('Selected process', { exact: true })
    .selectOption({ index: 1 });
  await page.getByRole('heading', { name: 'Process overview', exact: true }).waitFor();
  await page
    .getByRole('tablist', { name: 'Agent sections' })
    .getByRole('tab', { name: 'Processes', exact: true })
    .click();
  await page.getByText('Process attributes and controls', { exact: true }).click();
  await page.getByRole('button', { name: 'Suspend', exact: true }).waitFor();
  await page.screenshot({ path: resolve(out, 'instance.png') });
  assert.equal(await page.locator('button button, button a').count(), 0);
  await page
    .locator('.agent-context')
    .getByLabel('Selected agent', { exact: true })
    .selectOption('');
  await page.locator('.sidebar').getByRole('button', { name: 'Monitoring', exact: true }).click();
  assert.equal(await page.evaluate(() => window.bridgeCalls), 0);
  await checkMotion(page);
  await page.close();
  await checkClarity(browser, base + '/desktop/', out);
  await checkResourceLayers(browser, base + '/desktop/', out);
  await checkDetails(browser, base + '/desktop/', out);
  await checkPagination(browser, base + '/desktop/', out);
  await checkComfort(browser, base + '/preview/', out);
  await checkGraphs(browser, base + '/preview/', out);
  await checkUsability(browser, base + '/preview/', out);
  const desktop = await browser.newPage();
  desktop.on('pageerror', (e) => errors.push(e.message));
  await desktop.goto(base + '/desktop/');
  await desktop.getByText('Desktop bridge unavailable.', { exact: false }).waitFor();
  assert.equal(await desktop.locator('.radar-blip').count(), 0);
  await desktop.close();
  assert.deepEqual(errors, [], 'browser runtime errors');
  console.log(
    'Shared Svelte preview: 264 viewport/theme/scale view checks; four themes; theme persistence and ordinary toggle; isolated bridge; dialog; desktop unavailable state; production fixture exclusion passed.',
  );
} finally {
  await browser.close();
  server.close();
}
