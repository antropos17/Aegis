import assert from 'node:assert/strict';
import { resolve } from 'node:path';

/** Check agent scope and stable layout under user selection.
 * @param {import('playwright').Browser} browser Browser @param {string} url Preview
 * @param {string} out Screenshot directory @returns {Promise<void>} Verified @since 0.14.1
 */
export async function checkUsability(browser, url, out) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const settle = () =>
    page.waitForFunction(() => !document.documentElement.dataset.transitionSurface);
  try {
    await page.goto(url);
    await page.getByRole('heading', { name: 'Agent radar', exact: true }).waitFor();
    for (const [width, height, scale] of [
      [1200, 800, 1],
      [900, 600, 1.5],
    ]) {
      await page.setViewportSize({ width, height });
      for (const theme of ['dark', 'light']) {
        await page.evaluate(
          ({ theme, scale }) => {
            document.documentElement.dataset.theme = theme;
            document.documentElement.style.setProperty('--ui-scale', String(scale));
          },
          { theme, scale },
        );
        await page.emulateMedia({ reducedMotion: width === 900 ? 'reduce' : 'no-preference' });
        await page
          .locator('.sidebar')
          .getByRole('button', { name: 'Monitoring', exact: true })
          .click();
        await settle();
        const heights = () =>
          page.evaluate(() =>
            ['.radar-panel', '.radar-stage', '.inspector'].map(
              (selector) => document.querySelector(selector).getBoundingClientRect().height,
            ),
          );
        const before = await heights();
        for (const layer of ['Files', 'Network', 'Radar']) {
          await page
            .locator('.radar-layers')
            .getByRole('button', { name: layer, exact: true })
            .click();
          assert.deepEqual(await heights(), before, 'radar layer moved surrounding content');
        }
        for (let i = 0; i < 4; i++) {
          await page.locator('.radar-agent-card').nth(i).click();
          assert.deepEqual(await heights(), before, 'agent selection resized its panel');
        }
        await page.getByRole('button', { name: /Select Codex,/ }).click();
        await page.getByRole('button', { name: 'Agent statistics', exact: true }).click();
        await settle();
        assert.equal(await page.getByLabel('Statistics agent').inputValue(), 'Codex');
        assert.equal(await page.locator('.plot:visible').count(), 1);
        assert.equal(await page.locator('.metric-rail svg').count(), 0);
        const rail = page.locator('.metric-rail button:visible');
        let graphY = null;
        for (let i = 0; i < (await rail.count()); i++) {
          await rail.nth(i).click();
          const y = await page
            .locator('.plot:visible')
            .evaluate(
              (node) =>
                node.getBoundingClientRect().top + document.querySelector('#main').scrollTop,
            );
          if (graphY !== null) assert(Math.abs(y - graphY) < 2, 'metric choice moved the plot');
          graphY = y;
        }
        await page.getByLabel('Statistics process').selectOption({ index: 1 });
        const process = await page.getByLabel('Statistics process').inputValue();
        await page.getByRole('tab', { name: 'Tokens', exact: true }).click();
        assert.equal(await page.getByLabel('Statistics process').inputValue(), process);
        await page.getByRole('tab', { name: 'Sensors', exact: true }).click();
        assert(await page.getByLabel('Statistics agent').isDisabled());
        await page.getByRole('tab', { name: 'Performance', exact: true }).click();
        assert.equal(await page.getByLabel('Statistics process').inputValue(), process);
        await page.locator('#main').evaluate((node) => {
          node.scrollTop = 0;
        });
        const overflow = await page.evaluate(() => {
          const main = document.querySelector('#main');
          return (
            main.scrollWidth > main.clientWidth + 2 ||
            document.documentElement.scrollWidth > innerWidth + 2
          );
        });
        assert(!overflow, 'scoped statistics overflow');
        await page.screenshot({
          path: resolve(out, 'usability-statistics-' + theme + '-' + width + '.png'),
        });
        await page.getByRole('button', { name: 'Back', exact: true }).click();
        await settle();
        await page.getByRole('heading', { name: 'Monitoring', level: 1, exact: true }).waitFor();
      }
    }
    assert.deepEqual(errors, []);
    console.log(
      'Usability: four theme/viewport/scale states; stable radar and inspector dimensions, stable metric plot, direct agent statistics, process selection, Back and no overflow passed.',
    );
  } finally {
    await page.close();
  }
}
