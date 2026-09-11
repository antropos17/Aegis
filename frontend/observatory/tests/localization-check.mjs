import assert from 'node:assert/strict';
import { resolve } from 'node:path';

/** Verify saved locale, translated navigation and radar layouts in both color families.
 * @param {import('playwright').Browser} browser Browser @param {string} url Preview URL
 * @param {string} out Screenshot directory @returns {Promise<void>} Verified @since 0.14.1
 */
export async function checkLocalization(browser, url, out) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(url);
    await page.getByRole('heading', { name: 'Agent radar', exact: true }).waitFor();
    await page.locator('.sidebar').getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByLabel('Language', { exact: true }).selectOption('pt');
    await page.getByRole('heading', { name: 'Configurações', exact: true, level: 1 }).waitFor();
    assert.equal(await page.locator('html').getAttribute('lang'), 'pt-BR');
    await page.reload();
    await page.getByRole('heading', { name: 'Radar de agentes', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => localStorage.getItem('aegis.language')), 'pt');
    await page.getByRole('button', { name: 'Comandos', exact: false }).click();
    await page.getByRole('combobox', { name: 'Buscar área ou ação' }).fill('Configurações');
    assert((await page.getByRole('option').count()) > 0, 'Portuguese command search failed');
    await page.getByRole('button', { name: 'Fechar comandos' }).click();
    const headings = [
      'Agentes',
      'Estatísticas',
      'Eventos',
      'Rede',
      'Auditoria',
      'Análise por IA',
      'Relatórios',
      'Regras e permissões',
      'Catálogo de agentes',
      'Configurações',
      'Monitoramento',
    ];
    for (const name of headings) {
      await page.locator('.sidebar').getByRole('button', { name, exact: true }).click();
      await page.getByRole('heading', { name, exact: true, level: 1 }).waitFor();
    }
    for (const theme of ['light', 'dark', 'light-hc', 'dark-hc']) {
      for (const width of [900, 1200]) {
        for (const scale of [1, 1.5]) {
          await page.setViewportSize({ width, height: width === 900 ? 600 : 800 });
          await page.evaluate(
            ({ theme, scale }) => {
              document.documentElement.dataset.theme = theme;
              document.documentElement.style.setProperty('--ui-scale', String(scale));
            },
            { theme, scale },
          );
          const fits = await page.locator('.radar-panel').evaluate((node) => {
            const rect = node.getBoundingClientRect();
            return rect.left >= 0 && rect.right <= innerWidth + 1;
          });
          assert(fits, `Portuguese radar overflow: ${theme}/${width}/${scale}`);
          if (width === 1200 && scale === 1) {
            await page.screenshot({ path: resolve(out, `radar-pt-${theme}.png`) });
          }
        }
      }
    }
    await page.setViewportSize({ width: 1200, height: 800 });
    await page
      .locator('.sidebar')
      .getByRole('button', { name: 'Configurações', exact: true })
      .click();
    await page.screenshot({ path: resolve(out, 'settings-pt-150.png') });
    await page.getByLabel('Idioma', { exact: true }).selectOption('en');
    await page.getByRole('heading', { name: 'Settings', level: 1, exact: true }).waitFor();
    await page.evaluate(() => localStorage.setItem('aegis.language', 'unsupported'));
    await page.reload();
    await page.getByRole('heading', { name: 'Agent radar', exact: true }).waitFor();
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    assert.deepEqual(errors, []);
    console.log(
      'Localization: 11 workspaces, saved locale, command search and 16 radar layouts passed.',
    );
  } finally {
    await page.close();
  }
}
