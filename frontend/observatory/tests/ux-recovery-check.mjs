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
    const banner = page.locator('.notification.sensitive');
    await banner.getByRole('button', { name: 'Review', exact: true }).focus();
    await page.waitForTimeout(8100);
    assert(await banner.isVisible(), 'focused sensitive review must survive expiry');
    assert(
      await banner
        .getByRole('button', { name: 'Review', exact: true })
        .evaluate((element) => element === document.activeElement),
      'expiry must preserve the focused review control',
    );
    await page.screenshot({ path: resolve(out, 'ux-sensitive-toast-focused.png') });
    await page.keyboard.press('Tab');
    assert(
      await banner
        .getByRole('button', { name: 'Dismiss notification' })
        .evaluate((element) => element === document.activeElement),
    );
    await page.keyboard.press('Enter');
    const alerts = page.getByRole('button', { name: /^Sensitive activity review/ });
    await page.waitForFunction(() =>
      document.activeElement?.getAttribute('aria-label')?.startsWith('Sensitive activity review'),
    );
    assert.equal(await banner.count(), 0);
    await page.keyboard.press('Enter');
    const review = page.getByRole('dialog', { name: 'Sensitive activity review', exact: true });
    await review.waitFor();
    assert(
      (await review.innerText()).includes('need review'),
      'dismissal must retain review history',
    );
    await page.keyboard.press('Escape');
    assert(await alerts.evaluate((element) => element === document.activeElement));
    await go('Settings');
    assert.equal(await page.getByLabel('Interface scale', { exact: true }).innerText(), '100%');
    assert.equal(await page.getByLabel('Interface scale percent', { exact: true }).count(), 0);
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
      '11px',
    );
    const plot = await page.locator('.plot-area').first().boundingBox();
    assert(plot && plot.y < 510, 'minimum window must expose part of the graph');
    await page.screenshot({ path: resolve(out, 'ux-compact-statistics.png') });
    await go('Agents');
    await page.getByRole('button', { name: 'Open', exact: true }).first().focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.activeElement?.id === 'agent-workspace-heading');
    assert.equal(await page.getByRole('tablist', { name: 'Agent sections' }).count(), 0);
    const resources = page
      .getByRole('region', { name: 'Agent context summary' })
      .getByRole('button', { name: /^Resources/ });
    await resources.focus();
    await page.keyboard.press('Enter');
    assert(
      await page
        .getByRole('region', { name: 'Resources', exact: true })
        .evaluate((node) => node === document.activeElement),
    );
    assert(await page.getByRole('region', { name: 'Resources', exact: true }).isVisible());
    await go('Settings');
    const settingsNavigation = page.getByRole('navigation', { name: 'Settings sections' });
    await settingsNavigation.getByRole('button', { name: 'Monitoring', exact: true }).click();
    await page.getByLabel('Exact scan interval (seconds)', { exact: true }).fill('0');
    await settingsNavigation.getByRole('button', { name: 'Appearance', exact: true }).click();
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
    await settingsNavigation.getByRole('button', { name: 'Appearance', exact: true }).click();
    const theme = page.getByRole('combobox', { name: 'Theme', exact: true });
    await theme.selectOption('light-hc');
    await page.getByRole('button', { name: 'Toggle theme', exact: true }).click();
    assert.equal(await theme.inputValue(), 'light-hc', 'shell theme must preserve the draft');
    assert(await page.getByText('Unsaved changes', { exact: true }).isVisible());
    await go('Monitoring');
    await go('Settings');
    assert.equal(await theme.inputValue(), 'light-hc', 'navigation must preserve the theme draft');
    await theme.scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(out, 'ux-theme-draft-retained.png') });
    await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
    assert(await page.getByRole('button', { name: 'Save settings', exact: true }).isDisabled());
  } finally {
    await page.close();
  }
}
