import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';

/** Keep empty radar guidance separate from its risk scale at supported UI sizes.
 * @param {import('playwright').Browser} browser Browser
 * @param {string} url Desktop build @param {string} out Artifact directory
 * @returns {Promise<void>} Measured waiting, empty and populated states @since 0.20.1
 */
export async function checkRadarMessages(browser, url, out) {
  const measurements = [];
  for (const scale of [1.25, 1]) {
    const page = await browser.newPage({ viewport: { width: 1024, height: 720 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    try {
      await page.addInitScript((scale) => {
        localStorage.setItem('aegis-advanced-mode', 'true');
        localStorage.setItem('aegis-motion', 'reduce');
        const listeners = {};
        const stats = { appHealth: { state: 'HEALTHY', populationReliable: true } };
        window.radarMessageFixture = (agents) => listeners.onScanBatch({ agents, stats });
        window.aegis = new Proxy(
          {},
          {
            get: (_, method) => {
              if (typeof method !== 'string') return undefined;
              if (method.startsWith('on'))
                return (callback) => {
                  listeners[method] = callback;
                  return () => {
                    delete listeners[method];
                  };
                };
              return async () =>
                method === 'getSettings'
                  ? { darkMode: true, uiScale: scale }
                  : method === 'getStats'
                    ? stats
                    : method === 'getFalsePositives'
                      ? []
                      : {};
            },
          },
        );
      }, scale);
      await page.goto(url);
      await page.getByRole('heading', { name: 'Agent radar', exact: true }).waitFor();
      await page.evaluate((scale) => {
        document.documentElement.style.setProperty('--ui-scale', String(scale));
      }, scale);
      const message = page.locator('.radar-message');
      const footer = page.locator('.radar-scale:visible');
      for (const state of ['waiting', 'empty', 'populated']) {
        if (state !== 'waiting')
          await page.evaluate((populated) => {
            window.radarMessageFixture(
              populated
                ? [
                    {
                      agent: 'Codex',
                      process: 'codex.exe',
                      pid: 101,
                      instanceId: 'radar-message:101',
                      instanceIdSource: 'os',
                    },
                  ]
                : [],
            );
          }, state === 'populated');
        if (state === 'populated') {
          await page.locator('.radar-blip').waitFor();
          assert.equal(await message.count(), 0, 'populated radar has no empty message');
        } else {
          await page
            .getByText(
              state === 'waiting' ? 'Waiting for a reliable scan' : 'No agents in this snapshot',
              { exact: true },
            )
            .last()
            .waitFor();
        }
        await footer.scrollIntoViewIfNeeded();
        const geometry = await footer.evaluate((node) => {
          const bounds = (element) => {
            const { top, bottom, left, right } = element.getBoundingClientRect();
            return { top, bottom, left, right };
          };
          const stage = node.closest('.radar-stage');
          const visible = (element) => {
            const style = getComputedStyle(element);
            const box = element.getBoundingClientRect();
            return (
              style.display !== 'none' &&
              style.visibility === 'visible' &&
              Number(style.opacity) > 0 &&
              box.width > 0 &&
              box.height > 0
            );
          };
          const message = stage.querySelector('.radar-message');
          return {
            footer: bounds(node),
            stage: bounds(stage),
            panel: bounds(node.closest('.radar-panel')),
            main: bounds(document.querySelector('#main')),
            actualScale: Number(
              getComputedStyle(document.documentElement).getPropertyValue('--ui-scale'),
            ),
            footerVisible: visible(node),
            messageVisible: message ? visible(message) : null,
            message: message ? bounds(message) : null,
          };
        });
        assert.equal(geometry.actualScale, scale, 'requested UI scale is applied');
        assert(geometry.footerVisible, 'risk scale remains rendered');
        if (state !== 'populated') {
          assert(geometry.messageVisible, 'empty/waiting message remains rendered');
          assert(
            geometry.message.bottom <= geometry.footer.top,
            `radar guidance overlaps scale: ${JSON.stringify({ state, scale, geometry })}`,
          );
          assert(geometry.message.top >= geometry.stage.top);
        }
        for (const box of [geometry.footer, geometry.message].filter(Boolean)) {
          assert(box.top >= Math.max(0, geometry.main.top, geometry.panel.top));
          assert(box.bottom <= Math.min(720, geometry.main.bottom, geometry.panel.bottom));
          assert(box.left >= Math.max(0, geometry.main.left, geometry.panel.left));
          assert(box.right <= Math.min(1024, geometry.main.right, geometry.panel.right));
        }
        assert(geometry.footer.bottom <= geometry.stage.bottom);
        measurements.push({ state, scale, viewport: { width: 1024, height: 720 }, ...geometry });
        await page.screenshot({ path: resolve(out, `radar-message-${state}-${scale}.png`) });
      }
      assert.deepEqual(errors, [], 'radar message browser errors');
    } finally {
      await page.close();
    }
  }
  await writeFile(
    resolve(out, 'radar-message-geometry.json'),
    JSON.stringify(measurements, null, 2),
  );
  console.log(
    `Radar messages: ${measurements.length} waiting/empty/populated scale states passed.`,
  );
}

/** Verify the score-to-process path with measured fixture causes at supported sizes.
 * @param {import('playwright').Browser} browser Browser
 * @param {string} url Desktop build @param {string} out Artifact directory
 * @returns {Promise<void>} Verified workflows @since 0.14.1
 */
export async function checkClarity(browser, url, out) {
  await checkRadarMessages(browser, url, out);
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
    assert(await workspace.getByRole('region', { name: 'Observed risk', exact: true }).isVisible());
    assert.equal(await workspace.getByRole('tablist', { name: 'Agent sections' }).count(), 0);
    assert.match(await workspace.innerText(), /Plain HTTP connections/);
    assert.match(await workspace.innerText(), /SSH \/ cloud credentials/);
    let states = 0;
    for (const width of [900, 1200]) {
      await page.setViewportSize({ width, height: width === 900 ? 600 : 800 });
      for (const scale of [1]) {
        for (const theme of ['light', 'dark', 'light-hc', 'dark-hc']) {
          await page.evaluate(
            ({ scale, theme }) => {
              document.documentElement.dataset.theme = theme;
              document.documentElement.style.setProperty('--ui-scale', String(scale));
            },
            { scale, theme },
          );
          await page.locator('#main').evaluate((node) => {
            node.scrollTop = 0;
          });
          assert(
            await page.evaluate(
              () =>
                document.querySelector('#main').scrollWidth <=
                document.querySelector('#main').clientWidth + 1,
            ),
            'risk workspace overflows',
          );
          assert.match(
            await workspace.locator('.risk-reason').innerText(),
            /Plain HTTP connections/,
          );
          const reasonBounds = await workspace.locator('.risk-reason').evaluate((node) => {
            const reason = node.getBoundingClientRect();
            const main = document.querySelector('#main').getBoundingClientRect();
            return {
              top: reason.top,
              bottom: reason.bottom,
              visibleTop: main.top,
              visibleBottom: main.bottom,
            };
          });
          if (
            reasonBounds.top < reasonBounds.visibleTop ||
            reasonBounds.bottom > reasonBounds.visibleBottom
          ) {
            await page.screenshot({
              path: resolve(out, `clarity-failure-${width}-${scale}-${theme}.png`),
            });
            console.error(JSON.stringify({ width, scale, theme, reasonBounds }));
          }
          assert(
            reasonBounds.top >= reasonBounds.visibleTop &&
              reasonBounds.bottom <= reasonBounds.visibleBottom,
            `main reason is covered or needs scrolling (${width}/${scale}/${theme})`,
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
    assert(await workspace.getByRole('region', { name: 'Observed risk', exact: true }).isVisible());
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
