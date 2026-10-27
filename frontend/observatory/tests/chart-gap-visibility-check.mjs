import assert from 'node:assert/strict';

/** Check the real preview chart's explanation at narrow and desktop widths.
 * @param {import('playwright').Browser} browser Fixture browser
 * @param {string} url Synthetic preview URL
 * @returns {Promise<void>} Completed check @since 0.19.2
 */
export async function checkChartGapVisibility(browser, url) {
  for (const [lang, navigation, expected] of [
    ['en', 'Statistics', 'Gaps mean unavailable data.'],
    ['pt', 'Estatísticas', 'Lacunas indicam dados indisponíveis.'],
  ]) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await page.addInitScript((locale) => localStorage.setItem('aegis.language', locale), lang);
      await page.goto(url);
      await page.locator('.sidebar').getByRole('button', { name: navigation, exact: true }).click();
      const explanation = page.locator('.monitor-summary p').filter({ hasText: expected });
      await explanation.waitFor();
      for (const width of [620, 900]) {
        await page.setViewportSize({ width, height: 900 });
        await explanation.waitFor({ state: 'visible' });
        assert.equal(
          await explanation.isVisible(),
          true,
          `explanation hidden at ${width}px (${lang})`,
        );
        const bounds = await explanation.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          const parent = element.closest('.monitor-detail').getBoundingClientRect();
          return {
            left: rect.left,
            right: rect.right,
            parentLeft: parent.left,
            parentRight: parent.right,
            viewportWidth: window.innerWidth,
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth,
          };
        });
        assert.ok(
          bounds.left >= Math.max(0, bounds.parentLeft) &&
            bounds.right <= Math.min(bounds.viewportWidth, bounds.parentRight) &&
            bounds.scrollWidth <= bounds.clientWidth + 1,
          `explanation overflows at ${width}px (${lang}): ${JSON.stringify(bounds)}`,
        );
      }
      assert.deepEqual(errors, []);
    } finally {
      await page.close();
    }
  }
  console.log('Chart gap explanation: 620 and 900 px in English and Portuguese passed.');
}
