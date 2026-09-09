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
    await page.getByRole('dialog').waitFor();
    for (const size of [
      { width: 1200, height: 800 },
      { width: 900, height: 600 },
    ]) {
      await page.setViewportSize(size);
      for (const scale of [1, 1.5]) {
        for (const theme of ['dark', 'light', 'dark-hc', 'light-hc']) {
          await page.evaluate(
            ({ scale, theme }) => {
              document.documentElement.style.setProperty('--ui-scale', String(scale));
              document.documentElement.dataset.theme = theme;
            },
            { scale, theme },
          );
          for (const name of ['Overview', /^Processes/, /^Activity/]) {
            await tab(name).click();
            await checkLayout();
          }
          if (
            !theme.endsWith('-hc') &&
            ((size.width === 1200 && scale === 1) || (size.width === 900 && scale === 1.5))
          ) {
            await page.screenshot({
              path: resolve(out, 'detail-' + theme + '-' + size.width + '.png'),
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
    await tab(/^Processes/).click();
    await page.getByLabel('Find a process').fill('codex.exe');
    await page.getByRole('button', { name: 'Show 12 more processes' }).click();
    const selected = page.getByRole('button', { name: 'Open process PID 220' });
    await selected.scrollIntoViewIfNeeded();
    const scroll = await page.locator('#modal-body').evaluate((el) => el.scrollTop);
    await selected.click();
    await tab('Attributes').click();
    assert.match(await page.locator('#modal-body').innerText(), /detail:20/);
    await tab('Overview').focus();
    await page.keyboard.press('End');
    assert.equal(await tab('Controls').getAttribute('aria-selected'), 'true');
    await checkLayout();
    assert(await page.getByRole('button', { name: 'Suspend', exact: true }).isEnabled());
    await page.getByRole('dialog').getByRole('button', { name: 'Back', exact: true }).click();
    await settled();
    assert.equal(await tab(/^Processes/).getAttribute('aria-selected'), 'true');
    assert.equal(await page.getByLabel('Find a process').inputValue(), 'codex.exe');
    assert.equal(await page.locator('#modal .process-row').count(), 24);
    assert.equal(await page.locator('#modal-body').evaluate((el) => el.scrollTop), scroll);
    assert(await selected.evaluate((el) => document.activeElement === el));
    await page.screenshot({ path: resolve(out, 'detail-processes.png') });
    await tab(/^Activity/).click();
    await page.locator('.activity-card').filter({ hasText: 'SKILL.md' }).click();
    await tab(/^Records/).waitFor();
    assert.equal(await tab(/^Records/).getAttribute('aria-selected'), 'true');
    await page.getByRole('button', { name: 'Show 20 more' }).click();
    assert.equal(await page.locator('.observation-history .recent-event').count(), 35);
    await page.locator('.observation-history .recent-event').nth(22).click();
    await tab('Attributes').click();
    await checkLayout();
    assert.match(await page.locator('#modal-body').innerText(), /Process identity/);
    await page.screenshot({ path: resolve(out, 'detail-evidence.png') });
    await page.getByRole('dialog').getByRole('button', { name: 'Back', exact: true }).click();
    await settled();
    assert.equal(await page.locator('.observation-history .recent-event').count(), 35);
    await page.screenshot({ path: resolve(out, 'detail-records.png') });
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert(
      await page
        .getByRole('button', { name: 'Open agent', exact: true })
        .evaluate((el) => el === document.activeElement),
    );
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
    await page.evaluate(() => document.documentElement.style.setProperty('--ui-scale', '1.5'));
    for (const name of ['General', 'Recognition']) {
      await tab(name).click();
      await checkLayout();
      await page.screenshot({ path: resolve(out, 'detail-editor-' + name.toLowerCase() + '.png') });
    }
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
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
      'Detail dialogs: 48 theme/scale/viewport/tab layouts; search, pagination, history, focus, evidence, keyboard controls and editor drafts passed.',
    );
  } finally {
    await page.close();
  }
}
