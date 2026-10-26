import assert from 'node:assert/strict';
import { resolve } from 'node:path';

/** Check captured review context and keyboard navigation using an offline bridge fixture.
 * @param {import('playwright').Browser} browser Browser
 * @param {string} url Production build URL
 * @param {string} out Screenshot directory
 * @returns {Promise<void>} Verified review layouts and retained state
 * @since 0.19.2
 */
export async function checkReviewContext(browser, url, out) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', (route) =>
    new URL(route.request().url()).origin === new URL(url).origin
      ? route.continue()
      : route.abort(),
  );
  try {
    await page.addInitScript(() => {
      window.reviewCalls = 0;
      window.aegis = new Proxy(
        {},
        {
          get: (_, method) => {
            if (typeof method !== 'string') return undefined;
            if (method === 'onScanBatch')
              return (callback) => {
                window.reviewScan = callback;
                return () => {
                  window.reviewScan = null;
                };
              };
            if (method.startsWith('on')) return () => () => {};
            if (method === 'getSettings') return async () => ({ anthropicApiKeyConfigured: true });
            if (method === 'getAppVersion') return async () => 'Offline review fixture';
            if (method === 'getAuditStats')
              return async () => {
                throw new Error('Fixture delivery unavailable');
              };
            if (method === 'analyzeSession')
              return async () => {
                window.reviewCalls++;
                return {
                  success: true,
                  counts: { totalFiles: 12, totalSensitive: 2, totalAgents: 1, totalNet: 3 },
                  structured: {
                    summary: 'Review the captured observations before the next action.',
                    findings: ['One retained observation needs review.'],
                    recommendations: [
                      'Inspect the recorded sensitive observation and its attribution.',
                    ],
                  },
                };
              };
            if (method === 'analyzeAgent')
              return (target) => {
                window.reviewAgentCalls = [...(window.reviewAgentCalls || []), target];
                return new Promise((resolve) => {
                  window.reviewResolve = resolve;
                });
              };
            return async () => [];
          },
        },
      );
    });
    await page.goto(url);
    const navigate = (name) =>
      page.locator('.sidebar').getByRole('button', { name, exact: true }).click();
    await navigate('AI analysis');
    await page.getByLabel('Report title', { exact: true }).fill('Captured review fixture');
    await page.getByRole('button', { name: 'Run analysis', exact: true }).click();
    const assessment = page.getByRole('region', { name: 'Assessment context' });
    await assessment.waitFor();
    assert.equal(
      await assessment
        .locator('dd')
        .allTextContents()
        .then((values) => values.map((value) => value.trim()).join(',')),
      '12,2,1,3',
    );
    await page.getByLabel('Report title', { exact: true }).fill('Next-run draft');
    const showEvidence = assessment.getByRole('button', { name: 'View recorded evidence' });
    await showEvidence.focus();
    await showEvidence.press('Enter');
    assert(
      await page
        .getByRole('heading', { name: 'Recorded scope', exact: true })
        .evaluate((node) => node === document.activeElement),
    );
    await page
      .locator('.analysis-jumps')
      .getByRole('button', { name: 'Report', exact: true })
      .click();
    for (const { width, height, scale } of [
      { width: 1200, height: 800, scale: 1 },
      { width: 900, height: 600, scale: 1 },
    ]) {
      await page.setViewportSize({ width, height });
      for (const theme of ['light', 'dark']) {
        await page.evaluate(
          ({ theme, scale }) => {
            document.documentElement.dataset.theme = theme;
            document.documentElement.style.setProperty('--ui-scale', String(scale));
          },
          { theme, scale },
        );
        await navigate('AI analysis');
        await assessment.scrollIntoViewIfNeeded();
        assert(
          await assessment.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
          'captured assessment context overflows',
        );
        assert(
          await assessment.locator('dd').evaluateAll((nodes) =>
            nodes.every((node) => {
              const range = document.createRange();
              range.selectNodeContents(node);
              return (
                [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0)
                  .length === 1
              );
            }),
          ),
          'a captured count is split across lines',
        );
        assert.equal(
          await page.getByLabel('Report title', { exact: true }).inputValue(),
          'Next-run draft',
        );
        await page.screenshot({ path: resolve(out, `assessment-context-${theme}-${width}.png`) });
        await navigate('Audit');
        const audit = page.getByRole('region', { name: 'Audit history and delivery' });
        await audit.waitFor();
        assert(
          await audit.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
          'audit context overflows',
        );
        const jump = audit.getByRole('button', { name: 'Check delivery counters' });
        await jump.focus();
        await jump.press('Enter');
        assert(
          await page
            .locator('#audit-panel-delivery')
            .evaluate((node) => node === document.activeElement),
        );
        await page
          .getByText('Delivery counters unavailable. Retry reading.', { exact: true })
          .waitFor();
        await page.screenshot({ path: resolve(out, `audit-context-${theme}-${width}.png`) });
        await audit.getByRole('button', { name: 'Review retained entries' }).click();
      }
    }
    assert.equal(
      await page.evaluate(() => window.reviewCalls),
      1,
      'navigation ran a second assessment',
    );
    await navigate('AI analysis');
    await page.evaluate(() =>
      window.reviewScan({
        agents: [1101, 1102].map((pid) => ({
          agent: 'Claude Code',
          process: 'claude.exe',
          pid,
          instanceId: `${pid}:1700000000000`,
          instanceIdSource: 'os',
          createTime100ns: `13344473600000${pid}0`,
          generationWitness: `13344473600000${pid}0`,
          generationWitnessSource: 'createTime100ns',
        })),
        stats: {
          appHealth: { state: 'HEALTHY', populationReliable: true, identityDegraded: false },
        },
      }),
    );
    await page.getByRole('combobox', { name: /^Scope/ }).selectOption('agent');
    await page.getByRole('combobox', { name: /^Process/ }).selectOption('1102:1700000000000');
    await page.getByLabel('Report title', { exact: true }).fill('Instance-specific review');
    await page.getByRole('button', { name: 'Run analysis', exact: true }).click();
    await page.waitForFunction(() => window.reviewAgentCalls?.length === 1);
    assert.deepEqual(await page.evaluate(() => window.reviewAgentCalls), [
      {
        instanceId: '1102:1700000000000',
        createTime100ns: '1334447360000011020',
        generationWitness: '1334447360000011020',
        generationWitnessSource: 'createTime100ns',
      },
    ]);
    assert(
      await page
        .locator('.analysis-config')
        .evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
      'instance selector overflows',
    );
    await page.screenshot({ path: resolve(out, 'analysis-instance-selector.png') });
    await page.evaluate(() => {
      window.reviewScan({
        agents: [],
        stats: {
          appHealth: { state: 'HEALTHY', populationReliable: true, identityDegraded: false },
        },
      });
      window.reviewResolve({
        success: true,
        structured: { summary: 'Selected second process only.' },
        counts: { totalFiles: 1, totalSensitive: 1, totalAgents: 1, totalNet: 1 },
      });
    });
    await page.getByText('Selected second process only.', { exact: true }).waitFor();
    assert(
      (await page.locator('.analysis-document > small').innerText()).startsWith(
        'Claude Code · PID 1102 · 1102:1700000000000',
      ),
    );
    assert(
      await page.getByRole('button', { name: 'Run analysis', exact: true }).isDisabled(),
      'stale instance must not be resubmitted',
    );
    await page.getByRole('combobox', { name: /^Scope/ }).selectOption('session');
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'light';
    });
    await page.screenshot({ path: resolve(out, 'analysis-instance-retained.png') });
    assert.equal(await page.evaluate(() => window.reviewAgentCalls.length), 1);
    assert.deepEqual(errors, []);
    console.log(
      'Review context: captured counts, retained draft, keyboard jumps, four AI/four Audit layouts, exact instance selection and retained stale-instance report passed with an offline bridge.',
    );
  } finally {
    await page.close();
  }
}
