import assert from 'node:assert/strict';
import { resolve } from 'node:path';

/** Verify stationary pagination of live evidence, including short last pages.
 * @param {import('playwright').Browser} browser Browser
 * @param {string} url Desktop fixture URL @param {string} out Screenshot directory
 * @returns {Promise<void>} Checked workflows @since 0.14.1
 */
export async function checkPagination(browser, url, out) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.addInitScript(() => {
      const listeners = {};
      window.paginationFixture = listeners;
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
    await page.getByRole('button', { name: 'Detailed monitoring', exact: true }).click();
    await page.getByRole('heading', { name: 'Agent radar', exact: true }).waitFor();
    await page.evaluate(() => {
      window.paginationFixture.onScanBatch({
        agents: [
          {
            agent: 'Codex',
            pid: 123,
            instanceId: 'pagination:123',
            instanceIdSource: 'os',
            process: 'codex.exe',
          },
        ],
        stats: { appHealth: { populationReliable: true, state: 'HEALTHY' } },
      });
      const common = { agent: 'Codex', pid: 123, instanceId: 'pagination:123' };
      window.paginationFixture.onFileAccess(
        Array.from({ length: 65 }, (_, i) => ({
          ...common,
          file: 'X:/Fixture/file-' + i + '.txt',
          timestamp: Date.now() - i * 1000,
          action: 'read',
          attribution: { status: 'confirmed' },
        })),
      );
      window.paginationFixture.onNetworkUpdate(
        Array.from({ length: 65 }, (_, i) => ({
          ...common,
          remoteIp: '192.0.2.' + (i + 1),
          remotePort: 443,
          state: 'ESTABLISHED',
          verdict: 'unknown',
        })),
      );
    });
    let states = 0;
    for (const view of ['Events', 'Network']) {
      await page.locator('.sidebar').getByRole('button', { name: view, exact: true }).click();
      for (const width of [900, 1200]) {
        await page.setViewportSize({ width, height: width === 900 ? 600 : 800 });
        for (const scale of [1, 1.5]) {
          for (const theme of ['light', 'dark', 'light-hc', 'dark-hc']) {
            await page.evaluate(
              ({ scale, theme }) => {
                document.documentElement.dataset.theme = theme;
                document.documentElement.style.setProperty('--ui-scale', String(scale));
                document.querySelector('#main').scrollTop = 0;
              },
              { scale, theme },
            );
            const pager = page.getByRole('navigation', { name: 'Observation pages' });
            const next = pager.getByRole('button', { name: 'Next', exact: true });
            const previous = pager.getByRole('button', { name: 'Previous', exact: true });
            const geometry = () =>
              pager.evaluate((node) => ({
                top: node.getBoundingClientRect().top,
                height: node.getBoundingClientRect().height,
                scroll: document.querySelector('#main').scrollTop,
              }));
            const before = await geometry();
            for (const [control, count] of [
              [next, 30],
              [next, 5],
              [previous, 30],
              [previous, 30],
            ]) {
              await control.click();
              assert.deepEqual(await geometry(), before, view + ' pagination moved');
              assert(
                await control.evaluate((node) => node === document.activeElement),
                'pagination stole focus',
              );
              assert.equal(
                await page.locator('.observation-table:visible tbody tr').count(),
                count,
              );
            }
            await previous.press('Enter');
            assert.match(await pager.innerText(), /1.*30 of 65/);
            await next.press('Enter');
            assert.match(await pager.innerText(), /31.*60 of 65/);
            assert(await next.evaluate((node) => node === document.activeElement));
            await previous.click();
            assert(
              await pager.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
              'pager overflow',
            );
            if (width === 900 && scale === 1.5 && !theme.endsWith('-hc')) {
              await page.screenshot({
                path: resolve(out, 'pagination-' + view.toLowerCase() + '-' + theme + '.png'),
              });
            }
            states++;
          }
        }
      }
    }
    assert.deepEqual(errors, []);
    console.log(
      'Observation pagination: ' +
        states +
        ' viewport/theme/scale states; mouse/keyboard focus, first/last pages and stationary controls passed.',
    );
  } finally {
    await page.close();
  }
}
