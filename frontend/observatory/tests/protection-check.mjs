import assert from 'node:assert/strict';
import { resolve } from 'node:path';

/** Exercise the novice overview before entering detailed monitoring.
 * @param {import('playwright').Browser} browser Browser @param {string} url Synthetic preview
 * @param {string} out Screenshot directory @returns {Promise<void>} Verified @since 0.14.1
 */
export async function checkProtection(browser, url, out) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(url);
    await page.getByRole('heading', { name: 'Agent radar', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Protection overview', exact: true }).click();
    await page.getByRole('region', { name: 'Protection overview' }).waitFor();
    assert.equal(
      await page.locator('.radar-panel:visible').count(),
      0,
      'radar hidden in protection view',
    );
    assert.equal(
      await page.locator('.activity-row').count(),
      8,
      'initial activity must be bounded',
    );
    assert((await page.locator('.activity-row').first().innerText()).includes('Review needed'));
    await page.getByRole('button', { name: 'Unverified', exact: true }).click();
    assert.equal(await page.locator('.activity-row').count(), 4);
    assert(
      (await page.locator('.activity-row').first().innerText()).includes('Connection observed'),
    );
    await page.getByRole('button', { name: 'All activity', exact: true }).click();
    await page.getByLabel('Search agent activity').fill('Codex');
    assert.equal(await page.locator('.activity-row').count(), 3);
    await page.getByLabel('Search agent activity').fill('');
    await page.locator('.activity-row').first().focus();
    await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: 'Understand this activity' }).waitFor();
    assert(
      await page
        .locator('.selection-tools [tabindex]')
        .evaluate((node) => document.activeElement === node),
    );
    await page.getByRole('button', { name: 'Edit this agent’s policy' }).click();
    await page.getByLabel('Target', { exact: true }).waitFor();
    assert.equal(
      await page.getByLabel('Target', { exact: true }).inputValue(),
      'Claude Code::X:/Preview/project-1',
    );
    assert(
      (await page.locator('.policy-explanation').innerText()).includes(
        'automatic blocking is not active',
      ),
    );
    await page.locator('.sidebar').getByRole('button', { name: 'Monitoring', exact: true }).click();
    await page.getByRole('button', { name: 'Close details' }).click();
    assert(
      await page
        .locator('.activity-row')
        .first()
        .evaluate((node) => document.activeElement === node),
    );
    for (const size of [
      { width: 1200, height: 800 },
      { width: 900, height: 600 },
    ]) {
      await page.setViewportSize(size);
      for (const scale of [1, 1.25, 1.5]) {
        for (const theme of ['light', 'dark']) {
          await page.evaluate(
            ({ scale, theme }) => {
              document.documentElement.style.setProperty('--ui-scale', String(scale));
              document.documentElement.dataset.theme = theme;
            },
            { scale, theme },
          );
          for (const selected of [false, true]) {
            if (selected) await page.locator('.activity-row').first().click();
            await page.waitForFunction(() => !document.documentElement.dataset.transitionSurface);
            const overflow = await page.evaluate(() => {
              const nodes = [
                ...document.querySelectorAll(
                  '.protection, .activity-panel, .selection, .status-cards > *, .activity-row',
                ),
              ];
              return nodes
                .filter((node) => node.scrollWidth > node.clientWidth + 2)
                .map((node) => node.className);
            });
            assert.deepEqual(
              overflow,
              [],
              `protection overflow ${size.width}/${scale}/${theme}/${selected}`,
            );
            if (!selected)
              await page.locator('main').evaluate((node) => {
                node.scrollTop = 0;
              });
            await page.screenshot({
              path: resolve(
                out,
                `protection-${size.width}-${scale}-${theme}${selected ? '-detail' : ''}.png`,
              ),
            });
            if (selected) await page.getByRole('button', { name: 'Close details' }).click();
          }
        }
      }
    }
    assert.deepEqual(errors, [], 'protection runtime errors');
    console.log(
      'Protection overview: filters, keyboard focus, exact policy navigation and 24 size/theme/scale/detail checks passed.',
    );
  } finally {
    await page.close();
  }
}
