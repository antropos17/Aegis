import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/** Exercise nonexecuting action checks only through the explicitly simulated preview.
 * @param {import('playwright').Browser} browser Test browser.
 * @param {string} url Preview URL. @param {string} out Fixed screenshot directory.
 * @returns {Promise<void>} Completion. @since 0.15.1 */
export async function checkActionCoverage(browser, url, out) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const root = page.locator('.action-coverage-workspace');
  const results = page.getByRole('region', { name: 'Action check result', exact: true });
  const geometry = async () => {
    const measured = await root.evaluate((element) => ({
      width: element.clientWidth,
      scroll: element.scrollWidth,
      outside: [...element.querySelectorAll('select, button, .result, .actions li')].filter(
        (node) => {
          const bounds = node.getBoundingClientRect();
          return bounds.width > 0 && (bounds.left < -1 || bounds.right > innerWidth + 1);
        },
      ).length,
    }));
    assert(measured.scroll <= measured.width + 1, 'action check workspace has horizontal overflow');
    assert.equal(measured.outside, 0, 'action check controls or results leave the viewport');
  };
  const rowsReachable = async () => {
    const rows = root.locator('.actions > li');
    assert.equal(await rows.count(), 3);
    for (let index = 0; index < 3; index++) {
      await rows.nth(index).scrollIntoViewIfNeeded();
      assert(await rows.nth(index).isVisible());
      const bounds = await rows.nth(index).boundingBox();
      const viewport = page.viewportSize();
      assert(
        bounds && viewport && bounds.y < viewport.height && bounds.y + bounds.height > 0,
        'catalog row cannot be reached by scrolling',
      );
    }
  };
  try {
    await page.goto(url);
    await page
      .locator('.sidebar')
      .getByRole('button', { name: 'Action control', exact: true })
      .click();
    await page.getByRole('heading', { name: 'No action check yet', exact: true }).waitFor();
    assert(
      await root
        .getByText('Preview · example checks only. No files are selected or read.', { exact: true })
        .isVisible(),
    );
    assert(
      await root
        .getByText('Configuration check only; blocking has not been verified.', { exact: true })
        .isVisible(),
    );
    await page.screenshot({ path: resolve(out, 'action-coverage-empty.png') });
    const route = page.getByLabel('Execution route', { exact: true });
    await route.selectOption('direct');
    await route.focus();
    await page.keyboard.press('Tab');
    const submit = page.getByRole('button', { name: 'Show example check', exact: true });
    assert(
      await submit.evaluate((element) => element === document.activeElement),
      'native Tab should reach check button',
    );
    const focus = await submit.evaluate((element) => {
      const style = getComputedStyle(element);
      return (
        element.matches(':focus-visible') &&
        ((style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) ||
          style.boxShadow !== 'none')
      );
    });
    assert(focus, 'keyboard focus must be visibly styled');
    await page.screenshot({ path: resolve(out, 'action-coverage-keyboard-focus.png') });
    await page.keyboard.press('Enter');
    await results.waitFor();
    const technical = results.locator('details.technical');
    assert.equal(await technical.getAttribute('open'), null, 'technical details start closed');
    const disclosure = technical.locator('summary');
    await disclosure.focus();
    await page.keyboard.press('Enter');
    assert.notEqual(await technical.getAttribute('open'), null, 'Enter expands technical details');
    assert(
      await technical
        .getByText('Not retained as a binding or authorization', { exact: true })
        .isVisible(),
    );
    await page.keyboard.press('Space');
    assert.equal(await technical.getAttribute('open'), null, 'Space collapses technical details');
    assert(await results.getByText('Next step', { exact: true }).isVisible());
    assert(
      await results
        .getByText(
          'Agent connection has not been checked. Protection outside this route is unknown; control of processes started by the selected command is unsupported.',
          { exact: true },
        )
        .isVisible(),
    );
    const captured = await results.locator('.captured').innerText();
    const timestamp = await results.locator('time').getAttribute('datetime');
    await page.getByLabel('Selection type', { exact: true }).selectOption('catalog');
    await route.selectOption('mcp-review');
    assert.equal(
      await results.locator('.captured').innerText(),
      captured,
      'draft changes relabel a retained check',
    );
    assert.equal(await results.locator('time').getAttribute('datetime'), timestamp);
    await page.screenshot({ path: resolve(out, 'action-coverage-retained-draft.png') });
    await submit.click();
    await root.getByRole('heading', { name: 'aegis_action_demo_deny', exact: true }).waitFor();
    for (const decision of ['allow', 'ask', 'deny'])
      assert(
        await root
          .getByRole('heading', { name: 'aegis_action_demo_' + decision, exact: true })
          .isVisible(),
      );
    const catalogCaptured = await results.locator('.captured').innerText();
    await page.locator('.sidebar').getByRole('button', { name: 'Monitoring', exact: true }).click();
    await page
      .locator('.sidebar')
      .getByRole('button', { name: 'Action control', exact: true })
      .click();
    assert.equal(
      await results.locator('.captured').innerText(),
      catalogCaptured,
      'navigation discarded captured check',
    );
    for (const viewport of [
      { width: 1200, height: 800 },
      { width: 900, height: 600 },
    ]) {
      await page.setViewportSize(viewport);
      for (const scale of [1, 1.5])
        for (const theme of ['dark', 'light', 'dark-hc', 'light-hc']) {
          await page.evaluate(
            ({ scale, theme }) => {
              document.documentElement.style.setProperty('--ui-scale', String(scale));
              document.documentElement.dataset.theme = theme;
            },
            { scale, theme },
          );
          await geometry();
          await rowsReachable();
          await results.scrollIntoViewIfNeeded();
          await page.screenshot({
            path: resolve(out, `action-coverage-${viewport.width}-${scale}-${theme}.png`),
          });
        }
    }
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--ui-scale', '2');
      document.documentElement.dataset.theme = 'dark';
    });
    await geometry();
    await rowsReachable();
    await page.screenshot({ path: resolve(out, 'action-coverage-900-2-dark.png') });
    const pt = JSON.parse(
      await readFile(resolve('frontend/observatory/translations/pt-BR.json'), 'utf8'),
    );
    for (const key of [
      'Action control',
      'Selection type',
      'Execution route',
      'Show example check',
      'Action check result',
    ])
      assert(
        typeof pt[key] === 'string' && pt[key] !== key,
        'missing Portuguese action-check translation',
      );
    await page.evaluate(() => localStorage.setItem('aegis.language', 'pt'));
    await page.reload();
    await page
      .locator('.sidebar')
      .getByRole('button', { name: pt['Action control'], exact: true })
      .click();
    await page.getByLabel(pt['Selection type'], { exact: true }).selectOption('catalog');
    await page.getByLabel(pt['Execution route'], { exact: true }).selectOption('mcp-stdio');
    await page.getByRole('button', { name: pt['Show example check'], exact: true }).click();
    const translated = page.getByRole('region', { name: pt['Action check result'], exact: true });
    await translated.waitFor();
    for (const theme of ['dark', 'light', 'dark-hc', 'light-hc']) {
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
        document.documentElement.style.setProperty('--ui-scale', '1.5');
      }, theme);
      await geometry();
      await rowsReachable();
      await translated.scrollIntoViewIfNeeded();
      await page.screenshot({ path: resolve(out, `action-coverage-pt-900-1.5-${theme}.png`) });
    }
    assert.deepEqual(errors, []);
    console.log(
      'Action checks: simulated single/catalog results, retained selection, keyboard focus, 16 English layouts, 200% case and four Portuguese layouts passed.',
    );
  } finally {
    await page.close();
  }
}
