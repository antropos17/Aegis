import assert from 'node:assert/strict';
import { resolve } from 'node:path';
/** Verify persistent watchlist feedback and grouped controls with a disposable bridge.
 * @param {import('playwright').Browser} browser Browser @param {string} url Desktop URL
 * @param {string} out Screenshot directory @returns {Promise<void>} Checked @since 0.14.1
 */
export async function checkWatchlist(browser, url, out) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.addInitScript(() => {
      const listeners = {};
      const fixture = {
        listeners,
        entries: [
          { signature: 'other', pid: 42 },
          { signature: 'other', pid: 42 },
          { signature: 'other', pid: 43 },
        ],
        release: null,
        fail: false,
        adds: 0,
      };
      window.watchlistFixture = fixture;
      window.aegis = new Proxy(
        {},
        {
          get: (_, name) => {
            if (name.startsWith('on'))
              return (callback) => {
                listeners[name] = callback;
                return () => {};
              };
            if (name === 'getSettings') return async () => ({ darkMode: true, uiScale: 1 });
            if (name === 'getFalsePositives') return async () => [];
            if (name === 'getAgentDatabase')
              return async () => ({
                agents: [{ id: 'codex', displayName: 'Codex', names: ['codex.exe'] }],
              });
            if (name === 'blocklistList') return async () => structuredClone(fixture.entries);
            if (name === 'blocklistAdd')
              return () => {
                fixture.adds++;
                return new Promise((resolve) => {
                  fixture.release = () => {
                    const entry = { signature: 'codex', pid: null };
                    fixture.entries.push(entry);
                    resolve({ success: true, entry });
                  };
                });
              };
            if (name === 'blocklistRemove')
              return async (entry) => {
                if (fixture.fail) return { success: false, error: 'Storage unavailable' };
                const before = fixture.entries.length;
                fixture.entries = fixture.entries.filter(
                  (r) => r.signature !== entry.signature || (r.pid ?? null) !== (entry.pid ?? null),
                );
                return { success: true, removed: before !== fixture.entries.length };
              };
            return async () => ({});
          },
        },
      );
    });
    await page.goto(url);
    await page.getByRole('button', { name: 'Detailed monitoring', exact: true }).click();
    await page.evaluate(() =>
      window.watchlistFixture.listeners.onScanBatch({
        agents: [
          {
            agent: 'Codex',
            process: 'codex.exe',
            pid: 42,
            instanceId: '42:watch',
            instanceIdSource: 'os',
          },
        ],
        stats: {
          appHealth: { populationReliable: true, state: 'HEALTHY' },
          observationGap: { state: 'NONE' },
        },
      }),
    );
    await page.getByRole('button', { name: /Select Codex,/ }).click();
    await page.getByRole('button', { name: 'Open agent', exact: true }).click();
    await page.getByLabel('Selected process', { exact: true }).selectOption('42:watch');
    await page.getByRole('tab', { name: 'Processes', exact: true }).click();
    await page.getByText('Process attributes and controls', { exact: true }).click();
    const watch = page.getByRole('region', { name: 'Alert watchlist' });
    await watch.getByText('Watchlist is up to date.').waitFor();
    await watch.getByRole('button', { name: 'Watch agent', exact: true }).click();
    await watch.getByRole('status').filter({ hasText: 'Adding Codex…' }).waitFor();
    assert.equal(await watch.getByRole('button', { name: 'Reload watchlist' }).isEnabled(), false);
    await page.evaluate(() => window.watchlistFixture.release());
    await watch.getByText('Codex added to the watchlist.').waitFor();
    assert.equal(await watch.getByRole('button', { name: 'Watch agent', exact: true }).count(), 0);
    await watch.getByText('Other watchlist entries (2)', { exact: true }).click();
    assert.equal(await watch.locator('li').count(), 2);
    for (const width of [900, 1200])
      for (const scale of [1, 1.5])
        for (const theme of ['dark', 'light', 'dark-hc', 'light-hc']) {
          await page.setViewportSize({ width, height: width === 900 ? 600 : 800 });
          await page.evaluate(
            ({ scale, theme }) => {
              document.documentElement.style.setProperty('--ui-scale', String(scale));
              document.documentElement.dataset.theme = theme;
            },
            { scale, theme },
          );
          assert(
            await watch.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
            'watchlist overflow',
          );
          await watch
            .locator('.watch-subject')
            .screenshot({ path: resolve(out, `watchlist-${width}-${scale}-${theme}.png`) });
        }
    const remove = watch.getByRole('button', { name: 'Remove other · PID 42' });
    await remove.focus();
    await page.keyboard.press('Enter');
    await watch.getByText('other · PID 42 removed from the watchlist.').waitFor();
    assert(
      await watch
        .getByRole('button', { name: 'Remove agent', exact: true })
        .evaluate((node) => document.activeElement === node),
      'removed row lost keyboard focus',
    );
    assert.equal(await watch.locator('li').count(), 1);
    await page.evaluate(() => (window.watchlistFixture.fail = true));
    await watch.getByRole('button', { name: 'Remove agent', exact: true }).click();
    await watch
      .getByRole('alert')
      .filter({ hasText: 'Change not saved. Storage unavailable' })
      .waitFor();
    assert.equal(await watch.getByText('On the watchlist · all processes').count(), 1);
    await page.evaluate(() => (window.watchlistFixture.fail = false));
    await watch.getByRole('button', { name: 'Remove agent', exact: true }).click();
    await watch.getByText('Codex · all processes removed from the watchlist.').waitFor();
    assert.equal(await page.evaluate(() => window.watchlistFixture.adds), 1);
    assert.deepEqual(errors, []);
    console.log(
      'Watchlist: pending/success/failure feedback, canonical add/remove, duplicate/PID grouping, keyboard focus and 16 layouts passed.',
    );
  } finally {
    await page.close();
  }
}
