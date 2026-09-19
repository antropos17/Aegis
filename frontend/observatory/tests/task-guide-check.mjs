import assert from 'node:assert/strict';
import { resolve } from 'node:path';

/** Verify guided navigation, retained work and accessible disclosures.
 * @param {import('playwright').Browser} browser Browser @param {string} url Preview URL
 * @param {string} out Screenshots @returns {Promise<void>} Verified @since 0.15.0
 */
export async function checkTaskGuide(browser, url, out) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const open = async () => {
    await page.locator('.topbar').getByRole('button', { name: 'Start here', exact: true }).click();
    await page.getByRole('heading', { name: 'What would you like to do?', exact: true }).waitFor();
  };
  try {
    await page.goto(url);
    await page.getByRole('heading', { name: 'Agent radar', exact: true }).waitFor();
    await open();
    const guide = page.getByRole('region', { name: 'Task guide', exact: true });
    const summary = guide.locator('summary');
    await summary.focus();
    await page.keyboard.press('Enter');
    assert.equal(await guide.locator('details').getAttribute('open'), '');
    assert(
      await guide
        .getByRole('button', { name: 'Open guide: Connect selected actions', exact: true })
        .isDisabled(),
    );
    await summary.press('Space');
    assert.equal(await guide.locator('details').getAttribute('open'), null);
    await guide.getByRole('button', { name: /^Check files before use/ }).click();
    await page.getByRole('button', { name: 'Show example result', exact: true }).click();
    await page.getByRole('heading', { name: 'Findings need review', exact: true }).waitFor();
    await open();
    await guide.getByRole('button', { name: /^Check files before use/ }).click();
    await page.getByRole('heading', { name: 'Findings need review', exact: true }).waitFor();
    await open();
    await guide.getByRole('button', { name: /^Check an action setup/ }).click();
    await page.getByRole('heading', { name: 'Action control', level: 1, exact: true }).waitFor();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await guide.waitFor();
    await page.getByRole('button', { name: 'Commands', exact: false }).click();
    const search = page.getByRole('combobox', { name: 'Find a workspace or action' });
    await search.fill('Check files before use');
    await search.press('Enter');
    await page.getByRole('heading', { name: 'Local security', level: 1, exact: true }).waitFor();
    await open();
    for (const theme of ['light', 'dark', 'light-hc', 'dark-hc']) {
      for (const scale of [1, 1.5, 2]) {
        await page.setViewportSize({
          width: scale === 1 ? 1200 : 900,
          height: scale === 1 ? 800 : 600,
        });
        await page.evaluate(
          ({ theme, scale }) => {
            document.documentElement.dataset.theme = theme;
            document.documentElement.style.setProperty('--ui-scale', String(scale));
          },
          { theme, scale },
        );
        await guide.locator('summary').click();
        await guide
          .getByText(
            'Online guides describe the current source version, which may differ from your installed version.',
            { exact: true },
          )
          .scrollIntoViewIfNeeded();
        assert(
          await page.evaluate(
            () =>
              document.documentElement.scrollWidth <= innerWidth + 2 &&
              document.querySelector('#main').scrollWidth <=
                document.querySelector('#main').clientWidth + 2,
          ),
          `Guide overflow ${theme}/${scale}`,
        );
        await guide.locator('summary').click();
        await page.locator('#main').evaluate((node) => {
          node.scrollTop = 0;
        });
        await page.screenshot({ path: resolve(out, `guide-${theme}-${scale}.png`) });
      }
    }
    await page.evaluate(() => localStorage.setItem('aegis.language', 'pt'));
    await page.reload();
    await page.locator('.topbar').getByRole('button', { name: 'Comece aqui', exact: true }).click();
    await page.getByRole('heading', { name: 'O que você quer fazer?', exact: true }).waitFor();
    await page.screenshot({ path: resolve(out, 'guide-pt.png') });
    assert.deepEqual(errors, []);
    console.log(
      'Task guide: keyboard disclosure, retained review, task search, 12 layouts and Portuguese passed.',
    );
  } finally {
    await page.close();
  }
}
