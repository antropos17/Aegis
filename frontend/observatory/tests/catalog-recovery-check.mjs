import assert from 'node:assert/strict';
import { resolve } from 'node:path';

/** Check failed reads and confirmed-write recovery against an offline production bridge.
 * @param {import('playwright').Browser} browser Browser
 * @param {string} url Production build URL
 * @param {string} out Screenshot directory
 * @returns {Promise<void>} Verified retained catalog and read-only retry
 * @since 0.19.2
 */
export async function checkCatalogRecovery(browser, url, out) {
  for (const { width, height, scale } of [
    { width: 900, height: 600, scale: 1.5 },
    { width: 1200, height: 800, scale: 1 },
  ]) {
    for (const theme of ['dark', 'light']) {
      const page = await browser.newPage({ viewport: { width, height } });
      const prefix = `catalog-recovery-${width}-${theme}`;
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route('**/*', (route) =>
        new URL(route.request().url()).origin === new URL(url).origin
          ? route.continue()
          : route.abort(),
      );
      try {
        await page.addInitScript(
          ({ theme, scale }) => {
            window.catalogDenied = true;
            window.catalogWrites = 0;
            window.catalogCustom = [
              { id: 'saved-fixture', displayName: 'Saved fixture', names: ['fixture.exe'] },
            ];
            window.aegis = new Proxy(
              {},
              {
                get: (_, method) => {
                  if (typeof method !== 'string') return undefined;
                  if (method.startsWith('on')) return () => () => {};
                  if (method === 'getSettings')
                    return async () => ({ darkMode: theme === 'dark', uiScale: scale });
                  if (method === 'getAppVersion') return async () => 'Offline catalog recovery';
                  if (method === 'getAgentDatabase')
                    return async () =>
                      window.catalogDenied
                        ? { success: false, error: 'Fixture denied' }
                        : {
                            agents: [
                              {
                                id: 'bundled-fixture',
                                displayName: 'Bundled fixture',
                                names: ['bundled.exe'],
                              },
                            ],
                          };
                  if (method === 'getCustomAgents') return async () => window.catalogCustom;
                  if (method === 'saveCustomAgents')
                    return async (next) => {
                      window.catalogWrites++;
                      window.catalogCustom = structuredClone(next);
                      window.catalogDenied = true;
                      return { success: true };
                    };
                  return async () => [];
                },
              },
            );
          },
          { theme, scale },
        );
        await page.goto(url);
        await page
          .locator('.sidebar')
          .getByRole('button', { name: 'Agent catalog', exact: true })
          .click();
        await page.getByRole('alert').filter({ hasText: 'Catalog reply is invalid' }).waitFor();
        assert(await page.getByRole('button', { name: 'Add agent', exact: true }).isDisabled());
        assert.equal(await page.getByText('No agents in the catalog', { exact: true }).count(), 0);
        assert.equal(await page.locator('.catalog-count').count(), 0);
        await page.screenshot({ path: resolve(out, `${prefix}-denied-read.png`) });
        await page.evaluate(() => {
          window.catalogDenied = false;
        });
        await page.getByRole('button', { name: 'Retry loading', exact: true }).click();
        const original = page.getByRole('row').filter({ hasText: 'Saved fixture' });
        await original.waitFor();
        const edit = original.getByRole('button', { name: 'Edit', exact: true });
        await edit.click();
        const dialog = page.getByRole('dialog', { name: 'Edit custom agent', exact: true });
        await dialog.getByLabel('Name', { exact: true }).fill('Confirmed fixture');
        await dialog.getByRole('button', { name: 'Save agent', exact: true }).click();
        await dialog.waitFor({ state: 'hidden' });
        const confirmed = page.getByRole('row').filter({ hasText: 'Confirmed fixture' });
        await confirmed.waitFor();
        assert(
          await confirmed
            .getByRole('button', { name: 'Edit', exact: true })
            .evaluate((element) => element === document.activeElement),
          'confirmed save must restore the enabled editor trigger',
        );
        const notice = page.getByRole('status').filter({
          hasText: 'Catalog changes saved. Could not refresh the current catalog. Retry loading.',
        });
        await notice.waitFor();
        const noticeBox = await notice.boundingBox();
        const mainBox = await page.locator('#main').boundingBox();
        assert(
          noticeBox &&
            mainBox &&
            noticeBox.y >= mainBox.y &&
            noticeBox.y + noticeBox.height <= mainBox.y + mainBox.height,
          'confirmed-save feedback must remain inside the visible content area',
        );
        assert(await page.getByText('Bundled fixture', { exact: true }).isVisible());
        assert.equal(await page.evaluate(() => window.catalogWrites), 1);
        await page.screenshot({ path: resolve(out, `${prefix}-confirmed-refresh-failure.png`) });
        await page.evaluate(() => {
          window.catalogDenied = false;
        });
        await page.getByRole('button', { name: 'Retry loading', exact: true }).click();
        await notice.waitFor({ state: 'hidden' });
        assert(await confirmed.isVisible());
        assert.equal(
          await page.evaluate(() => window.catalogWrites),
          1,
          'loading must not repeat a write',
        );
        assert.deepEqual(errors, []);
        console.log(
          'Catalog recovery: denied read, confirmed edit, focus and read-only retry passed',
        );
      } finally {
        await page.close();
      }
    }
  }
}
