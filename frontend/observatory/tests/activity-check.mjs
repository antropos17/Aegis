import assert from 'node:assert/strict';
import { resolve } from 'node:path';

/** Verify Monitoring activity spacing and interval inspection with deterministic events.
 * @param {import('playwright').Browser} browser Browser
 * @param {string} url Desktop build @param {string} out Screenshot directory
 * @returns {Promise<void>} Verified states @since 0.14.1
 */
export async function checkActivity(browser, url, out) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.addInitScript(() => {
      const listeners = {};
      window.activityFixture = listeners;
      window.aegis = new Proxy(
        {},
        {
          get: (_, name) =>
            name.startsWith('on')
              ? (callback) => {
                  listeners[name] = callback;
                  return () => {};
                }
              : async () =>
                  name === 'getSettings'
                    ? { darkMode: true, uiScale: 1 }
                    : name === 'getFalsePositives'
                      ? []
                      : {},
        },
      );
    });
    await page.goto(url);
    await page.getByRole('heading', { name: 'Agent radar', exact: true }).waitFor();
    await page.evaluate(() => {
      window.activityFixture.onScanBatch({
        agents: [
          {
            agent: 'Codex',
            pid: 123,
            instanceId: 'activity:123',
            instanceIdSource: 'os',
            process: 'codex.exe',
          },
        ],
        stats: { appHealth: { populationReliable: true, state: 'HEALTHY' } },
      });
      window.activityFixture.onFileAccess(
        Array.from({ length: 48 }, (_, i) => ({
          agent: 'Codex',
          pid: 123,
          instanceId: 'activity:123',
          file: 'X:/Fixture/file-' + i + '.txt',
          timestamp: Date.now() - (i + 1) * 10000,
          action: 'read',
          attribution: { status: 'confirmed' },
        })),
      );
    });
    const chart = page.locator('.activity-chart');
    const recent = page.locator('.recent-evidence');
    const geometry = () =>
      page.evaluate(() => {
        const chart = document.querySelector('.activity-chart').getBoundingClientRect();
        const recent = document.querySelector('.recent-evidence').getBoundingClientRect();
        return {
          gap: recent.top - chart.bottom,
          chartHeight: chart.height,
          recentTop: recent.top + document.querySelector('#main').scrollTop,
        };
      });
    let states = 0;
    for (const width of [900, 1200]) {
      await page.setViewportSize({ width, height: width === 900 ? 600 : 800 });
      for (const scale of [1, 1.5]) {
        for (const theme of ['light', 'dark', 'light-hc', 'dark-hc']) {
          await page.mouse.move(0, 0);
          await page.evaluate(
            ({ scale, theme }) => {
              document.documentElement.dataset.theme = theme;
              document.documentElement.style.setProperty('--ui-scale', String(scale));
              const main = document.querySelector('#main');
              main.scrollTop +=
                document.querySelector('.activity-chart').getBoundingClientRect().top - 100;
            },
            { scale, theme },
          );
          const before = await geometry();
          assert.equal(before.gap, 16, 'activity and recent events touch');
          const bucket = chart.getByRole('button').filter({ hasText: /^$/ }).nth(16);
          await bucket.hover();
          assert.deepEqual(await geometry(), before, 'inspection moved adjacent content');
          assert(
            await chart.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
            'chart overflow',
          );
          await page.mouse.move(0, 0);
          if (width === 900 && scale === 1.5)
            await page.screenshot({ path: resolve(out, 'monitoring-activity-' + theme + '.png') });
          if (width === 1200 && scale === 1)
            await page.screenshot({ path: resolve(out, 'activity-overview-' + theme + '.png') });
          states++;
        }
      }
    }
    const bucket = chart.locator('.chart-bucket').nth(16);
    await bucket.hover();
    const caption = await bucket.getAttribute('aria-label');
    await page.waitForTimeout(2100);
    assert.equal(await bucket.getAttribute('aria-label'), caption, 'hovered interval drifted');
    const count = Number(caption.match(/(\d+) observations$/)[1]);
    await bucket.click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    assert.equal(await dialog.locator('.observation-history [data-detail-focus]').count(), count);
    await dialog.getByRole('button', { name: 'Close details', exact: true }).click();
    await page.mouse.move(0, 0);
    await chart.getByRole('button', { name: '5 min', exact: true }).click();
    assert(await recent.isVisible());
    assert.deepEqual(errors, []);
    console.log(
      'Monitoring activity: ' +
        states +
        ' layout states; separated panels, stable readout and exact held interval drill-down passed.',
    );
  } finally {
    await page.close();
  }
}
