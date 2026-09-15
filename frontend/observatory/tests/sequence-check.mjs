import assert from 'node:assert/strict';
import { resolve } from 'node:path';

/** Verify calibrated audit evidence through the production details route.
 * @param {import('playwright').Browser} browser Browser
 * @param {string} url Desktop build URL @param {string} out Screenshot directory
 * @returns {Promise<void>} Completion @since 0.15.1
 */
export async function checkSequence(browser, url, out) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.addInitScript(() => {
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
    });
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
    assert((await evidence.innerText()).includes('already observed before the file event'));
    for (const size of [
      { width: 1200, height: 800 },
      { width: 900, height: 600 },
    ]) {
      await page.setViewportSize(size);
      for (const theme of ['dark', 'light']) {
        await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme);
        const overflow = await evidence.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
        assert.equal(overflow, false);
        await page.screenshot({ path: resolve(out, `sequence-${theme}-${size.width}.png`) });
      }
    }
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}
