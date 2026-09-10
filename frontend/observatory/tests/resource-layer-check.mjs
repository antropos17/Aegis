import assert from 'node:assert/strict';
import { resolve } from 'node:path';

/** Check resource routes against rendered anchors after motion, resizing and data refresh.
 * @param {import('playwright').Page} page Observatory page @returns {Promise<void>} Verified geometry @since 0.14.1
 */
export async function checkResourceGeometry(page) {
  await page.waitForFunction(
    () => document.querySelector('.radar-links')?.dataset.routes === 'ready',
  );
  await page.waitForTimeout(350);
  const issues = await page.locator('.radar-stage').evaluate((stage) => {
    const issues = [];
    const svg = stage.querySelector('.radar-links');
    const bounds = stage.getBoundingClientRect();
    const nodes = [...stage.querySelectorAll('.resource-node')];
    const center = (r) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
    for (const node of nodes) {
      const box = node.getBoundingClientRect();
      if (
        box.left < bounds.left ||
        box.right > bounds.right + 1 ||
        box.top < bounds.top ||
        box.bottom > bounds.bottom + 1
      )
        issues.push('resource outside stage');
      if (!node.querySelector('strong')?.textContent.trim()) issues.push('empty resource label');
      const route = [...svg.querySelectorAll('g')].find(
        (g) => g.dataset.resourceKey === node.dataset.resourceKey,
      );
      const marker = [...stage.querySelectorAll('.radar-blip')].find(
        (m) => m.dataset.group === node.dataset.resourceGroup,
      );
      if (!marker) {
        if (getComputedStyle(route).display !== 'none')
          issues.push('unattributed resource has a route');
        continue;
      }
      for (const other of stage.querySelectorAll('.radar-blip')) {
        const b = other.getBoundingClientRect();
        if (box.left < b.right && box.right > b.left && box.top < b.bottom && box.bottom > b.top)
          issues.push('resource overlaps marker');
      }
      const path = route.querySelector('path');
      const matrix = path.getScreenCTM();
      const start = path.getPointAtLength(0).matrixTransform(matrix);
      const end = path.getPointAtLength(path.getTotalLength()).matrixTransform(matrix);
      const dot = center(marker.querySelector('.blip-dot').getBoundingClientRect());
      const resource = center(box);
      if (Math.hypot(start.x - dot.x, start.y - dot.y) > 1.5)
        issues.push('route detached from marker');
      if (Math.hypot(end.x - resource.x, end.y - resource.y) > 1.5)
        issues.push('route detached from resource');
    }
    return issues;
  });
  assert.deepEqual(issues, [], 'resource layer geometry');
}

/** Exercise populated desktop resource layers through an isolated bridge fixture.
 * @param {import('playwright').Browser} browser Browser @param {string} url Desktop build URL
 * @param {string} out Screenshot directory @returns {Promise<void>} Regression assertions @since 0.14.1
 */
export async function checkResourceLayers(browser, url, out) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.addInitScript(() => {
      const listeners = {};
      window.resourceFixture = listeners;
      window.aegis = new Proxy(
        {},
        {
          get: (_, method) => {
            if (method.startsWith('on'))
              return (cb) => {
                listeners[method] = cb;
                return () => delete listeners[method];
              };
            return async () =>
              method === 'getSettings'
                ? { darkMode: true, uiScale: 1 }
                : method === 'getAppVersion'
                  ? 'Test'
                  : method === 'getFalsePositives'
                    ? []
                    : {};
          },
        },
      );
    });
    await page.goto(url);
    await page.getByRole('heading', { name: 'Agent radar', exact: true }).waitFor();
    await page.evaluate(() => {
      const agents = ['Claude Code', 'Codex', 'Cursor', 'Ollama', 'Zeta'].map((agent, i) => ({
        agent,
        pid: 100 + i,
        process: 'agent.exe',
        instanceId: `resource-test:${i}`,
        instanceIdSource: 'os',
      }));
      window.resourceAgents = agents;
      window.resourceStats = {
        appHealth: { populationReliable: true, identityDegraded: false, state: 'HEALTHY' },
        observationGap: { state: 'NONE' },
      };
      window.resourceFixture.onScanBatch({ agents, stats: window.resourceStats });
      window.resourceFixture.onNetworkUpdate([
        ...[443, 443, 80, 8080, 8443].map((remotePort) => ({
          instanceId: agents[0].instanceId,
          domain: '',
          remoteIp: '192.0.2.10',
          remotePort,
          state: 'Established',
        })),
        { instanceId: agents[4].instanceId, domain: '', remoteIp: '2001:db8::1', remotePort: 443 },
      ]);
      window.resourceFixture.onFileAccess(
        Array.from({ length: 8 }, (_, i) => ({
          instanceId: agents[0].instanceId,
          file: `X:/Fixture/project-${i % 4}/settings.json`,
          timestamp: Date.now() - i * 1000,
          attribution: { status: 'inferred' },
          action: 'modified',
        })),
      );
    });
    const layer = (name) =>
      page.locator('.radar-layers').getByRole('button', { name, exact: true });
    await layer('Network').click();
    assert.match(await page.locator('.resource-scope').innerText(), /4 unique endpoints/);
    await page.locator('.resource-node').first().click();
    await page.getByRole('dialog').waitFor();
    const dialog = page.getByRole('dialog');
    assert.match(await dialog.getByRole('heading', { level: 2 }).innerText(), /192\.0\.2\.10:443/);
    await dialog.getByRole('tab', { name: /Records/ }).click();
    assert.equal(await dialog.locator('.observation-history .recent-event').count(), 2);
    for (const entry of await dialog.locator('.observation-history .recent-event').all())
      assert.match(await entry.innerText(), /192\.0\.2\.10:443/);
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.mouse.move(0, 0);
    for (const size of [
      { width: 1200, height: 800 },
      { width: 900, height: 700 },
      { width: 1779, height: 1146 },
    ]) {
      await page.setViewportSize(size);
      for (const scale of [1, 1.5]) {
        await page.evaluate(
          (scale) => document.documentElement.style.setProperty('--ui-scale', String(scale)),
          scale,
        );
        for (const theme of ['dark', 'light', 'dark-hc', 'light-hc']) {
          await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme);
          for (const name of ['Files', 'Network']) {
            await layer(name).click();
            await checkResourceGeometry(page);
            await page.getByLabel('Next radar resources').click();
            await checkResourceGeometry(page);
          }
        }
      }
    }
    await page.locator('.radar-stage').screenshot({ path: resolve(out, 'resources-network.png') });
    // Same identities with new objects must not recreate resource nodes or detach routes.
    const first = await page.locator('.resource-node').first().elementHandle();
    await page.evaluate(() =>
      window.resourceFixture.onScanBatch({
        agents: structuredClone(window.resourceAgents),
        stats: window.resourceStats,
      }),
    );
    await checkResourceGeometry(page);
    assert(await first.evaluate((node) => node.isConnected), 'scan recreated unchanged resources');
    await page.getByLabel('Next radar agents').click();
    await checkResourceGeometry(page);
    assert.match(await page.locator('.resource-node').innerText(), /\[2001:db8::1\]:443/);
    await layer('Files').click();
    assert.match(
      await page.locator('.resource-empty').innerText(),
      /No file observations on this page/,
    );
    await page.getByLabel('Previous radar agents').click();
    await checkResourceGeometry(page);
    await page.locator('.radar-stage').screenshot({ path: resolve(out, 'resources-files.png') });
    await page.evaluate(() =>
      window.resourceFixture.onStatsUpdate({ appHealth: { populationReliable: false } }),
    );
    await page.waitForFunction(() => document.querySelector('.radar-links').animationsPaused());
    assert.match(await page.locator('.resource-scope').innerText(), /Last reliable snapshot/);

    // Product processes and skill observations have distinct, expandable grouping.
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--ui-scale', '1');
      document.documentElement.dataset.theme = 'dark';
      window.resourceFixture.onScanBatch({
        agents: Array.from({ length: 12 }, (_, i) => ({
          agent: 'Codex',
          process: 'codex.exe',
          pid: 200 + i,
          instanceId: 'presentation:' + i,
          instanceIdSource: 'os',
        })),
        stats: window.resourceStats,
      });
      window.resourceFixture.onFileAccess(
        Array.from({ length: 12 }, (_, i) => ({
          agent: '',
          instanceId: null,
          file: 'C:/Fixture/.codex/skills/review/SKILL.md',
          timestamp: Date.now() - i * 1000,
          action: 'modified',
          attribution: { status: 'unattributed' },
        })),
      );
    });
    await page.locator('.sidebar').getByRole('button', { name: 'Reports', exact: true }).click();
    await page.locator('.report-agent-group').waitFor();
    assert.equal(await page.locator('.report-agent-group').count(), 1);
    assert.match(await page.locator('.report-agent-group').innerText(), /Codex[\s\S]*12/);
    await page.screenshot({ path: resolve(out, 'grouped-report.png') });
    await page.locator('.sidebar').getByRole('button', { name: 'Events', exact: true }).click();
    await page.getByLabel('Search events').fill('review');
    await page.getByRole('button', { name: 'Open 12 observations for review' }).waitFor();
    assert.equal(await page.locator('.observation-group').count(), 1);
    assert.match(await page.locator('.observation-group').innerText(), /Codex/);
    assert.match(await page.locator('.observation-group').innerText(), /actor not recorded/i);
    const group = page.getByRole('button', { name: 'Open 12 observations for review' });
    await group.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('dialog').waitFor();
    assert.equal(await page.locator('.observation-history .recent-event').count(), 12);
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.getByLabel('Grouping', { exact: true }).selectOption('none');
    assert.equal(await page.locator('.observation-group').count(), 12);
    await page.getByLabel('Grouping', { exact: true }).selectOption('resource');
    for (const theme of ['dark', 'light', 'dark-hc', 'light-hc']) {
      await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme);
      await page.screenshot({ path: resolve(out, 'skill-context-' + theme + '.png') });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
    }

    assert.deepEqual(errors, []);
    console.log(
      'Resource layers: 48 theme/scale/viewport combinations, all pages, exact route anchors, empty DNS, deduplication, refreshed identities, details, stale motion, product/skill grouping and keyboard disclosure passed.',
    );
  } finally {
    await page.close();
  }
}
