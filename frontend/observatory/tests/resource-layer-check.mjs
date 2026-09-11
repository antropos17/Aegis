import assert from 'node:assert/strict';
import { resolve } from 'node:path';

/** Check readable resources and evidence links at the current desktop size.
 * @param {import('playwright').Page} page Observatory page @returns {Promise<void>} Verified geometry @since 0.14.1
 */
export async function checkResourceGeometry(page) {
  const explorer = page.locator('.resource-explorer:visible');
  await explorer.waitFor();
  if (await explorer.locator('.resource-choice').count()) {
    await explorer.locator('.resource-choice').first().click();
    await explorer.locator('.resource-investigation').waitFor();
  }
  const issues = await explorer.evaluate((root) => {
    const issues = [];
    const bounds = root.getBoundingClientRect();
    for (const node of root.querySelectorAll(
      '.resource-choice, .resource-details, .relation, button, select, input',
    )) {
      const box = node.getBoundingClientRect();
      if (box.width && (box.left < bounds.left - 1 || box.right > bounds.right + 1))
        issues.push('content outside explorer: ' + node.className);
    }
    for (const relation of root.querySelectorAll('.relation')) {
      const line = relation.querySelector('.relationship-line');
      if (line.classList.contains('unlinked')) {
        if (getComputedStyle(line).visibility !== 'hidden') issues.push('unknown actor has a line');
      } else {
        const style = getComputedStyle(line);
        if (
          style.borderTopStyle !== (relation.dataset.evidence === 'confirmed' ? 'solid' : 'dashed')
        )
          issues.push('ownership style is misleading');
        if (line.getAnimations({ subtree: true }).length)
          issues.push('link implies live data transfer');
      }
    }
    if (root.scrollWidth > root.clientWidth + 1) issues.push('explorer overflows');
    if (root.querySelectorAll('.resource-choice').length > 6)
      issues.push('resource pagination unbounded');
    return issues;
  });
  assert.deepEqual(issues, [], 'resource explorer geometry');
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
        ...[443, 443, 80, 8080, 8443, 9000, 9443].map((remotePort) => ({
          instanceId: agents[0].instanceId,
          domain: '',
          remoteIp: '192.0.2.10',
          remotePort,
          state: 'Established',
        })),
        { instanceId: agents[4].instanceId, domain: '', remoteIp: '2001:db8::1', remotePort: 443 },
      ]);
      window.resourceFixture.onFileAccess(
        Array.from({ length: 14 }, (_, i) => ({
          instanceId: agents[0].instanceId,
          file: `X:/Fixture/project-${i % 7}/settings.json`,
          timestamp: Date.now() - i * 1000,
          attribution: { status: 'inferred' },
          action: 'modified',
        })),
      );
    });
    const layer = (name) =>
      page.locator('.radar-layers').getByRole('button', { name, exact: true });
    const explorer = page.locator('.resource-explorer:visible');
    await layer('Network').click();
    assert.match(
      await explorer.locator('.explorer-summary').innerText(),
      /7\s*unique destinations/,
    );
    await explorer.getByRole('button', { name: 'Inspect 192.0.2.10:443', exact: true }).click();
    await explorer.getByRole('button', { name: 'All resource records' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    assert.match(await dialog.getByRole('heading', { level: 2 }).innerText(), /192\.0\.2\.10:443/);
    await dialog.getByRole('tab', { name: /Records/ }).click();
    assert.equal(await dialog.locator('.observation-history .recent-event').count(), 2);
    for (const entry of await dialog.locator('.observation-history .recent-event').all())
      assert.match(await entry.innerText(), /192\.0\.2\.10:443/);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    await explorer.getByRole('button', { name: 'Inspect process' }).click();
    await page.locator('.agent-workspace:visible').waitFor();
    assert.equal(
      await page.getByLabel('Selected process', { exact: true }).inputValue(),
      'resource-test:0',
    );
    await page.getByLabel('Selected agent', { exact: true }).selectOption('');
    await page.locator('.sidebar').getByRole('button', { name: 'Monitoring', exact: true }).click();
    for (const size of [
      { width: 1200, height: 800 },
      { width: 900, height: 600 },
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
            const previous = explorer.getByLabel('Previous radar resources');
            if (await previous.isEnabled()) await previous.click();
            await checkResourceGeometry(page);
            assert.equal(
              await explorer.getByLabel('Next radar resources').getAttribute('aria-disabled'),
              'false',
            );
            await explorer.getByLabel('Next radar resources').click();
            await checkResourceGeometry(page);
            assert.equal(
              await explorer.getByLabel('Next radar resources').getAttribute('aria-disabled'),
              'true',
            );
          }
        }
      }
    }
    const first = await explorer.locator('.resource-choice').first().elementHandle();
    await page.evaluate(() =>
      window.resourceFixture.onScanBatch({
        agents: structuredClone(window.resourceAgents),
        stats: window.resourceStats,
      }),
    );
    await checkResourceGeometry(page);
    assert(
      await first.evaluate((node) => node.isConnected),
      'scan recreated unchanged resource buttons',
    );
    await explorer.getByLabel('Resource agent').selectOption('Zeta');
    assert.match(await explorer.locator('.resource-choice').innerText(), /\[2001:db8::1\]:443/);
    await layer('Files').click();
    assert.match(await explorer.locator('.resource-empty').innerText(), /No matching observations/);
    await explorer.getByRole('button', { name: 'Clear filters' }).click();
    await checkResourceGeometry(page);
    await page.evaluate(() =>
      window.resourceFixture.onStatsUpdate({ appHealth: { populationReliable: false } }),
    );
    await explorer
      .getByText('Observation is stale. Current process navigation is unavailable.')
      .waitFor();
    assert.match(
      await explorer.locator('.scope-note').first().innerText(),
      /Last available observations/,
    );
    for (const button of await explorer.getByRole('button', { name: 'Inspect process' }).all())
      assert(await button.isDisabled());
    for (const name of ['Files', 'Network']) {
      await layer(name).click();
      await explorer.getByLabel('Resource agent').selectOption('');
      await checkResourceGeometry(page);
      await explorer.screenshot({ path: resolve(out, 'resources-' + name.toLowerCase() + '.png') });
    }

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
      'Resource layers: 48 theme/scale/viewport combinations, all pages, readable relationship geometry, empty DNS, deduplication, refreshed identities, process navigation, stale controls, product/skill grouping and keyboard disclosure passed.',
    );
  } finally {
    await page.close();
  }
}
