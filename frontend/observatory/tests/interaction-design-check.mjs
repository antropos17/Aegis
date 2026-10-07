import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';

/** Check readable hierarchy and stable pointer/keyboard feedback in rendered themes.
 * @param {import('playwright').Browser} browser Test browser
 * @param {string} url Preview URL
 * @param {string} out Evidence directory
 * @returns {Promise<void>} Completion
 * @since 0.19.2
 */
export async function checkInteractionDesign(browser, url, out) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const measurements = [];
  try {
    await page.goto(url);
    await page.getByRole('heading', { level: 1, name: 'Monitoring', exact: true }).waitFor();
    const button = page.locator('.sidebar').getByRole('button', { name: 'Events', exact: true });
    for (const theme of ['light', 'dark', 'light-hc', 'dark-hc']) {
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
      }, theme);
      const palette = await page.evaluate(() => {
        const style = getComputedStyle(document.documentElement);
        const context = document.createElement('canvas').getContext('2d');
        const luminance = (color) => {
          context.fillStyle = color;
          context.fillRect(0, 0, 1, 1);
          const rgb = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map((v) => {
            const n = v / 255;
            return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
          });
          return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
        };
        const contrast = (a, b) => {
          const values = [a, b].map((token) => luminance(style.getPropertyValue(token).trim()));
          return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
        };
        return {
          primary: contrast('--ink', '--panel'),
          secondary: contrast('--muted', '--panel'),
          caption: contrast('--faint', '--sidebar'),
          hover: contrast('--ink', '--interaction-hover'),
          pressed: contrast('--ink', '--interaction-pressed'),
          control: contrast('--control-border', '--bg'),
          focus: Math.min(
            ...['--bg', '--panel', '--sidebar', '--raised', '--interaction-hover'].map((surface) =>
              contrast('--focus', surface),
            ),
          ),
        };
      });
      for (const key of ['primary', 'secondary', 'caption', 'hover', 'pressed']) {
        assert(palette[key] >= 4.5, `${theme} ${key} text contrast ${palette[key]}`);
      }
      assert(palette.primary > palette.secondary, `${theme} primary hierarchy is not distinct`);
      assert(palette.control >= 3, `${theme} input boundary contrast ${palette.control}`);
      assert(palette.focus >= 3, `${theme} focus contrast ${palette.focus}`);
      await page.mouse.move(0, 0);
      const before = await button.boundingBox();
      const idle = await button.evaluate((node) => getComputedStyle(node).backgroundColor);
      await button.hover();
      await page.waitForTimeout(180);
      assert.notEqual(
        await button.evaluate((node) => getComputedStyle(node).backgroundColor),
        idle,
      );
      assert.deepEqual(await button.boundingBox(), before, 'hover moved the navigation target');
      await page.mouse.down();
      assert.deepEqual(await button.boundingBox(), before, 'press resized the navigation target');
      await page.mouse.move(0, 0);
      await page.mouse.up();
      await button.focus();
      await page.keyboard.press('Tab');
      const focused = page.locator(':focus');
      const ring = await focused.evaluate((node) => {
        const style = getComputedStyle(node);
        return {
          visible: node.matches(':focus-visible'),
          width: parseFloat(style.outlineWidth),
          style: style.outlineStyle,
        };
      });
      assert(
        ring.visible && ring.width >= 2 && ring.style === 'solid',
        `${theme} keyboard focus is missing`,
      );
      await page.screenshot({ path: resolve(out, `interaction-focus-${theme}.png`) });
      measurements.push({ theme, ...palette });
    }
    await page.emulateMedia({ forcedColors: 'active' });
    await button.focus();
    await page.keyboard.press('Tab');
    assert(
      await page.locator(':focus').evaluate((node) => {
        const style = getComputedStyle(node);
        return style.outlineStyle === 'solid' && parseFloat(style.outlineWidth) >= 2;
      }),
      'forced-colors focus is missing',
    );
    await writeFile(
      resolve(out, 'interaction-contrast.json'),
      JSON.stringify(measurements, null, 2) + '\n',
    );
    console.log(
      'Interaction design: four theme palettes, focus indicators, forced colors and stable hover/press targets passed.',
    );
  } finally {
    await page.close();
  }
}
