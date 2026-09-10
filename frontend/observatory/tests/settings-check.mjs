import assert from 'node:assert/strict';
import { resolve } from 'node:path';

/** Verify settings layout, precise draft edits and persistence controls.
 * @param {import('playwright').Browser} browser Browser @param {string} url Desktop build
 * @param {string} out Screenshot directory @returns {Promise<void>} Verified settings @since 0.14.1
 */
export async function checkSettings(browser, url, out) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.addInitScript(() => {
      let saved = {
        darkMode: true,
        uiScale: 1,
        scanIntervalSec: 10,
        notificationsEnabled: true,
        ignoreCommonBuildDirs: true,
        hardwareAcceleration: true,
        automaticUpdatesEnabled: true,
        ignoredDirectories: [],
        customSensitivePatterns: [],
        anthropicApiKey: 'DO-NOT-DISPLAY',
      };
      window.settingsWrites = [];
      window.aegis = new Proxy(
        {},
        {
          get: (_, name) => {
            if (name.startsWith('on')) return () => () => {};
            return async (patch) => {
              if (name === 'getSettings') return { ...saved };
              if (name === 'getUpdateStatus') return { status: 'idle' };
              if (name === 'getFalsePositives') return [];
              if (name === 'saveSettings') {
                window.settingsWrites.push(patch);
                saved = { ...saved, ...patch };
                return { success: true };
              }
              return {};
            };
          },
        },
      );
    });
    await page.goto(url + '?view=settings');
    await page.getByText('Settings saved', { exact: true }).waitFor();
    const workspace = page.locator('.settings-workspace');
    let states = 0;
    for (const width of [900, 1200]) {
      await page.setViewportSize({ width, height: width === 900 ? 600 : 800 });
      for (const scale of [1, 1.5]) {
        for (const theme of ['light', 'dark', 'light-hc', 'dark-hc']) {
          await page.evaluate(
            ({ scale, theme }) => {
              document.documentElement.style.setProperty('--ui-scale', String(scale));
              document.documentElement.dataset.theme = theme;
            },
            { scale, theme },
          );
          for (const name of ['Appearance', 'Monitoring', 'Desktop & updates', 'Data & help']) {
            await page.locator('#main').evaluate((node) => {
              node.scrollTop = 0;
            });
            const tab = workspace.getByRole('tab', { name, exact: true });
            await tab.click();
            assert(await tab.evaluate((node) => document.activeElement === node));
            assert.equal(await workspace.getByRole('tabpanel').count(), 1);
            assert(
              await workspace.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
              name + ' overflows',
            );
            assert(
              await page
                .locator('#main')
                .evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
              name + ' overflows main',
            );
            const footer = workspace.locator('.settings-save');
            assert(
              await footer.evaluate((node) => {
                const box = node.getBoundingClientRect();
                const main = document.querySelector('#main').getBoundingClientRect();
                return box.bottom <= main.bottom + 1 && box.top >= main.top;
              }),
              name + ' save bar is unreachable',
            );
            assert(!/DO-NOT-DISPLAY/.test(await workspace.innerText()));
            if (
              !theme.endsWith('-hc') &&
              ((width === 900 && scale === 1.5) || (width === 1200 && scale === 1))
            ) {
              await page.screenshot({
                path: resolve(
                  out,
                  'settings-' +
                    name.split(' ')[0].toLowerCase() +
                    '-' +
                    width +
                    '-' +
                    theme +
                    '.png',
                ),
              });
            }
            states++;
          }
        }
      }
    }
    await page.setViewportSize({ width: 1200, height: 800 });
    await workspace.getByRole('tab', { name: 'Appearance', exact: true }).click();
    await page.getByLabel('Interface scale percent', { exact: true }).fill('125');
    await workspace.getByRole('tab', { name: 'Monitoring', exact: true }).click();
    await page.getByLabel('Exact scan interval (seconds)', { exact: true }).fill('0');
    assert(await page.getByRole('button', { name: 'Save settings', exact: true }).isDisabled());
    await page.getByLabel('Exact scan interval (seconds)', { exact: true }).fill('17');
    assert.deepEqual(await page.evaluate(() => window.settingsWrites), []);
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await page.getByText('Settings saved', { exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.settingsWrites), [
      { uiScale: 1.25, scanIntervalSec: 17 },
    ]);
    assert.deepEqual(errors, []);
    console.log(
      'Settings: ' +
        states +
        ' layouts; persistent save bar, numeric validation, previews and exact patch saving passed.',
    );
  } finally {
    await page.close();
  }
}
