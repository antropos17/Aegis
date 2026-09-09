import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const out = 'dist/template-qa';
await mkdir(out, { recursive: true });
const reference = process.env.OBSERVATORY_REFERENCE_URL || 'http://127.0.0.1:8770';
const desktop = process.env.OBSERVATORY_PREVIEW_URL || 'http://127.0.0.1:8771';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const settle = () =>
  page.waitForFunction(() => !document.documentElement.dataset.transitionSurface);
const shot = (name) => page.screenshot({ path: out + '/' + name + '.png', animations: 'disabled' });
try {
  const views = [
    'overview',
    'agents',
    'events',
    'network',
    'rules',
    'database',
    'analysis',
    'reports',
    'audit',
    'stats',
    'settings',
  ];
  for (const [label, base] of [
    ['template', reference],
    ['desktop', desktop],
  ])
    for (const view of views) {
      await page.goto(base + '/?view=' + view);
      await page
        .locator('h1')
        .filter({
          hasText: {
            overview: 'Monitoring',
            agents: 'Agents',
            events: 'Events',
            network: 'Network',
            rules: 'Rules & permissions',
            database: 'Agent catalog',
            analysis: 'AI analysis',
            reports: 'Reports',
            audit: 'Audit',
            stats: 'Statistics',
            settings: 'Settings',
          }[view],
        })
        .waitFor();
      await settle();
      await page.waitForTimeout(250);
      await shot(label + '-' + view);
    }
  await page.goto(desktop);
  await page.getByRole('button', { name: /Select Claude Code,/ }).click();
  await shot('desktop-selected');
  await page.getByRole('button', { name: 'Files', exact: true }).click();
  await page.locator('.radar-links[data-routes="ready"]').waitFor();
  assert.equal(await page.locator('.resource-node').count(), 2);
  const route = await page.locator('.radar-links path').first().getAttribute('d');
  assert(route && !route.includes('NaN'));
  await shot('desktop-radar-files');
  await page.getByText(/Individual processes/).click();
  await page.getByRole('button', { name: 'Process', exact: true }).click();
  await page.getByRole('dialog').waitFor();
  await shot('desktop-process');
  await page.getByRole('dialog').locator('.recent-event').first().click();
  await settle();
  await shot('desktop-event');
  await page.getByRole('dialog').getByRole('button', { name: 'Back', exact: true }).click();
  await settle();

  await page.keyboard.press('Escape');
  await page
    .locator('.sidebar')
    .getByRole('button', { name: 'Agent catalog', exact: true })
    .click();
  await settle();
  await page.getByRole('button', { name: 'Add agent', exact: true }).click();
  await page.getByRole('dialog', { name: 'Add custom agent' }).waitFor();
  await page.getByLabel('Name', { exact: true }).fill('Custom agent');
  await page.getByLabel('Process name', { exact: true }).fill('custom-agent.exe');
  await shot('desktop-catalog-form');
  await page.keyboard.press('Escape');
  assert(
    await page
      .getByRole('button', { name: 'Add agent', exact: true })
      .evaluate((el) => el === document.activeElement),
  );
  await page.locator('.sidebar').getByRole('button', { name: 'AI analysis', exact: true }).click();
  await settle();
  await page.getByRole('button', { name: 'Connect AI analysis', exact: true }).click();
  await shot('desktop-provider-form');
  await page.keyboard.press('Escape');
  await page.locator('.sidebar').getByRole('button', { name: 'Settings', exact: true }).click();
  await settle();
  await page.getByLabel('Theme', { exact: true }).selectOption('light');
  await page.getByLabel('Interface scale').focus();
  await page.getByLabel('Interface scale').press('End');
  await page.setViewportSize({ width: 900, height: 600 });
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
  await shot('desktop-settings-live-scale');
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  assert.equal(await page.getByLabel('Interface scale').inputValue(), '1');
  // Review actual layouts at the supported minimum, without changing saved settings.
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--ui-scale', '1.5');
    document.documentElement.dataset.theme = 'light';
  });
  for (const name of ['Monitoring', 'Events', 'Rules & permissions', 'AI analysis', 'Settings']) {
    await page.locator('.sidebar').getByRole('button', { name, exact: true }).click();
    await page.getByRole('heading', { level: 1, name, exact: true }).waitFor();
    await settle();
    await shot('small-' + name.replaceAll(/[^a-z]/gi, '').toLowerCase());
  }
  assert.deepEqual(errors, []);
  console.log(
    'Captured all 11 template/desktop pairs plus selections, resource routes, process history, forms and minimum-window layouts. Keyboard dismissal/focus, real appearance controls and discard passed.',
  );
} finally {
  await browser.close();
}
