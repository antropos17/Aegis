import assert from 'node:assert/strict';
import { resolve } from 'node:path';

/** Verify calibrated audit evidence through the production details route.
 * @param {import('playwright').Browser} browser Browser
 * @param {string} url Desktop build URL @param {string} out Screenshot directory
 * @param {boolean} [related] Exercise direct-relative evidence.
 * @param {boolean} [ancestry] Exercise the maximum ancestor path.
 * @returns {Promise<void>} Completion @since 0.15.1
 */
export async function checkSequence(browser, url, out, related = false, ancestry = false) {
  const scope = ancestry ? 'ancestry' : 'related';
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.addInitScript(
      ({ related, ancestry }) => {
        const entry = {
          type: 'sequence-detection',
          action: 'SEQ001',
          severity: 'informational',
          timestamp: new Date().toISOString(),
          agent: 'Fixture agent',
          pid: 42,
          instanceId: 'fixture:42',
          attribution: { status: 'confirmed', evidence: ['handle-scan-pid', 'os-tcp-owner-pid'] },
          extra: {
            ruleId: 'SEQ001',
            title: 'Credential file observation followed by TCP observation',
            assessment: {
              policy: 'credential-egress-v1',
              dataTransfer: 'unobserved',
              reasons: ['connection-observed-before-file'],
            },
            steps: [
              {
                action: 'file-accessed',
                at: 12000,
                pid: 42,
                instanceId: 'fixture:42',
                path: 'C:/Fixture/project/.env',
                attribution: { status: 'confirmed', evidence: ['handle-scan-pid'] },
              },
              {
                action: 'network-connection',
                at: 13000,
                pid: 42,
                instanceId: 'fixture:42',
                network: {
                  remoteIp: '203.0.113.9',
                  remotePort: 8443,
                  localIp: '192.0.2.1',
                  localPort: 50001,
                  firstObservedAt: 10000,
                },
                attribution: { status: 'confirmed', evidence: ['os-tcp-owner-pid'] },
              },
            ],
          },
        };
        if (related) {
          entry.action = 'SEQ002';
          entry.extra.ruleId = 'SEQ002';
          entry.extra.assessment.reasons = ['process-relationship-only'];
          entry.extra.relationship = {
            source: 'fresh-process-table',
            parentPid: 10,
            childPid: 42,
            fileRelationObservedAt: 10000,
            observedAt: 11000,
          };
          entry.extra.steps[0].pid = 10;
          entry.extra.steps[0].instanceId = 'fixture:parent';
          entry.extra.steps[0].agent = 'Parent agent';
          entry.extra.steps[1].agent = 'Child agent';
        }
        if (ancestry) {
          entry.action = entry.extra.ruleId = 'SEQ003';
          entry.extra.assessment.reasons = ['process-ancestry-only'];
          entry.extra.relationship.path = [
            { pid: 10, instanceId: 'fixture:parent' },
            { pid: 11, instanceId: 'fixture:intermediate-1' },
            { pid: 12, instanceId: 'fixture:intermediate-2' },
            { pid: 13, instanceId: 'fixture:intermediate-3' },
            { pid: 42, instanceId: 'fixture:42' },
          ];
        }
        window.aegis = new Proxy(
          {},
          {
            get: (_, method) => {
              if (method.startsWith('on')) return () => () => {};
              return async () =>
                method === 'getAuditEntriesBefore'
                  ? [entry]
                  : method === 'getSettings'
                    ? { darkMode: true, uiScale: 1 }
                    : method === 'getAppVersion'
                      ? 'Fixture'
                      : method === 'getAgentDatabase'
                        ? { agents: [] }
                        : method === 'getCustomAgents' || method === 'getFalsePositives'
                          ? []
                          : {};
            },
          },
        );
      },
      { related, ancestry },
    );
    await page.goto(url);
    await page.locator('.sidebar').getByRole('button', { name: 'Audit', exact: true }).click();
    await page.locator('.observation-open').first().click();
    const evidence = page.getByRole('region', { name: 'Sequence evidence' });
    await evidence.getByText('Data transfer was not observed.', { exact: true }).waitFor();
    await page.waitForFunction(() => !document.documentElement.dataset.transitionSurface);
    await page.getByRole('dialog').evaluate(async (dialog) => {
      await Promise.all(
        dialog
          .getAnimations({ subtree: true })
          .filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().endTime))
          .map((animation) => animation.finished.catch(() => {})),
      );
    });
    assert.equal(await evidence.locator('.steps > li').count(), 2);
    assert((await evidence.innerText()).includes('203.0.113.9:8443'));
    const disclosure = evidence.locator('details.evidence-details');
    const summary = disclosure.locator('summary');
    const body = page.locator('#modal-body');
    const insideBody = async (locator) => {
      const box = await locator.boundingBox();
      const bounds = await body.boundingBox();
      assert(box && bounds && box.y >= bounds.y && box.y + box.height <= bounds.y + bounds.height);
    };
    for (const size of [
      { width: 1200, height: 800 },
      { width: 900, height: 600 },
    ]) {
      await page.setViewportSize(size);
      for (const theme of ['dark', 'light']) {
        await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme);
        for (const scale of [1, 1.5]) {
          await page.evaluate(
            (scale) => document.documentElement.style.setProperty('--ui-scale', String(scale)),
            scale,
          );
          await body.evaluate((el) => {
            el.scrollTop = 0;
          });
          assert.equal(await disclosure.evaluate((el) => el.open), false);
          // Core conclusion and first actual event must be readable without scrolling.
          await insideBody(evidence.getByText('Data transfer was not observed.', { exact: true }));
          await insideBody(evidence.getByText('1. File access observation', { exact: true }));
          assert.equal(await evidence.evaluate((el) => el.scrollWidth > el.clientWidth + 1), false);
          const name = `sequence-${related ? scope : 'same-instance'}-${theme}-${size.width}-${scale * 100}`;
          await page.screenshot({ path: resolve(out, `${name}.png`) });
          await evidence.locator('.steps > li').last().scrollIntoViewIfNeeded();
          await insideBody(evidence.getByText('2. TCP observation', { exact: true }));
          await summary.focus();
          await summary.press('Enter');
          assert.equal(await disclosure.evaluate((el) => el.open), true);
          assert.equal(await summary.evaluate((el) => document.activeElement === el), true);
          const focus = await summary.evaluate((el) => ({
            style: getComputedStyle(el).outlineStyle,
            width: parseFloat(getComputedStyle(el).outlineWidth),
          }));
          assert(
            focus.style !== 'none' && focus.width > 0,
            'disclosure keyboard focus is invisible',
          );
          assert(
            (await evidence.innerText()).includes(
              ancestry
                ? 'Observed process path (ancestor → descendant)'
                : related
                  ? 'Observed parent PID 10 → child PID 42.'
                  : 'already observed before the file event',
            ),
          );
          if (ancestry) {
            assert.equal(
              await evidence
                .getByRole('list', { name: 'Observed process path' })
                .locator('li')
                .count(),
              5,
            );
            assert((await evidence.innerText()).includes('fixture:intermediate-3'));
            assert(
              !(await evidence.innerText()).includes('Observed parent PID 10 → child PID 42.'),
            );
          }
          assert.equal(
            await evidence
              .getByRole('list', { name: 'Recorded process identities' })
              .locator('li')
              .count(),
            2,
          );
          assert((await evidence.innerText()).includes('fixture:42'));
          assert.equal(await evidence.evaluate((el) => el.scrollWidth > el.clientWidth + 1), false);
          await summary.scrollIntoViewIfNeeded();
          await page.screenshot({ path: resolve(out, `${name}-details.png`) });
          await summary.press('Space');
          assert.equal(await disclosure.evaluate((el) => el.open), false);
        }
      }
    }
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}
