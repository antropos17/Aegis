import assert from 'node:assert/strict';
import { resolve } from 'node:path';

/** Verify detail navigation and layout with isolated desktop telemetry.
 * @param {import('playwright').Browser} browser Browser @param {string} url Build URL
 * @param {string} out Screenshot directory @returns {Promise<void>} Checked @since 0.14.1
 */
export async function checkDetails(browser, url, out) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const settled = () =>
    page.waitForFunction(() => !document.documentElement.dataset.transitionSurface);
  const tab = (name) => page.getByRole('dialog').getByRole('tab', { name });
  const checkLayout = async () => {
    await settled();
    await page.getByRole('dialog').evaluate(async (dialog) => {
      await Promise.all(
        dialog
          .getAnimations({ subtree: true })
          .filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime))
          .map((animation) => animation.finished.catch(() => {})),
      );
    });
    const result = await page.getByRole('dialog').evaluate((dialog) => {
      const box = dialog.getBoundingClientRect();
      const body = dialog.querySelector('#modal-body, .editor-body');
      const header = dialog.querySelector('.modal-head').getBoundingClientRect();
      const footer = dialog.querySelector('.modal-actions').getBoundingClientRect();
      return {
        outside:
          box.x < 0 || box.y < 0 || box.right > innerWidth + 1 || box.bottom > innerHeight + 1,
        overflow: body.scrollWidth > body.clientWidth + 1,
        clipped: header.top < box.top || footer.bottom > box.bottom,
        panels: [...dialog.querySelectorAll('[role=tabpanel]')].filter((p) => !p.hidden).length,
        raw: !!dialog.querySelector('pre') || /DO-NOT-DISPLAY/.test(dialog.textContent),
      };
    });
    assert.deepEqual(result, {
      outside: false,
      overflow: false,
      clipped: false,
      panels: 1,
      raw: false,
    });
  };
  try {
    await page.addInitScript(() => {
      const listeners = {};
      window.detailFixture = listeners;
      window.aegis = new Proxy(
        {},
        {
          get: (_, method) => {
            if (method.startsWith('on'))
              return (callback) => {
                listeners[method] = callback;
                return () => delete listeners[method];
              };
            return async () =>
              method === 'getSettings'
                ? { darkMode: true, uiScale: 1 }
                : method === 'getAppVersion'
                  ? 'Test'
                  : method === 'getAgentDatabase'
                    ? {
                        agents: [
                          {
                            id: 'codex',
                            displayName: 'Codex',
                            vendor: 'OpenAI',
                            category: 'CLI',
                            names: ['codex.exe'],
                            knownDomains: ['api.openai.com'],
                            description: 'Coding agent',
                          },
                        ],
                      }
                    : method === 'getCustomAgents' || method === 'getFalsePositives'
                      ? []
                      : {};
          },
        },
      );
    });
    await page.goto(url);
    await page.getByRole('heading', { name: 'Agent radar', exact: true }).waitFor();
    await page.evaluate(() => {
      const agents = Array.from({ length: 26 }, (_, i) => ({
        agent: 'Codex',
        pid: 200 + i,
        process: 'codex.exe',
        instanceId: 'detail:' + i,
        instanceIdSource: 'os',
        generationWitness: 'fixture-generation-' + i,
        generationWitnessSource: 'createTime100ns',
        cwd: 'X:/Fixture/project-' + i,
      }));
      window.detailFixture.onScanBatch({
        agents,
        stats: {
          appHealth: { populationReliable: true, identityDegraded: false, state: 'HEALTHY' },
          observationGap: { state: 'NONE' },
        },
      });
      window.detailFixture.onFileAccess(
        Array.from({ length: 35 }, (_, i) => ({
          agent: 'Codex',
          pid: 200,
          instanceId: 'detail:0',
          file: 'C:/Fixture/.codex/skills/review/SKILL.md',
          timestamp: Date.now() - i * 1000,
          action: 'modified',
          attribution: { status: 'inferred', evidence: ['process_identity'] },
          fileContents: 'DO-NOT-DISPLAY',
          apiKey: 'DO-NOT-DISPLAY',
        })),
      );
      window.detailFixture.onNetworkUpdate([
        {
          instanceId: 'detail:0',
          domain: 'api.openai.com',
          remoteIp: '192.0.2.10',
          remotePort: 443,
          state: 'Established',
        },
      ]);
    });
    await page.getByRole('button', { name: /Select Codex, 26 processes/ }).click();
    await page.getByRole('button', { name: 'Open agent', exact: true }).click();
    const workspace = page.locator('.agent-workspace:visible');
    const context = page.locator('.agent-context');
    await workspace.waitFor();
    assert.equal(await page.getByRole('dialog').count(), 0);
    for (const size of [
      { width: 1200, height: 800 },
      { width: 900, height: 600 },
    ]) {
      await page.setViewportSize(size);
      for (const scale of [1]) {
        for (const theme of ['dark', 'light', 'dark-hc', 'light-hc']) {
          await page.evaluate(
            ({ scale, theme }) => {
              document.documentElement.style.setProperty('--ui-scale', String(scale));
              document.documentElement.dataset.theme = theme;
            },
            { scale, theme },
          );
          await settled();
          assert(
            await workspace.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
            'agent workspace overflows',
          );
          assert.equal(await workspace.getByRole('tablist', { name: 'Agent sections' }).count(), 0);
          const glance = workspace.getByRole('region', { name: 'Agent context summary' });
          assert(
            await glance.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
            'agent context summary overflows',
          );
          for (const [caption, section] of [
            ['Resources', 'Resources'],
            ['Activity', 'Activity'],
            ['Worker processes', 'Processes'],
          ]) {
            const action = glance.getByRole('button', { name: new RegExp('^' + caption) });
            await action.focus();
            await action.press('Enter');
            assert.equal(
              await workspace.getByRole('region', { name: section, exact: true }).isVisible(),
              true,
              caption + ' lost its continuously visible section',
            );
            assert(
              await workspace
                .getByRole('region', { name: section, exact: true })
                .evaluate((node) => node === document.activeElement),
              caption + ' did not focus its destination',
            );
          }
          await page.locator('#main').evaluate((node) => {
            node.scrollTop = 0;
          });
          assert(
            await workspace.getByRole('region', { name: 'Observed risk', exact: true }).isVisible(),
          );
          assert(
            await workspace.getByRole('region', { name: 'Resources', exact: true }).isVisible(),
          );
          assert(
            await workspace.getByRole('region', { name: 'Activity', exact: true }).isVisible(),
          );
          assert(
            await workspace.getByRole('region', { name: 'Processes', exact: true }).isVisible(),
          );
          assert.equal(await page.getByRole('dialog').count(), 0);
          assert(!/DO-NOT-DISPLAY/.test(await workspace.innerText()));
          if (!theme.endsWith('-hc') && scale === 1) {
            await page.screenshot({
              path: resolve(out, 'agent-workspace-' + theme + '-' + size.width + '.png'),
            });
          }
        }
      }
    }
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--ui-scale', '1');
      document.documentElement.dataset.theme = 'dark';
    });
    await workspace
      .getByRole('region', { name: 'Agent context summary' })
      .getByRole('button', { name: /^Worker processes/ })
      .click();
    await page.getByRole('button', { name: 'Show all 26 processes' }).click();
    await page.getByRole('button', { name: 'PID 220', exact: true }).click();
    assert.equal(
      await context.getByLabel('Selected process', { exact: true }).inputValue(),
      'detail:20',
    );
    await page.getByRole('heading', { name: 'Process overview', exact: true }).waitFor();
    assert(
      await workspace.getByRole('region', { name: 'Process attributes and controls' }).isVisible(),
    );
    assert.match(await workspace.innerText(), /detail:20/);
    assert(await page.getByRole('button', { name: 'Suspend', exact: true }).isEnabled());
    await context.getByLabel('Selected process', { exact: true }).selectOption('detail:0');
    const observation = workspace
      .getByRole('button', {
        name: 'Open evidence · review · Changed a file',
        exact: true,
      })
      .first();
    await workspace
      .getByRole('region', { name: 'Agent context summary' })
      .getByRole('button', { name: /^Activity/ })
      .click();
    await observation.click();
    await page.getByRole('dialog').waitFor();
    await tab('Attributes').click();
    await checkLayout();
    assert.match(await page.locator('#modal-body').innerText(), /Process identity/);
    await tab('Related').click();
    await page.locator('[data-detail-focus="exact-process"]').click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal(
      await context.getByLabel('Selected process', { exact: true }).inputValue(),
      'detail:0',
    );
    await workspace
      .getByRole('region', { name: 'Agent context summary' })
      .getByRole('button', { name: /^Activity/ })
      .click();
    await workspace
      .getByRole('region', { name: 'Selected agent file activity' })
      .getByRole('button', { name: 'View all', exact: true })
      .click();
    await page.getByRole('button', { name: 'Open 35 observations for review' }).click();
    await tab(/^Records/).waitFor();
    await page.getByRole('button', { name: 'Show 15 more' }).click();
    const selected = page.locator('.observation-history .recent-event').nth(22);
    await selected.scrollIntoViewIfNeeded();
    await selected.click();
    await tab('Attributes').click();
    await checkLayout();
    await page.getByRole('dialog').getByRole('button', { name: 'Back', exact: true }).click();
    await settled();
    assert.equal(await page.locator('.observation-history .recent-event').count(), 35);
    assert(await selected.evaluate((node) => document.activeElement === node));
    await page.screenshot({ path: resolve(out, 'detail-records.png') });
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page
      .locator('.sidebar')
      .getByRole('button', { name: 'Agent catalog', exact: true })
      .click();
    await page.getByRole('button', { name: 'Add agent', exact: true }).click();
    await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill('Personal agent');
    await tab('Recognition').click();
    await page.getByRole('dialog').getByLabel('Process name', { exact: true }).fill('personal.exe');
    await tab('General').click();
    assert.equal(
      await page.getByRole('dialog').getByLabel('Name', { exact: true }).inputValue(),
      'Personal agent',
    );
    await page.setViewportSize({ width: 900, height: 600 });
    await page.evaluate(() => document.documentElement.style.setProperty('--ui-scale', '1'));
    for (const name of ['General', 'Recognition']) {
      await tab(name).click();
      await checkLayout();
      const cancel = await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Cancel', exact: true })
        .boundingBox();
      const save = await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Save agent', exact: true })
        .boundingBox();
      assert(
        Math.abs(cancel.height - save.height) <= 1,
        'feedback space stretched the neighbouring action',
      );
      await page.screenshot({ path: resolve(out, 'detail-editor-' + name.toLowerCase() + '.png') });
    }
    await tab('General').click();
    // Compact controls fit at 100%; larger text keeps this scroll-restoration case meaningful.
    await page.evaluate(() => document.documentElement.style.setProperty('--ui-scale', '1.5'));
    await checkLayout();
    const editorScroll = await page.locator('.editor-body').evaluate((node) => {
      node.scrollTop = node.scrollHeight;
      return node.scrollTop;
    });
    assert(editorScroll > 0, 'editor fixture must scroll at the minimum window and 150%');
    await tab('Recognition').click();
    await tab('General').click();
    assert.equal(
      await page.locator('.editor-body').evaluate((node) => node.scrollTop),
      editorScroll,
      'editor lost its section scroll when shorter content replaced it',
    );
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.evaluate(() => document.documentElement.style.setProperty('--ui-scale', '1'));
    await page.locator('.catalog-identity').first().click();
    await tab('Recognition').click();
    await checkLayout();
    assert.match(
      await page.locator('#modal-body').innerText(),
      /Process signatures[\s\S]*codex.exe/,
    );
    await page.screenshot({ path: resolve(out, 'detail-recognition.png') });
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page
      .locator('.sidebar')
      .getByRole('button', { name: 'AI analysis', exact: true })
      .click();
    await page.getByRole('button', { name: 'Connect AI analysis', exact: true }).click();
    await page.getByRole('dialog').getByLabel('New API key').fill('draft-test-only');
    await tab('Usage').click();
    await checkLayout();
    await page.screenshot({ path: resolve(out, 'detail-provider.png') });
    await tab('Connection').click();
    assert.equal(
      await page.getByRole('dialog').getByLabel('New API key').inputValue(),
      'draft-test-only',
    );
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Connect AI analysis', exact: true }).click();
    await tab('Connection').click();
    assert.equal(await page.getByRole('dialog').getByLabel('New API key').inputValue(), '');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('button button, button a').count(), 0);
    assert.deepEqual(errors, []);
    console.log(
      'Agent workspace: 8 theme/viewport layouts at 100%; direct process scope and evidence-to-agent return; record pagination/history/focus, evidence layout and editor drafts passed.',
    );
  } finally {
    await page.close();
  }
}
