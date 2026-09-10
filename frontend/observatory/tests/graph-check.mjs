import assert from 'node:assert/strict';
import { resolve } from 'node:path';
export async function checkGraphs(browser, url, out) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const settle = async () => {
    await page.waitForFunction(() => !document.documentElement.dataset.transitionSurface);
    await page.mouse.move(0, 0);
  };
  try {
    await page.goto(url);
    await page.locator('.sidebar').getByRole('button', { name: 'Statistics', exact: true }).click();
    await page.getByRole('heading', { name: 'Statistics', level: 1, exact: true }).waitFor();
    await page.waitForFunction(
      () => document.querySelectorAll('.plot circle').length >= 2,
      undefined,
      { timeout: 30000 },
    );
    let checks = 0;
    for (const size of [
      { width: 1200, height: 800 },
      { width: 900, height: 600 },
    ]) {
      await page.setViewportSize(size);
      for (const theme of ['dark', 'light', 'dark-hc', 'light-hc']) {
        await page.evaluate(
          ({ theme, scale }) => {
            document.documentElement.dataset.theme = theme;
            document.documentElement.style.setProperty('--ui-scale', String(scale));
          },
          { theme, scale: size.width === 900 ? 1.5 : 1 },
        );
        for (const name of ['Performance', 'Activity', 'Tokens', 'Sensors']) {
          await page.locator('.stats-navigation').getByRole('tab', { name, exact: true }).click();
          await settle();
          for (const duration of ['60000', '180000', '300000']) {
            await page
              .getByRole('combobox', { name: 'Performance history length' })
              .selectOption(duration);
            const label = await page.locator('.plot').getAttribute('aria-label');
            assert(label.includes(Number(duration) / 1000 + ' seconds'), label);
          }
          await page
            .getByRole('combobox', { name: 'Performance history length' })
            .selectOption('60000');
          const geo = await page.evaluate(() => {
            const m = document.querySelector('#main');
            return (
              document.documentElement.scrollWidth <= innerWidth + 2 &&
              m.scrollWidth <= m.clientWidth + 2
            );
          });
          assert(geo, name + ' overflow');
          await page.locator('#main').evaluate((el) => (el.scrollTop = 0));
          if (theme === 'dark' || theme === 'light')
            await page.screenshot({
              path: resolve(
                out,
                'graph-' + name.toLowerCase() + '-' + theme + '-' + size.width + '.png',
              ),
            });
          checks++;
        }
      }
    }
    await page.setViewportSize({ width: 1200, height: 800 });
    await page
      .locator('.stats-navigation')
      .getByRole('tab', { name: 'Performance', exact: true })
      .click();
    await page.getByRole('button', { name: 'Pause view', exact: true }).click();
    await settle();
    const paths = await page
      .locator('.plot path')
      .evaluateAll((els) => els.map((el) => el.getAttribute('d')));
    const value = await page.locator('.monitor-detail .current').innerText();
    await page.waitForTimeout(2200);
    assert.deepEqual(
      await page.locator('.plot path').evaluateAll((els) => els.map((el) => el.getAttribute('d'))),
      paths,
      'paused graph moved',
    );
    assert.equal(
      await page.locator('.monitor-detail .current').innerText(),
      value,
      'paused value changed',
    );
    await page.getByRole('button', { name: 'Resume view', exact: true }).click();
    await page.waitForTimeout(2200);
    assert.notDeepEqual(
      await page.locator('.plot path').evaluateAll((els) => els.map((el) => el.getAttribute('d'))),
      paths,
      'resumed graph did not advance',
    );
    assert.deepEqual(errors, []);
    console.log(
      'Graphs: ' +
        checks +
        ' theme/viewport/section states; fixed time windows, real points and pause/resume passed.',
    );
  } finally {
    await page.close();
  }
}
