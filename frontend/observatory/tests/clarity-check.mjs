import assert from 'node:assert/strict';
import { resolve } from 'node:path';

/** Verify the score-to-process path with measured fixture causes at supported sizes.
 * @param {import('playwright').Browser} browser Browser
 * @param {string} url Desktop build @param {string} out Artifact directory
 * @returns {Promise<void>} Verified workflows @since 0.14.1
 */
export async function checkClarity(browser, url, out) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.addInitScript(() => {
      const listeners = {};
      window.clarityFixture = listeners;
      window.aegis = new Proxy(
        {},
        {
          get: (_, method) => {
            if (method.startsWith('on'))
              return (cb) => {
                listeners[method] = cb;
                return () => {};
              };
            return async () =>
              method === 'getSettings'
                ? { darkMode: true, uiScale: 1 }
                : method === 'getFalsePositives'
                  ? []
                  : {};
          },
        },
      );
    });
    await page.goto(url);
    await page.getByRole('heading', { name: 'Agent radar', exact: true }).waitFor();
    await page.evaluate(() => {
      window.clarityFixture.onScanBatch({
        agents: [11, 12].map((pid) => ({
          agent: 'Codex',
          process: 'codex.exe',
          pid,
          instanceId: 'clarity:' + pid,
          instanceIdSource: 'os',
        })),
        stats: {
          appHealth: { populationReliable: true, state: 'HEALTHY' },
          observationGap: { state: 'NONE' },
        },
      });
      window.clarityFixture.onNetworkUpdate([
        {
          instanceId: 'clarity:12',
          verdict: 'unknown',
          remoteIp: '192.0.2.1',
          remotePort: 80,
          httpUnencrypted: true,
        },
      ]);
      window.clarityFixture.onFileAccess([
        {
          instanceId: 'clarity:12',
          agent: 'Codex',
          file: 'X:/Fixture/.ssh/config',
          timestamp: Date.now(),
          sensitive: true,
          reason: 'SSH configuration',
          attribution: { status: 'confirmed' },
        },
      ]);
    });
    await page.getByRole('button', { name: /Highest risk/ }).click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    assert.equal(
      await dialog.getByRole('tab', { name: 'Risk explanation' }).getAttribute('aria-selected'),
      'true',
    );
    assert.match(await dialog.innerText(), /Plain HTTP connections/);
    assert.match(await dialog.innerText(), /SSH \/ cloud credentials/);
    let states = 0;
    for (const width of [900, 1200]) {
      await page.setViewportSize({ width, height: width === 900 ? 600 : 800 });
      for (const scale of [1, 1.5]) {
        for (const theme of ['light', 'dark', 'light-hc', 'dark-hc']) {
          await page.evaluate(
            ({ scale, theme }) => {
              document.documentElement.dataset.theme = theme;
              document.documentElement.style.setProperty('--ui-scale', String(scale));
            },
            { scale, theme },
          );
          const issues = await dialog.evaluate((el) => {
            const r = el.getBoundingClientRect(),
              body = el.querySelector('#modal-body');
            return {
              outside:
                r.left < 0 || r.top < 0 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1,
              overflow: body.scrollWidth > body.clientWidth + 1,
            };
          });
          assert.deepEqual(issues, { outside: false, overflow: false });
          assert.match(
            await dialog.locator('.primary-reason').innerText(),
            /Plain HTTP connections/,
          );
          assert(
            await dialog
              .locator('.primary-reason')
              .evaluate(
                (el) =>
                  el.getBoundingClientRect().bottom <=
                  document.querySelector('#modal-body').getBoundingClientRect().bottom,
              ),
            'main reason requires scrolling',
          );
          await page.screenshot({
            path: resolve(out, 'clarity-' + width + '-' + scale + '-' + theme + '.png'),
          });
          states++;
        }
      }
    }
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.evaluate(() => document.documentElement.style.setProperty('--ui-scale', '1'));
    await dialog.getByRole('button', { name: 'View process PID 12' }).click();
    await dialog.getByText('Agent instance', { exact: true }).waitFor();
    await dialog.getByRole('button', { name: 'Why this score' }).click();
    assert.match(await dialog.innerText(), /Assessment when opened/);
    await dialog.getByRole('button', { name: 'Back', exact: true }).click();
    await dialog.getByRole('button', { name: 'View process PID 12' }).waitFor();
    assert.equal(
      await dialog.getByRole('tab', { name: 'Risk explanation' }).getAttribute('aria-selected'),
      'true',
    );
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    await page.locator('.sidebar').getByRole('button', { name: 'Agents', exact: true }).click();
    await page.getByRole('button', { name: 'Explain risk for Codex' }).click();
    await dialog.getByRole('heading', { name: 'Why this score', exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log(
      'Risk clarity: ' +
        states +
        ' theme/scale/viewport states; summary and table drilldown, actual contributions, highest process and Back passed.',
    );
  } finally {
    await page.close();
  }
}
