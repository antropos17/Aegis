import assert from 'node:assert/strict';
import { resolve } from 'node:path';

/** Check related navigation and every internal workspace section.
 * @param {import('playwright').Browser} browser Browser @param {string} url Preview
 * @param {string} out Screenshots @returns {Promise<void>} Verified @since 0.14.1
 */
export async function checkComfort(browser, url, out) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const settled = async () => {
    await page.waitForFunction(() => !document.documentElement.dataset.transitionSurface);
    await page.waitForTimeout(180);
  };
  const navigate = async (name) => {
    await page.locator('.sidebar').getByRole('button', { name, exact: true }).click();
    await settled();
    assert(
      (await page.locator('.workspace-tabs [role=tab]').count()) <= 3,
      'workspace strip grows without bounds',
    );
  };
  let checks = 0;
  try {
    await page.goto(url);
    await page.getByRole('heading', { name: 'Monitoring', level: 1, exact: true }).waitFor();
    for (const size of [
      { width: 1200, height: 800 },
      { width: 900, height: 600 },
    ]) {
      await page.setViewportSize(size);
      for (const theme of ['dark', 'light']) {
        await page.evaluate(
          ({ theme, scale }) => {
            document.documentElement.dataset.theme = theme;
            document.documentElement.style.setProperty('--ui-scale', String(scale));
          },
          { theme, scale: size.width === 900 ? 1.5 : 1 },
        );
        for (const view of ['Agents', 'Statistics', 'Settings', 'Reports', 'Audit']) {
          await navigate(view);
          const tabs = page
            .locator('#content > div:not([hidden]) .section-tabs')
            .first()
            .getByRole('tab');
          const labels = await tabs.allTextContents();
          for (const label of labels) {
            await tabs.filter({ hasText: label.trim() }).click();
            await settled();
            const dimensions = await page.evaluate(() => ({
              document: document.documentElement.scrollWidth <= innerWidth + 2,
              main:
                document.querySelector('#main').scrollWidth <=
                document.querySelector('#main').clientWidth + 2,
              selected: [...document.querySelectorAll('.section-tabs [aria-selected=true]')].filter(
                (el) => el.checkVisibility(),
              ).length,
            }));
            assert(dimensions.document && dimensions.main, view + ' overflows viewport');
            assert(dimensions.selected > 0, view + ' has no active section');
            if (view === 'Statistics') {
              const rail = page.locator('.metric-rail:visible button');
              const count = await rail.count();
              for (let index = 0; index < count; index++) {
                await rail.nth(index).click();
                assert.equal(await rail.nth(index).getAttribute('aria-pressed'), 'true');
                assert(await page.locator('.plot:visible').getAttribute('aria-label'));
              }
            }
            checks++;
          }
          await page.locator('#main').evaluate((el) => (el.scrollTop = 0));
          await page.screenshot({
            path: resolve(
              out,
              'comfort-' + view.toLowerCase() + '-' + theme + '-' + size.width + '.png',
            ),
          });
        }
      }
    }
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.evaluate(() => document.documentElement.style.setProperty('--ui-scale', '1'));
    await page.getByRole('button', { name: 'Commands', exact: false }).click();
    const search = page.getByRole('combobox', { name: 'Find a workspace or action' });
    await search.fill('Statistics Tokens');
    await search.press('Enter');
    await page.getByRole('heading', { name: 'Statistics', level: 1, exact: true }).waitFor();
    await settled();
    assert.equal(
      await page.getByRole('tab', { name: 'Tokens', exact: true }).getAttribute('aria-selected'),
      'true',
    );
    await page.getByRole('button', { name: 'Pause view', exact: true }).click();
    const paused = await page.locator('.coverage-line').innerText();
    await page.waitForTimeout(2200);
    assert.equal(
      await page.locator('.coverage-line').innerText(),
      paused,
      'paused Statistics collected new samples',
    );
    assert.match(await page.locator('.live-state').innerText(), /paused/i);
    await page.getByRole('button', { name: 'Resume view', exact: true }).click();
    await page.getByRole('button', { name: 'Commands', exact: false }).click();
    await search.fill('Appearance');
    await search.press('Enter');
    await page.getByRole('heading', { name: 'Settings', level: 1, exact: true }).waitFor();
    await settled();
    assert.equal(
      await page
        .getByRole('tab', { name: 'Appearance', exact: true })
        .getAttribute('aria-selected'),
      'true',
    );
    await page.getByRole('tab', { name: 'Monitoring', exact: true }).click();
    await page.getByLabel('Scan interval (seconds)').fill('17');
    await navigate('Events');
    await navigate('Settings');
    assert.equal(await page.getByLabel('Scan interval (seconds)').inputValue(), '17');
    await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
    await navigate('Monitoring');
    await page.keyboard.press('Control+k');
    await search.fill('never-existing-destination');
    await page.getByText('No matching destination.', { exact: true }).waitFor();
    assert.equal(
      await page.getByRole('listbox', { name: 'Destinations' }).getByRole('option').count(),
      0,
    );
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.deepEqual(errors, []);
    console.log(
      'Comfort: ' +
        checks +
        ' internal section layouts, metric switching, related navigation, deep search, paused history and retained drafts passed.',
    );
  } finally {
    await page.close();
  }
}
