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
    const workspace = page.locator('.agent-workspace:visible');
    const context = page.locator('.agent-context');
    await workspace.waitFor();
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert(await workspace.locator('#agent-risk details').evaluate((node) => node.open));
    assert.match(await workspace.innerText(), /Plain HTTP connections/);
    assert.match(await workspace.innerText(), /SSH \/ cloud credentials/);
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
          await workspace
            .getByRole('navigation', { name: 'Agent sections' })
            .getByRole('button', { name: 'Risk', exact: true })
            .click();
          assert(
            await page.evaluate(
              () =>
                document.querySelector('#main').scrollWidth <=
                document.querySelector('#main').clientWidth + 1,
            ),
            'risk workspace overflows',
          );
          assert.match(
            await workspace.locator('.primary-reason').innerText(),
            /Plain HTTP connections/,
          );
          assert(
            await workspace
              .locator('.risk-reason')
              .evaluate(
                (node) =>
                  node.getBoundingClientRect().top >= 0 &&
                  node.getBoundingClientRect().bottom <= innerHeight,
              ),
            'main reason requires another navigation',
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
    await workspace.getByRole('button', { name: 'View process PID 12' }).click();
    await page.getByRole('heading', { name: 'Process overview', exact: true }).waitFor();
    assert.equal(
      await context.getByLabel('Selected process', { exact: true }).inputValue(),
      'clarity:12',
    );
    assert.equal(await page.getByRole('dialog').count(), 0);
    await workspace
      .getByRole('navigation', { name: 'Agent sections' })
      .getByRole('button', { name: 'Risk', exact: true })
      .click();
    assert.match(
      await workspace.locator('.risk-explanation').innerText(),
      /Plain HTTP connections/,
    );
    await context.getByLabel('Selected process', { exact: true }).selectOption('');
    await workspace.getByRole('button', { name: 'View process PID 12' }).waitFor();
    await context.getByLabel('Selected agent', { exact: true }).selectOption('');
    await page.locator('.sidebar').getByRole('button', { name: 'Agents', exact: true }).click();
    await page.getByRole('button', { name: 'Explain risk for Codex' }).click();
    await workspace.getByRole('heading', { name: 'Why this score', exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log(
      'Risk clarity: ' +
        states +
        ' theme/scale/viewport states; summary and table entry points, actual contributions, direct highest process and shared context passed.',
    );
  } finally {
    await page.close();
  }
}
