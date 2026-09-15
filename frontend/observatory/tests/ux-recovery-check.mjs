import assert from 'node:assert/strict';
import { resolve } from 'node:path';

/** Verify audit regressions using disposable preview settings.
 * @param {import('playwright').Browser} browser Test browser
 * @param {string} url Preview URL
 * @param {string} out Screenshot directory
 * @returns {Promise<void>} Completion
 * @since 0.15.0
 */
export async function checkUxRecovery(browser, url, out) {
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  try {
    await page.goto(url);
    await page.getByRole('heading', { name: 'Monitoring', exact: true, level: 1 }).waitFor();
    const go = (name) =>
      page.locator('.sidebar').getByRole('button', { name, exact: true }).click();
    await go('Settings');
    await page.getByLabel('Interface scale percent', { exact: true }).fill('150');
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await page.getByText('Settings saved', { exact: true }).waitFor();
    await go('Monitoring');
    const more = page.getByRole('button', { name: 'More metrics', exact: true });
    assert(await more.isVisible());
    assert.equal(await page.locator('.summary-stat:visible').count(), 2);
    await page.screenshot({ path: resolve(out, 'ux-compact-monitoring.png') });
    await more.click();
    assert.equal(await page.locator('.summary-stat:visible').count(), 6);
    assert((await page.locator('.summary').innerText()).includes('subtotal'));
    await page.getByRole('button', { name: 'Fewer metrics', exact: true }).click();
    await go('Statistics');
    assert.equal(
      await page.locator('.coverage-line').evaluate((e) => getComputedStyle(e).fontSize),
      '16.5px',
    );
    const plot = await page.locator('.plot-area').first().boundingBox();
    assert(plot && plot.y < 510, 'minimum window must expose part of the graph');
    await page.screenshot({ path: resolve(out, 'ux-compact-statistics.png') });
    await go('Agents');
    await page.getByRole('button', { name: 'Open', exact: true }).first().focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.activeElement?.id === 'agent-workspace-heading');
    const tabs = page.getByRole('tablist', { name: 'Agent sections' });
    await tabs.getByRole('tab', { name: 'Risk', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(
      await tabs.getByRole('tab', { name: 'Resources', exact: true }).getAttribute('aria-selected'),
      'true',
    );
    await go('Settings');
    await page.getByRole('tab', { name: 'Monitoring', exact: true }).click();
    await page.getByLabel('Exact scan interval (seconds)', { exact: true }).fill('0');
    await page.getByRole('tab', { name: 'Appearance', exact: true }).click();
    const alert = page.locator('.settings-save [role=alert]');
    const box = await alert.boundingBox();
    assert(box && box.y >= 0 && box.y + box.height <= 600, 'validation must stay on screen');
    await page.screenshot({ path: resolve(out, 'ux-visible-validation.png') });
    await page.getByRole('button', { name: 'Fix invalid setting', exact: true }).click();
    const field = page.getByLabel('Exact scan interval (seconds)', { exact: true });
    assert(await field.evaluate((e) => e === document.activeElement));
    assert.equal(await field.getAttribute('aria-describedby'), await alert.getAttribute('id'));
    assert(
      await field.evaluate((e) => {
        const b = e.getBoundingClientRect();
        return document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2) === e;
      }),
      'focused invalid field must not be covered by sticky UI',
    );
    await field.fill('10');
    assert(await page.getByRole('button', { name: 'Save settings', exact: true }).isDisabled());
  } finally {
    await page.close();
  }
}
