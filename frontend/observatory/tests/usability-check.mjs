import assert from 'node:assert/strict';
import { resolve } from 'node:path';

/** Check one shared agent context across the live workspaces.
 * @param {import('playwright').Browser} browser Browser @param {string} url Preview
 * @param {string} out Screenshot directory @returns {Promise<void>} Verified @since 0.14.1
 */
export async function checkUsability(browser, url, out) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const settle = () =>
    page.waitForFunction(() => !document.documentElement.dataset.transitionSurface);
  const context = page.locator('.agent-context');
  const agent = context.getByLabel('Selected agent', { exact: true });
  const process = context.getByLabel('Selected process', { exact: true });
  const go = async (name) => {
    await page.locator('.sidebar').getByRole('button', { name, exact: true }).click();
    await settle();
  };
  try {
    await page.goto(url);
    await page.getByRole('heading', { name: 'Agent radar', exact: true }).waitFor();
    for (const [width, height, scale] of [
      [1200, 800, 1],
      [900, 600, 1.5],
    ]) {
      await page.setViewportSize({ width, height });
      for (const theme of ['dark', 'light']) {
        await page.evaluate(
          ({ theme, scale }) => {
            document.documentElement.dataset.theme = theme;
            document.documentElement.style.setProperty('--ui-scale', String(scale));
          },
          { theme, scale },
        );
        await page.emulateMedia({ reducedMotion: width === 900 ? 'reduce' : 'no-preference' });
        await go('Monitoring');
        assert.equal(await context.count(), 0, 'Monitoring must not expose a selected-agent scope');
        assert(
          await page
            .locator('.sidebar nav')
            .evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
          'sidebar text overflows at enlarged scale',
        );
        for (const layer of ['Files', 'Network', 'Radar']) {
          await page
            .locator('.radar-layers')
            .getByRole('button', { name: layer, exact: true })
            .click();
          assert.equal(
            await page.locator('.radar-stage:visible').count(),
            layer === 'Radar' ? 1 : 0,
          );
          assert.equal(
            await page.locator('.resource-explorer:visible').count(),
            layer === 'Radar' ? 0 : 1,
          );
          assert(
            await page
              .locator('#main')
              .evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
            'layer overflows the workspace',
          );
        }
        const monitoringScroll = await page.locator('#main').evaluate((node) => {
          node.scrollTop = 120;
          return node.scrollTop;
        });
        // Trigger the same click handler without Playwright first scrolling the source page.
        await page.getByRole('button', { name: /Select Codex,/ }).evaluate((node) => node.click());
        await page
          .getByRole('button', { name: 'Open agent', exact: true })
          .evaluate((node) => node.click());
        await page.locator('.agent-workspace:visible').waitFor();
        assert.equal(await page.getByRole('dialog').count(), 0, 'agent opened in a modal');
        assert.equal(await agent.inputValue(), 'Codex');
        assert.equal(
          await page.locator('#main').evaluate((node) => node.scrollTop),
          0,
          'opening an agent scrolls past its context',
        );
        await process.selectOption({ index: 1 });
        const selectedProcess = await process.inputValue();
        assert(selectedProcess, 'fixture lacks a stamped process');
        await page.getByRole('heading', { name: 'Process overview', exact: true }).waitFor();
        await page
          .getByRole('tablist', { name: 'Agent sections' })
          .getByRole('tab', { name: 'Risk', exact: true })
          .click();
        assert(await page.locator('.agent-risk details').evaluate((node) => node.open));
        await page
          .getByRole('tablist', { name: 'Agent sections' })
          .getByRole('tab', { name: 'Processes', exact: true })
          .click();
        assert(await page.getByRole('region', { name: 'Agent worker processes' }).isVisible());
        assert.equal(await page.getByRole('dialog').count(), 0);
        for (const view of ['Events', 'Network', 'Statistics']) {
          await go(view);
          assert.equal(await agent.inputValue(), 'Codex', view + ' lost agent context');
          assert.equal(await process.inputValue(), selectedProcess, view + ' lost process context');
          assert.equal(await page.locator('.agent-context').count(), 1);
        }
        assert.equal(
          await page.getByLabel('Statistics agent', { exact: true }).count(),
          0,
          'duplicate selector returned',
        );
        assert.equal(await page.locator('.plot:visible').count(), 1);
        assert.equal(await page.locator('.metric-rail svg').count(), 0);
        const rail = page.locator('.metric-rail button:visible');
        let graphY = null;
        for (let i = 0; i < (await rail.count()); i++) {
          await rail.nth(i).click();
          const y = await page
            .locator('.plot:visible')
            .evaluate(
              (node) =>
                node.getBoundingClientRect().top + document.querySelector('#main').scrollTop,
            );
          if (graphY !== null) assert(Math.abs(y - graphY) < 2, 'metric choice moved the plot');
          graphY = y;
        }
        await page.getByRole('tab', { name: 'Tokens', exact: true }).click();
        assert.equal(await process.inputValue(), selectedProcess);
        await page.getByRole('tab', { name: 'Sensors', exact: true }).click();
        assert.equal(
          await process.inputValue(),
          selectedProcess,
          'sensor view discarded selection',
        );
        await page.getByRole('tab', { name: 'Performance', exact: true }).click();
        assert.equal(await process.inputValue(), selectedProcess);
        const filterScroll = await page.locator('#main').evaluate((node) => {
          node.scrollTop = 80;
          return node.scrollTop;
        });
        await process.evaluate((node) => {
          node.value = '';
          node.dispatchEvent(new Event('change', { bubbles: true }));
        });
        assert.equal(
          await page.locator('#main').evaluate((node) => node.scrollTop),
          filterScroll,
          'changing the process filter jumped to the page top',
        );
        await process.evaluate((node, id) => {
          node.value = id;
          node.dispatchEvent(new Event('change', { bubbles: true }));
        }, selectedProcess);
        await page.locator('#main').evaluate((node) => {
          node.scrollTop = 0;
        });
        assert(
          await page.evaluate(
            () =>
              document.querySelector('#main').scrollWidth <=
                document.querySelector('#main').clientWidth + 2 &&
              document.documentElement.scrollWidth <= innerWidth + 2,
          ),
          'scoped statistics overflow',
        );
        await page.screenshot({
          path: resolve(out, 'usability-statistics-' + theme + '-' + width + '.png'),
        });
        await page.getByRole('button', { name: 'Back', exact: true }).click();
        await page.getByRole('heading', { name: 'Network', level: 1, exact: true }).waitFor();
        assert.equal(await process.inputValue(), selectedProcess, 'Back lost process context');
        await go('Monitoring');
        await page.getByRole('heading', { name: 'Monitoring', level: 1, exact: true }).waitFor();
        assert.equal(await page.locator('.agent-workspace:visible').count(), 0);
        assert.equal(await context.count(), 0);
        assert.equal(
          await page.locator('#main').evaluate((node) => node.scrollTop),
          monitoringScroll,
          'opening an agent overwrote the source workspace scroll',
        );
        await page.getByRole('heading', { name: 'Agent radar', exact: true }).waitFor();
        await go('Statistics');
        assert.equal(
          await process.inputValue(),
          selectedProcess,
          'Monitoring discarded investigation scope',
        );
        const dimensions = await page.evaluate(() => {
          const size = (selector) => {
            const element = document.querySelector(selector);
            const style = getComputedStyle(element);
            return {
              height: element.getBoundingClientRect().height,
              font: parseFloat(style.fontSize),
              radius: style.borderRadius,
            };
          };
          return {
            agent: size('.agent-context select'),
            action: size('.agent-context .button'),
            period: size('.statistics-workspace .monitor select'),
            latest: size('.statistics-workspace .scrubber .button'),
            metric: parseFloat(
              getComputedStyle(document.querySelector('.statistics-workspace .metric-rail strong'))
                .fontSize,
            ),
          };
        });
        for (const control of [dimensions.action, dimensions.period, dimensions.latest]) {
          assert(
            Math.abs(control.height - dimensions.agent.height) <= 1,
            'inconsistent control heights',
          );
          assert.equal(control.radius, dimensions.agent.radius, 'inconsistent control corners');
          assert.equal(control.font, dimensions.agent.font, 'inconsistent control typography');
        }
        assert.equal(dimensions.metric, 12 * scale, 'metric rail ignores UI scale');
        await go('Agents');
        await process.selectOption('');
        await page.getByRole('heading', { name: 'Agent overview', exact: true }).waitFor();
        assert.equal(await agent.inputValue(), 'Codex');
        await agent.selectOption('');
      }
    }
    assert.deepEqual(errors, []);
    console.log(
      'Usability: four theme/viewport/scale states; shared agent/process in Events, Network and Statistics; in-page agent/risk/process workflows; stable graph; Back and no overflow passed.',
    );
  } finally {
    await page.close();
  }
}
