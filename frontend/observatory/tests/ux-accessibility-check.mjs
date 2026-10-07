import assert from 'node:assert/strict';
import { resolve } from 'node:path';

/** Check keyboard recovery and focus geometry using disposable preview data.
 * @param {import('playwright').Browser} browser Browser
 * @param {string} url Preview URL
 * @param {string} out Screenshot directory
 * @returns {Promise<void>} Completion
 * @since 0.19.0
 */
export async function checkUxAccessibility(browser, url, out) {
  const page = await browser.newPage({
    viewport: { width: 900, height: 600 },
    reducedMotion: 'reduce',
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const settle = () =>
    page.waitForFunction(() => !document.documentElement.dataset.transitionSurface);
  const go = async (name) => {
    await page.locator('.sidebar').getByRole('button', { name, exact: true }).click();
    await settle();
  };
  const frames = () =>
    page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
  try {
    await page.goto(url);
    await page.getByRole('heading', { name: 'Monitoring', exact: true, level: 1 }).waitFor();
    await page.getByRole('button', { name: /^Commands/ }).click();
    const input = page.getByRole('combobox', { name: 'Find a workspace or action' });
    await input.focus();
    assert.equal(
      await page.locator('.command-results').getByRole('option').count(),
      24,
      'existing destinations remain available',
    );
    await page.keyboard.press('ArrowDown');
    const selected = await input.getAttribute('aria-activedescendant');
    assert.equal(await page.locator('#' + selected).getAttribute('aria-selected'), 'true');
    assert(await input.evaluate((node) => node === document.activeElement));
    await page.keyboard.press('Tab');
    await frames();
    // Chromium can visit browser chrome between the last and first modal controls.
    // That position is represented by body; it must not visit the result options.
    if (await page.evaluate(() => document.activeElement === document.body))
      await page.keyboard.press('Tab');
    assert(
      await page
        .getByRole('button', { name: 'Close commands' })
        .evaluate((node) => node === document.activeElement),
      'Tab must skip command options',
    );
    await page.keyboard.press('Tab');
    assert(await input.evaluate((node) => node === document.activeElement));
    await input.fill('no-match-ux-fixture');
    const status = page.locator('.command-feedback [role=status]');
    await status.getByText('No matching destination.', { exact: true }).waitFor();
    assert.equal(await input.getAttribute('aria-activedescendant'), null);
    assert.equal(await input.getAttribute('aria-expanded'), 'false');
    await page.keyboard.press('Tab');
    assert(
      await page
        .getByRole('button', { name: 'Clear search', exact: true })
        .evaluate((node) => node === document.activeElement),
    );
    await page.keyboard.press('Enter');
    assert.equal(await input.inputValue(), '');
    assert(await input.evaluate((node) => node === document.activeElement));
    await status.getByText('24 destinations', { exact: true }).waitFor();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await settle();

    await go('Agent catalog');
    const signature = page.locator('.signature-links button').first();
    assert.equal(await signature.evaluate((node) => getComputedStyle(node).fontSize), '11px');
    await go('Settings');
    assert.equal(await page.getByLabel('Interface scale', { exact: true }).innerText(), '100%');
    assert.equal(
      await page
        .locator('html')
        .evaluate((node) => getComputedStyle(node).getPropertyValue('--ui-scale').trim()),
      '1',
    );
    for (const theme of ['dark', 'light']) {
      await page.getByLabel('Theme', { exact: true }).selectOption(theme);
      if (await page.getByRole('button', { name: 'Save settings', exact: true }).isEnabled()) {
        await page.getByRole('button', { name: 'Save settings', exact: true }).click();
        await page.getByText('Settings saved', { exact: true }).waitFor();
      }
      await page.locator('#main').focus();
      let checked = 0;
      for (let step = 0; step < 20; step++) {
        await page.keyboard.press('Tab');
        await frames();
        const sample = await page.evaluate(() => {
          const field = document.activeElement;
          const settings = field?.closest('.settings-workspace');
          if (!settings || field.closest('.settings-save, .section-navigation')) return null;
          if (field.matches('h2')) return null;
          const rect = field.getBoundingClientRect();
          const bar = settings.querySelector('.settings-save').getBoundingClientRect();
          const main = document.querySelector('#main').getBoundingClientRect();
          const header = document.querySelector('.page-head').getBoundingClientRect();
          const visible = [
            [0.1, 0.1],
            [0.9, 0.1],
            [0.5, 0.5],
            [0.1, 0.9],
            [0.9, 0.9],
          ].every(([x, y]) => {
            const hit = document.elementFromPoint(
              rect.x + rect.width * x,
              rect.y + rect.height * y,
            );
            return field === hit || field.contains(hit);
          });
          return {
            label: field.getAttribute('aria-label'),
            visible,
            top: rect.top,
            bottom: rect.bottom,
            contentTop: Math.max(main.top, header.bottom),
            barTop: bar.top,
          };
        });
        if (!sample) continue;
        assert(
          sample.visible && sample.top >= sample.contentTop && sample.bottom <= sample.barTop,
          'focused setting covered: ' + JSON.stringify(sample),
        );
        checked++;
        if (sample.label === 'Language')
          await page.screenshot({ path: resolve(out, 'ux-focus-language-' + theme + '.png') });
      }
      assert(checked >= 7, 'settings focus test did not reach the controls');
      await page.getByLabel('Language', { exact: true }).focus();
      await frames();
      const scroll = await page.locator('#main').evaluate((node) => node.scrollTop);
      await page
        .getByRole('navigation', { name: 'Settings sections' })
        .getByRole('button', { name: 'Appearance', exact: true })
        .evaluate((node) => node.focus({ preventScroll: true }));
      await frames();
      assert.equal(
        await page.locator('#main').evaluate((node) => node.scrollTop),
        scroll,
        'focusing on-page navigation must preserve workspace scroll',
      );
    }

    await page
      .getByRole('navigation', { name: 'Settings sections' })
      .getByRole('button', { name: 'Data & help', exact: true })
      .click();
    await page.getByRole('checkbox', { name: 'Single-key shortcuts', exact: true }).uncheck();
    await page.reload();
    await page.getByRole('heading', { name: 'Monitoring', exact: true, level: 1 }).waitFor();
    const theme = await page.locator('html').getAttribute('data-theme');
    await page.locator('#main').focus();
    for (const key of ['s', 't', '1', '2', '3', '4', '5']) await page.keyboard.press(key);
    assert.equal(await page.locator('h1').innerText(), 'Monitoring');
    assert.equal(await page.locator('html').getAttribute('data-theme'), theme);
    await page.keyboard.press('Control+k');
    assert(
      await input.evaluate((node) => node === document.activeElement),
      'Ctrl K stays available',
    );
    await page.keyboard.press('Escape');
    await go('Settings');
    await page
      .getByRole('navigation', { name: 'Settings sections' })
      .getByRole('button', { name: 'Data & help', exact: true })
      .click();
    const shortcuts = page.getByRole('checkbox', { name: 'Single-key shortcuts', exact: true });
    assert.equal(await shortcuts.isChecked(), false, 'shortcut preference survives reload');
    await shortcuts.check();
    await go('Monitoring');
    await page.keyboard.press('s');
    await page.getByRole('heading', { name: 'Settings', exact: true, level: 1 }).waitFor();
    await page
      .getByRole('navigation', { name: 'Settings sections' })
      .getByRole('button', { name: 'Appearance', exact: true })
      .click();
    assert.equal(await page.getByLabel('Interface scale', { exact: true }).innerText(), '100%');

    await go('Agent catalog');
    assert.equal(await signature.evaluate((node) => getComputedStyle(node).fontSize), '11px');
    assert(await signature.evaluate((node) => node.getBoundingClientRect().height >= 24));
    assert.equal(
      await page.locator('.catalog-count').evaluate((node) => getComputedStyle(node).fontSize),
      '11px',
    );
    await page.getByRole('button', { name: 'Add agent', exact: true }).click();
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('UX disposable agent');
    await page.getByRole('tab', { name: 'Recognition', exact: true }).click();
    await page
      .getByRole('textbox', { name: 'Process name', exact: true })
      .fill('ux-disposable.exe');
    await page.getByRole('button', { name: 'Save agent', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    const search = page.getByRole('searchbox', { name: 'Search catalog' });
    await search.fill('UX disposable agent');
    const row = page.getByRole('row').filter({ hasText: 'UX disposable agent' });
    const remove = row.getByRole('button', { name: 'Delete', exact: true });
    await remove.click();
    const dialog = page.getByRole('dialog', { name: 'Delete custom agent?' });
    assert(
      await dialog
        .getByRole('button', { name: 'Cancel', exact: true })
        .evaluate((node) => node === document.activeElement),
    );
    await page.screenshot({ path: resolve(out, 'ux-delete-confirmation.png') });
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert(await remove.evaluate((node) => node === document.activeElement));
    assert(await row.isVisible(), 'Escape must preserve the custom agent');
    await remove.click();
    await dialog.getByRole('button', { name: 'Delete agent', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await row.count(), 0);
    assert(await search.evaluate((node) => node === document.activeElement));
    await page
      .locator('.catalog-feedback[role=status]')
      .getByText('Custom agent UX disposable agent removed.', { exact: true })
      .waitFor();
    await page.screenshot({ path: resolve(out, 'ux-delete-completed.png') });
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}
