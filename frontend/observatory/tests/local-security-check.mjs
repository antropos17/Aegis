import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/** Exercise the shared local-review workspace with explicit preview data.
 * @param {import('playwright').Browser} browser Test browser
 * @param {string} url Preview URL @param {string} out Screenshot folder
 * @returns {Promise<void>} Completion @since 0.15.1
 */
export async function checkLocalSecurity(browser, url, out) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const dismissNotifications = async (name = 'Dismiss notification') => {
    for (let count = 0; count < 8; count++) {
      const button = page.getByRole('button', { name, exact: true });
      if (!(await button.count())) break;
      await button.first().click();
    }
  };
  try {
    await page.goto(url);
    await page
      .locator('.sidebar')
      .getByRole('button', { name: 'Local security', exact: true })
      .click();
    await page.getByRole('heading', { name: 'No local review yet' }).waitFor();
    await page.screenshot({ path: resolve(out, 'local-security-empty.png') });
    const comparison = page.getByRole('region', { name: 'Imported result comparison' });
    await comparison.getByRole('button', { name: 'Show example comparison' }).click();
    await comparison.getByText('Stop unconfirmed', { exact: true }).waitFor();
    await comparison.getByText('Inspect captured content', { exact: true }).first().click();
    assert.equal(await comparison.locator('.previews script,.previews img').count(), 0);
    assert(
      (await comparison.locator('.previews').first().textContent()).includes(
        '<script>example</script>',
      ),
    );
    assert(await comparison.getByRole('button', { name: 'Launch unavailable' }).isDisabled());
    assert(
      await comparison.getByRole('button', { name: 'Project export unavailable' }).isDisabled(),
    );
    await dismissNotifications();
    await comparison.locator('.previews').first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(out, 'result-review-captured-preview.png') });
    const search = comparison.getByRole('searchbox', { name: 'Find a changed file' });
    await comparison.getByRole('checkbox', { name: /README.md/ }).check();
    await search.fill('no matching captured file');
    await comparison.getByText('No changes match these filters.', { exact: true }).waitFor();
    assert.equal(await comparison.locator('.change-entry').count(), 0);
    assert(await comparison.getByText('1 selected · 1 outside the current filter').isVisible());
    const resetFilters = comparison.getByRole('button', { name: 'Clear filters', exact: true });
    await resetFilters.focus();
    await page.keyboard.press('Enter');
    assert(await resetFilters.evaluate((button) => button === document.activeElement));
    assert(await comparison.getByRole('checkbox', { name: /README.md/ }).isChecked());
    await comparison.getByLabel('Change type', { exact: true }).selectOption('deletion');
    assert.equal(await comparison.locator('.change-entry').count(), 1);
    assert(await comparison.getByText('1 selected · 1 outside the current filter').isVisible());
    await search.scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(out, 'result-review-filtered-draft.png') });
    await resetFilters.click();
    await comparison.getByRole('button', { name: 'Clear selection', exact: true }).click();
    assert(!(await comparison.getByRole('checkbox', { name: /README.md/ }).isChecked()));
    await page.setViewportSize({ width: 900, height: 600 });
    for (const theme of ['dark', 'light', 'dark-hc', 'light-hc']) {
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
        document.documentElement.style.setProperty('--ui-scale', '1.5');
      }, theme);
      await comparison.scrollIntoViewIfNeeded();
      assert(
        await comparison.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
        'comparison overflow',
      );
      await comparison.getByRole('tab', { name: /^Changes/ }).focus();
      await page.keyboard.press('End');
      assert.equal(
        await comparison
          .getByRole('tab', { name: 'Coverage', exact: true })
          .getAttribute('aria-selected'),
        'true',
      );
      await page.keyboard.press('Home');
      await dismissNotifications();
      await page.screenshot({ path: resolve(out, `result-review-en-900-150-${theme}.png`) });
      await comparison.locator('.previews').first().scrollIntoViewIfNeeded();
      await dismissNotifications();
      await page.screenshot({
        path: resolve(out, `result-review-en-900-150-${theme}-content.png`),
      });
    }
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'dark';
      document.documentElement.style.setProperty('--ui-scale', '1');
    });
    const options = page.locator('.review-options');
    assert.equal(
      await options.getAttribute('open'),
      null,
      'advanced review options should start closed',
    );
    await page.getByText('Review options', { exact: true }).focus();
    await page.keyboard.press('Enter');
    assert.notEqual(
      await options.getAttribute('open'),
      null,
      'native keyboard disclosure should open options',
    );
    await page.getByLabel('Include an offline MCP tools/list file').check();
    await page.getByRole('button', { name: 'Show example result' }).click();
    await page.getByRole('heading', { name: 'Findings need review' }).waitFor();
    assert(await page.getByText('Incomplete coverage', { exact: true }).isVisible());
    assert(await page.getByRole('button', { name: 'Export JSON' }).isDisabled());
    const results = page.getByRole('region', { name: 'Local review results' });
    await page.getByRole('button', { name: 'View captured result', exact: true }).click();
    assert(await results.evaluate((element) => element === document.activeElement));
    assert(
      await results.evaluate((element) =>
        Boolean(
          element.compareDocumentPosition(document.querySelector('.review-setup')) &
          Node.DOCUMENT_POSITION_FOLLOWING,
        ),
      ),
    );
    await page.getByRole('button', { name: 'Change review setup', exact: true }).click();
    assert(
      await page
        .getByRole('button', { name: 'Show example result' })
        .evaluate((element) => element === document.activeElement),
    );
    await page.getByRole('button', { name: 'Review findings', exact: true }).click();
    assert.equal(
      await page.getByRole('tab', { name: /Findings/ }).getAttribute('aria-selected'),
      'true',
    );
    await results.scrollIntoViewIfNeeded();
    await results.locator('.evidence-rows:visible summary').first().click();
    await page.screenshot({ path: resolve(out, 'local-security-findings-dark.png') });
    await page.getByRole('tab', { name: /Scope & coverage/ }).click();
    await page.getByText('Checked scope and limits', { exact: true }).click();
    await page.screenshot({ path: resolve(out, 'local-security-coverage.png') });
    for (const mode of ['inventory', 'compare', 'import']) {
      await page.getByLabel('Review type', { exact: true }).selectOption(mode);
      await page.getByRole('button', { name: 'Show example result' }).click();
      await results.scrollIntoViewIfNeeded();
      if (mode === 'inventory') {
        assert.equal(await page.getByRole('tab', { name: /Findings/ }).count(), 0);
        await page.getByRole('tab', { name: /Packages/ }).click();
        assert(
          await page
            .getByText('Publisher unverified · installation not established', { exact: true })
            .isVisible(),
        );
        await page.getByText('Content snapshot', { exact: true }).click();
        assert(await page.getByRole('button', { name: 'Save unreviewed snapshot' }).isDisabled());
      }
      if (mode === 'compare') {
        assert.equal(await page.getByRole('tab', { name: /Findings/ }).count(), 0);
        assert(await page.getByText('components · changed', { exact: true }).isVisible());
      }
      if (mode === 'import')
        assert(await page.getByText(/External claims are unverified/).isVisible());
      await page.screenshot({ path: resolve(out, `local-security-${mode}.png`) });
    }
    for (const size of [
      { width: 1200, height: 800 },
      { width: 900, height: 600 },
    ]) {
      await page.setViewportSize(size);
      for (const scale of [1, 1.5]) {
        for (const theme of ['dark', 'light']) {
          await page.evaluate(
            ({ scale, theme }) => {
              document.documentElement.style.setProperty('--ui-scale', String(scale));
              document.documentElement.dataset.theme = theme;
            },
            { scale, theme },
          );
          await page.getByLabel('Review type', { exact: true }).selectOption('scan');
          await page.getByRole('button', { name: 'Show example result' }).click();
          await results.scrollIntoViewIfNeeded();
          const geometry = await page.locator('.local-security-workspace').evaluate((root) => ({
            client: root.clientWidth,
            scroll: root.scrollWidth,
            overflowing: [...root.querySelectorAll('input, select, button, summary')].filter(
              (element) => {
                const rect = element.getBoundingClientRect();
                return rect.width && (rect.left < 0 || rect.right > innerWidth + 1);
              },
            ).length,
          }));
          assert(geometry.scroll <= geometry.client + 1, 'local review horizontal overflow');
          assert.equal(geometry.overflowing, 0, 'a local-review control leaves the viewport');
          await page.getByRole('tab', { name: /Findings/ }).focus();
          await page.keyboard.press('End');
          assert.equal(
            await page.getByRole('tab', { name: /Scope & coverage/ }).getAttribute('aria-selected'),
            'true',
          );
          await page.keyboard.press('Home');
          await page.screenshot({
            path: resolve(out, `local-security-${size.width}-${scale}-${theme}.png`),
          });
        }
      }
    }
    await page.locator('.sidebar').getByRole('button', { name: 'Monitoring', exact: true }).click();
    await page
      .locator('.sidebar')
      .getByRole('button', { name: 'Local security', exact: true })
      .click();
    assert(await page.getByRole('heading', { name: 'Findings need review' }).isVisible());
    assert(await comparison.getByText('README.md', { exact: true }).isVisible());
    const pt = JSON.parse(
      await readFile(resolve('frontend/observatory/translations/pt-BR.json'), 'utf8'),
    );
    await page.evaluate(() => localStorage.setItem('aegis.language', 'pt'));
    await page.reload();
    await page
      .locator('.sidebar')
      .getByRole('button', { name: 'Segurança local', exact: true })
      .click();
    await page.getByRole('button', { name: pt['Show example result'], exact: true }).click();
    await page.getByRole('heading', { name: pt['Findings need review'], exact: true }).waitFor();
    await page.getByRole('button', { name: pt['Show example comparison'], exact: true }).click();
    const translatedComparison = page.getByRole('region', {
      name: pt['Imported result comparison'],
    });
    await translatedComparison
      .getByText(pt['Inspect captured content'], { exact: true })
      .first()
      .click();
    for (const theme of ['dark', 'light', 'dark-hc', 'light-hc']) {
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
        document.documentElement.style.setProperty('--ui-scale', '1.5');
      }, theme);
      assert(
        await translatedComparison.evaluate(
          (element) => element.scrollWidth <= element.clientWidth + 1,
        ),
        'translated comparison overflow',
      );
      await translatedComparison.scrollIntoViewIfNeeded();
      await dismissNotifications(pt['Dismiss notification']);
      await page.screenshot({ path: resolve(out, `result-review-pt-900-150-${theme}.png`) });
      await translatedComparison.locator('.previews').first().scrollIntoViewIfNeeded();
      await dismissNotifications(pt['Dismiss notification']);
      await page.screenshot({
        path: resolve(out, `result-review-pt-900-150-${theme}-content.png`),
      });
    }
    for (const theme of ['dark', 'light']) {
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
        document.documentElement.style.setProperty('--ui-scale', '1.5');
      }, theme);
      const translated = page.locator('.local-security-workspace');
      assert(
        await translated.evaluate((root) => root.scrollWidth <= root.clientWidth + 1),
        'Portuguese local review overflows at 900px/150%',
      );
      await page.getByRole('region', { name: pt['Local review results'] }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: resolve(out, `local-security-pt-150-${theme}.png`) });
    }
    assert.deepEqual(errors, []);
    console.log(
      'Local security: four review modes, evidence, coverage, snapshots, keyboard navigation, eight English layouts and two Portuguese 150% layouts passed.',
    );
  } finally {
    await page.close();
  }
}
