import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';

/** Exercise the production beginner journey without provider or process actions.
 * @param {import('playwright').Browser} browser Unmodified browser
 * @param {string} url Production renderer URL
 * @param {string} out Receipt directory
 * @returns {Promise<void>} Checked default, retained state, independent preference and layout
 * @since 0.19.2
 */
export async function checkSimpleExperience(browser, url, out) {
  const layouts = [];
  for (const { width, height, scale } of [
    { width: 1200, height: 800, scale: 1 },
    { width: 900, height: 600, scale: 1.5 },
  ]) {
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport: { width, height } });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.route('**/*', (route) =>
        new URL(route.request().url()).origin === new URL(url).origin
          ? route.continue()
          : route.abort(),
      );
      try {
        await page.addInitScript(
          ({ theme, scale }) => {
            localStorage.setItem('aegis-theme', theme);
            localStorage.setItem('aegis-motion', 'reduce');
            const listeners = {};
            const worker = {
              agent: 'Codex',
              process: 'codex.exe',
              pid: 101,
              instanceId: '101:fixture',
              instanceIdSource: 'os',
              generationWitness: 'fixture-generation',
              generationWitnessSource: 'createTime100ns',
              cwd: 'X:/fixture-project',
            };
            const stats = {
              appHealth: { state: 'HEALTHY', populationReliable: true, identityDegraded: false },
            };
            let settings = {
              darkMode: theme === 'dark',
              uiScale: scale,
              scanIntervalSec: 10,
              customSensitivePatterns: [],
              ignoredDirectories: [],
            };
            let exceptions = [];
            const file = (index) => ({
              agent: worker.agent,
              pid: worker.pid,
              instanceId: worker.instanceId,
              cwd: worker.cwd,
              file: `X:/fixture-project/file-${index}.txt`,
              action: index % 2 ? 'modified' : 'holding',
              timestamp: 1700000000000 + index * 1000,
              eventId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
              sensitive: false,
              selfAccess: false,
              attribution: { status: 'confirmed', evidence: [] },
            });
            window.simpleFixture = {
              publish() {
                listeners.onScanBatch?.({ agents: [worker], stats });
                listeners.onAgentResourceUsage?.([
                  { instanceId: worker.instanceId, cpu: 12, memMb: 64 },
                ]);
                listeners.onFileAccess?.(Array.from({ length: 70 }, (_, index) => file(index)));
              },
              append(index) {
                listeners.onFileAccess?.([file(index)]);
              },
            };
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
                  if (
                    ['suspendProcess', 'resumeProcess', 'killProcess', 'analyzeSession'].includes(
                      method,
                    )
                  )
                    return async () => {
                      throw new Error('This fixture forbids process and provider actions');
                    };
                  if (method === 'getStats') return async () => stats;
                  if (method === 'getSettings')
                    return async () => ({ ...settings, falsePositivePatterns: exceptions });
                  if (method === 'getFalsePositives') return async () => exceptions;
                  if (method === 'addFalsePositive')
                    return async (entry) => {
                      exceptions = [...exceptions, entry];
                      return { success: true };
                    };
                  if (method === 'getResourceUsage') return async () => ({ memMB: 40, heapMB: 20 });
                  if (method === 'getAppVersion') return async () => 'Offline Simple fixture';
                  if (method === 'saveSettings')
                    return async (patch) => {
                      settings = { ...settings, ...patch };
                      if (patch.falsePositivePatterns) exceptions = patch.falsePositivePatterns;
                      return { success: true };
                    };
                  return async () => [];
                },
              },
            );
          },
          { theme, scale },
        );
        await page.goto(url);
        await page.getByRole('heading', { name: 'Home', exact: true, level: 1 }).waitFor();
        const navigation = page.getByRole('navigation', { name: 'Main navigation' });
        assert.deepEqual(
          await navigation
            .getByRole('button')
            .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label'))),
          ['Home', 'Agents', 'Activity', 'Check files', 'Settings'],
        );
        await page.evaluate(() => window.simpleFixture.publish());
        await page
          .locator('.simple-home')
          .getByRole('button', { name: 'Open', exact: true })
          .first()
          .click();
        await page.getByRole('heading', { name: 'Agent overview', exact: true }).waitFor();
        assert.equal(await page.getByRole('tablist', { name: 'Agent sections' }).count(), 0);
        assert(await page.getByRole('heading', { name: 'Observed risk', exact: true }).isVisible());
        const activity = page.getByRole('region', { name: 'Agent activity' });
        await activity.getByText('file-69.txt', { exact: true }).waitFor();
        await page.getByLabel('Selected process', { exact: true }).selectOption('101:fixture');
        assert(await page.getByRole('button', { name: 'Pause process', exact: true }).isEnabled());
        assert(await page.getByRole('button', { name: 'Resume process', exact: true }).isVisible());
        await page.locator('#main').evaluate((node) => {
          node.scrollTop = 0;
        });
        await page.screenshot({
          path: resolve(out, `simple-agent-overview-${theme}-${width}-${scale}.png`),
        });
        const search = activity.getByRole('searchbox', { name: 'Search events', exact: true });
        await search.fill('file-69');
        await activity
          .getByRole('button', { name: 'Open 1 observations for file-69.txt', exact: true })
          .click();
        const details = page.getByRole('dialog');
        await details.getByRole('button', { name: 'Mute false alarm', exact: true }).click();
        await details.getByRole('button', { name: 'Re-enable alerts', exact: true }).waitFor();
        assert(await details.getByText('Exact file exception saved.', { exact: true }).isVisible());
        await details.getByRole('button', { name: 'Re-enable alerts', exact: true }).click();
        await details.getByText('No saved pattern excludes this file.', { exact: true }).waitFor();
        await details.getByRole('button', { name: 'Close details', exact: true }).click();
        assert(
          await activity.getByText('file-69.txt', { exact: true }).isVisible(),
          'Exception changes discarded retained evidence',
        );
        await navigation.getByRole('button', { name: 'Settings', exact: true }).click();
        await page.getByLabel('Interface scale percent', { exact: true }).fill('125');
        const advanced = page.getByRole('checkbox', { name: 'Advanced interface', exact: true });
        await advanced.check();
        assert.equal(
          await page.getByLabel('Interface scale percent', { exact: true }).inputValue(),
          '125',
        );
        assert.equal(
          await page.evaluate(() => localStorage.getItem('aegis-advanced-mode')),
          'true',
        );
        await advanced.uncheck();
        assert.equal(
          await page.getByLabel('Interface scale percent', { exact: true }).inputValue(),
          '125',
        );
        await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
        assert.equal(
          await page.getByLabel('Interface scale percent', { exact: true }).inputValue(),
          String(scale * 100),
        );
        await page.locator('#main').evaluate((node) => {
          node.scrollTop = node.scrollHeight;
        });
        await navigation.getByRole('button', { name: 'Agents', exact: true }).click();
        assert.equal(
          await page.getByLabel('Selected process', { exact: true }).inputValue(),
          '101:fixture',
        );
        assert.equal(await search.inputValue(), 'file-69');
        await page
          .getByRole('button', { name: 'More tools in Advanced mode', exact: true })
          .click();
        await advanced.waitFor({ state: 'visible' });
        const interfaceBounds = await advanced.boundingBox();
        const mainBounds = await page.locator('#main').boundingBox();
        assert(
          interfaceBounds &&
            mainBounds &&
            interfaceBounds.y >= mainBounds.y &&
            interfaceBounds.y + interfaceBounds.height <= mainBounds.y + mainBounds.height,
          'Advanced signpost restored Settings below the interface preference',
        );
        await navigation.getByRole('button', { name: 'Agents', exact: true }).click();
        await search.fill('');
        const older = activity.getByRole('button', { name: 'Show older activity', exact: true });
        await older.focus();
        while ((await older.getAttribute('aria-disabled')) !== 'true') await older.press('Enter');
        const heldRows = await activity.locator('tbody tr').count();
        await page.evaluate(() => window.simpleFixture.append(999));
        await activity.getByText('Activity updates waiting', { exact: true }).waitFor();
        assert.equal(await activity.locator('tbody tr').count(), heldRows);
        assert.equal(await activity.getByText('file-999.txt', { exact: true }).count(), 0);
        await activity.getByRole('button', { name: 'Show latest', exact: true }).click();
        await activity.getByText('file-999.txt', { exact: true }).waitFor();
        await page.screenshot({
          path: resolve(out, `simple-agent-${theme}-${width}-${scale}.png`),
        });
        const bounds = await page.evaluate(() => {
          const main = document.querySelector('#main').getBoundingClientRect();
          const critical = [
            ...document.querySelectorAll(
              '.simple-agent-view .risk-reason,.agent-context select,.simple-agent-view .feed-toolbar',
            ),
          ]
            .filter((node) => node.getClientRects().length)
            .map((node) => {
              const rect = node.getBoundingClientRect();
              return { left: rect.left, right: rect.right, width: rect.width };
            });
          return { main: { left: main.left, right: main.right }, critical };
        });
        assert(bounds.critical.length >= 3, 'Expected visible risk, process and feed controls');
        assert(
          bounds.critical.every(
            (rect) => rect.left >= bounds.main.left - 2 && rect.right <= bounds.main.right + 2,
          ),
          'Simple agent risk/process/feed controls exceed the workspace',
        );
        assert.deepEqual(errors, []);
        layouts.push({ width, height, scale, theme, heldRows, critical: bounds.critical });
      } finally {
        await page.close();
      }
    }
  }
  await writeFile(
    resolve(out, 'simple-experience-layouts.json'),
    JSON.stringify(layouts, null, 2) + '\n',
  );
}
