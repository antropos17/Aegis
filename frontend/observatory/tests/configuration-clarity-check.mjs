import assert from 'node:assert/strict';
import { resolve } from 'node:path';

/** Check configuration controls against the crowded desktop sizes.
 * @param {import('playwright').Browser} browser Browser
 * @param {string} url Preview URL
 * @param {string} out Screenshot directory
 * @returns {Promise<void>} Verified layouts
 * @since v0.16.0-alpha
 */
export async function checkConfigurationClarity(browser, url, out) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(url);
    await page.getByRole('heading', { name: 'Monitoring', level: 1, exact: true }).waitFor();
    for (const { width, height, scale } of [
      { width: 1200, height: 800, scale: 1 },
      { width: 900, height: 600, scale: 1.5 },
    ]) {
      await page.setViewportSize({ width, height });
      await page.evaluate((scale) => {
        document.documentElement.style.setProperty('--ui-scale', String(scale));
      }, scale);
      await page.locator('.sidebar').getByRole('button', { name: 'Rules & permissions' }).click();
      await page.getByRole('button', { name: 'Agent permissions' }).click();
      await page.getByText('Saved preferences · automatic blocking is not active').waitFor();
      await page.locator('.permission-row').last().scrollIntoViewIfNeeded();
      const permissionLayout = await page.evaluate(() => {
        const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
        const rows = document.querySelectorAll('.permission-row');
        return {
          last: rows[rows.length - 1].getBoundingClientRect(),
          save: rect('.permission-save'),
          selects: [...document.querySelectorAll('.target-toolbar select')].map((el) =>
            el.getBoundingClientRect(),
          ),
          mainOverflow:
            document.querySelector('#main').scrollWidth >
            document.querySelector('#main').clientWidth + 2,
        };
      });
      assert(!permissionLayout.mainOverflow, 'permission workspace overflows');
      assert(
        permissionLayout.save.top >= permissionLayout.last.bottom - 1,
        'save bar covers a permission row',
      );
      assert(
        Math.abs(permissionLayout.selects[0].top - permissionLayout.selects[1].top) <= 2,
        'permission target selects are misaligned',
      );
      await page.screenshot({ path: resolve(out, `rules-permissions-${width}.png`) });

      await page.getByRole('button', { name: /Detection rules/ }).click();
      const toggle = page.getByRole('checkbox', {
        name: 'Enable Simulated credential observation',
      });
      await toggle.waitFor();
      assert.equal(
        await page.locator('.rule-meta').isVisible(),
        width === 900,
        'rule metadata does not match the available width',
      );
      assert(await toggle.isChecked(), 'preview rule starts enabled');
      await toggle.click();
      assert(!(await toggle.isChecked()), 'individual rule switch did not change');
      await page.getByRole('button', { name: 'Reload rules' }).click();
      assert(!(await toggle.isChecked()), 'rule state was lost after reload');
      await page.screenshot({ path: resolve(out, `rules-switches-${width}.png`) });
      await toggle.click();
      assert(await toggle.isChecked(), 'preview rule did not return to enabled');

      await page.locator('.sidebar').getByRole('button', { name: 'Agent catalog' }).click();
      await page.getByRole('button', { name: 'Add agent' }).waitFor();
      const catalogLayout = await page.evaluate(() => {
        const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
        const filters = rect('.catalog-filters');
        const actions = rect('.catalog-actions');
        return {
          filters,
          actions,
          toolbar: rect('.catalog-toolbar'),
          mainOverflow:
            document.querySelector('#main').scrollWidth >
            document.querySelector('#main').clientWidth + 2,
        };
      });
      assert(!catalogLayout.mainOverflow, 'catalog workspace overflows');
      assert(
        catalogLayout.filters.right <= catalogLayout.actions.left + 1 ||
          catalogLayout.filters.bottom <= catalogLayout.actions.top + 1,
        'catalog filters overlap actions',
      );
      assert(
        catalogLayout.actions.right <= catalogLayout.toolbar.right + 1,
        'catalog actions extend beyond toolbar',
      );
      await page.screenshot({ path: resolve(out, `catalog-actions-${width}.png`) });
    }
    assert.deepEqual(errors, []);
    console.log(
      'Configuration clarity: 2 viewport/scale layouts, permission rows, rule switches and catalog actions passed.',
    );
  } finally {
    await page.close();
  }
}
