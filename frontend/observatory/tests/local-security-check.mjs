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
  try {
    await page.goto(url);
    await page
      .locator('.sidebar')
      .getByRole('button', { name: 'Local security', exact: true })
      .click();
    await page.getByRole('heading', { name: 'No local review yet' }).waitFor();
    await page.screenshot({ path: resolve(out, 'local-security-empty.png') });
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
