import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// Bounded, disposable browser fixture. Never imports production telemetry or invokes the bridge.
const output = resolve(process.cwd(), 'out/marker-tooltip');
await mkdir(output, { recursive: true });
const server = await createServer({
  configFile: resolve('vite.frontend.config.ts'),
  server: { port: 8794, strictPort: true },
  plugins: [
    {
      name: 'marker-tooltip-fixture',
      configureServer(server) {
        server.middlewares.use('/__marker-tooltip', async (_request, response) => {
          response.setHeader('Content-Type', 'text/html');
          response.end(await server.transformIndexHtml('/__marker-tooltip', html));
        });
      },
    },
  ],
});
const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<main id="fixture" style="padding:24px"></main>
<script type="module">
import '/styles.ts';
import { mount } from 'svelte';
import Fixture from '/tests/MarkerTooltipFixture.svelte';
mount(Fixture, { target: document.querySelector('#fixture') });
</script></body></html>`;
await server.listen();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const receipts = [];
try {
  for (const size of [
    { width: 1200, height: 800 },
    { width: 900, height: 600 },
  ]) {
    await page.setViewportSize(size);
    for (const theme of ['dark', 'light']) {
      await page.goto('http://127.0.0.1:8794/__marker-tooltip');
      await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme);
      const marker = page.locator(
        '.radar-blip[data-group="Agent 1 with an unusually long product name"]',
      );
      await marker.focus();
      await page.keyboard.press('Tab');
      await page.keyboard.press('Shift+Tab');
      await page.getByRole('tooltip').waitFor();
      const geometry = await page.getByRole('tooltip').evaluate((tooltip) => {
        const box = tooltip.getBoundingClientRect();
        const viewport = document.querySelector('.radar-viewport').getBoundingClientRect();
        const target = document
          .querySelector('.radar-blip[aria-describedby]')
          .getBoundingClientRect();
        const css = getComputedStyle(tooltip);
        return {
          width: box.width,
          height: box.height,
          targetWidth: target.width,
          targetHeight: target.height,
          inside:
            box.left >= viewport.left &&
            box.right <= viewport.right &&
            box.top >= viewport.top &&
            box.bottom <= viewport.bottom,
          animation: css.animationName,
          text: tooltip.textContent.trim(),
        };
      });
      await page.screenshot({ path: resolve(output, `${theme}-${size.width}.png`) });
      assert.equal(geometry.inside, true, JSON.stringify({ size, theme, geometry }));
      assert.equal(geometry.targetWidth, 44);
      assert.equal(geometry.targetHeight, 44);
      assert.equal(geometry.animation, 'none');
      await page.screenshot({ path: resolve(output, `${theme}-${size.width}.png`) });
      await page.keyboard.press('Escape');
      assert.equal(await page.getByRole('tooltip').count(), 0);
      await marker.hover();
      await page.getByRole('tooltip').waitFor();
      await page.getByRole('tooltip').hover();
      assert.equal(await page.getByRole('tooltip').count(), 1);
      await page.mouse.move(1, 1);
      assert.match(await page.getByRole('tooltip').textContent(), /Agent 1 with/);
      const other = page.locator('.radar-blip[data-group="Agent 2"]');
      await other.hover();
      assert.match(await page.getByRole('tooltip').textContent(), /Agent 2/);
      await page.mouse.move(1, 1);
      assert.match(await page.getByRole('tooltip').textContent(), /Agent 1 with/);
      assert.equal(await marker.evaluate((element) => element === document.activeElement), true);
      assert.equal(
        await marker.getAttribute('aria-describedby'),
        await page.getByRole('tooltip').getAttribute('id'),
      );
      await other.hover();
      await page.keyboard.press('Escape');
      await page.mouse.move(1, 1);
      await page
        .getByRole('button', { name: 'Update fixture' })
        .evaluate((button) => button.click());
      assert.equal(await page.getByRole('tooltip').count(), 0);
      await other.hover();
      await page.mouse.move(1, 1);
      assert.match(await page.getByRole('tooltip').textContent(), /Agent 1 with/);
      await page.getByRole('button', { name: 'Update fixture' }).focus();
      assert.equal(await page.getByRole('tooltip').count(), 0);
      await marker.focus();
      await page.getByRole('button', { name: 'Update fixture' }).click();
      await marker.focus();
      assert.match(await page.getByRole('tooltip').textContent(), /risk 10\/100/);
      await page.getByRole('button', { name: 'High risk fixture' }).click();
      await marker.focus();
      assert.match(await page.getByRole('tooltip').textContent(), /risk 100\/100/);
      const riskCoordinates = await marker.getAttribute('style');
      for (let index = 0; index < 4; index++)
        await page.getByRole('button', { name: 'Zoom in' }).click();
      assert.equal(await page.getByLabel('Radar zoom', { exact: true }).textContent(), '200%');
      await marker.focus();
      assert.match(await page.getByRole('tooltip').textContent(), /risk 100\/100/);
      assert.equal(await marker.getAttribute('style'), riskCoordinates);
      const zoomChecks = [];
      for (const target of await page.locator('.radar-blip').all()) {
        await target.focus();
        const placement = await page.getByRole('tooltip').evaluate((tooltip) => {
          const box = tooltip.getBoundingClientRect();
          const viewport = document.querySelector('.radar-viewport').getBoundingClientRect();
          const target = document
            .querySelector('.radar-blip[aria-describedby]')
            .getBoundingClientRect();
          return {
            text: tooltip.textContent.trim(),
            targetWidth: target.width,
            targetHeight: target.height,
            inside:
              box.left >= viewport.left &&
              box.right <= viewport.right &&
              box.top >= viewport.top &&
              box.bottom <= viewport.bottom,
          };
        });
        assert.equal(placement.inside, true, JSON.stringify({ size, theme, placement }));
        assert.equal(placement.targetWidth, 44);
        assert.equal(placement.targetHeight, 44);
        zoomChecks.push(placement);
      }
      await marker.focus();
      await page.screenshot({ path: resolve(output, `${theme}-${size.width}-zoom-risk.png`) });
      await page.getByRole('button', { name: 'Reset zoom' }).click();
      await page.getByRole('button', { name: 'Update fixture' }).click();
      await page.getByRole('button', { name: 'Portuguese fixture' }).click();
      await marker.focus();
      assert.match(await page.getByRole('tooltip').textContent(), /processos · risco 10\/100/);
      // Return to English using the fixture's page reload before checking pagination.
      await page.reload();
      await page.getByRole('button', { name: /Select Agent 1 with/ }).focus();
      await page.getByRole('button', { name: 'Next radar agents' }).click();
      assert.equal(await page.getByRole('tooltip').count(), 0);
      receipts.push({
        theme,
        viewportWidth: size.width,
        viewportHeight: size.height,
        mixedInput: true,
        escapeSuppression: true,
        zoom: 200,
        risk: 100,
        zoomChecks,
        ...geometry,
      });
    }
  }
  assert.deepEqual(errors, []);
  const files = [
    'frontend/observatory/components/Radar.svelte',
    'frontend/observatory/components/RadarMarkerTooltip.svelte',
    'frontend/observatory/tests/MarkerTooltipFixture.svelte',
    'frontend/observatory/tests/marker-tooltip-check.mjs',
    'tests/renderer/components/ObservatoryRadarTooltip.test.ts',
    'frontend/observatory/DESIGN.md',
  ];
  const hashes = Object.fromEntries(
    await Promise.all(
      files.map(async (file) => [
        file,
        createHash('sha256')
          .update(await readFile(file))
          .digest('hex'),
      ]),
    ),
  );
  await writeFile(
    resolve(output, 'receipt.json'),
    JSON.stringify({ receipts, errors, hashes }, null, 2),
  );
  console.log(JSON.stringify({ checkedStates: receipts.length, errors, output }));
} finally {
  await browser.close();
  await server.close();
}
