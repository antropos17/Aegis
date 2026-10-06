import assert from 'node:assert/strict';
import { resolve } from 'node:path';

/** Wait only for an explicitly requested native smooth scroll to settle.
 * @param {import('playwright').Page} page Fixture page @returns {Promise<void>} Settled scroll
 */
async function settleScroll(page) {
  await page.evaluate(() => {
    window.feedScrollPosition = NaN;
    window.feedScrollFrames = 0;
  });
  await page.waitForFunction(
    () => {
      const top = document.querySelector('#main').scrollTop;
      window.feedScrollFrames = window.feedScrollPosition === top ? window.feedScrollFrames + 1 : 0;
      window.feedScrollPosition = top;
      return window.feedScrollFrames >= 3;
    },
    undefined,
    { polling: 'raf', timeout: 2500 },
  );
}

/** Verify bounded incremental evidence, original row identity and stationary reading.
 * @param {import('playwright').Browser} browser Browser
 * @param {string} url Desktop fixture URL @param {string} out Screenshot directory
 * @returns {Promise<void>} Checked workflows @since 0.19.2
 */
export async function checkPagination(browser, url, out) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.addInitScript(() => {
      localStorage.setItem('aegis-advanced-mode', 'true');
      const listeners = {};
      window.paginationFixture = listeners;
      window.aegis = new Proxy(
        {},
        {
          get: (_, name) =>
            name.startsWith('on')
              ? (callback) => {
                  listeners[name] = callback;
                  return () => {};
                }
              : async () =>
                  name === 'getSettings'
                    ? { darkMode: true, uiScale: 1 }
                    : name === 'getFalsePositives'
                      ? []
                      : {},
        },
      );
    });
    await page.goto(url);
    await page.waitForFunction(() => typeof window.paginationFixture.onScanBatch === 'function');
    await page.evaluate(() => {
      const common = {
        agent: 'Codex',
        pid: 123,
        instanceId: '123:100',
        attribution: { status: 'confirmed', evidence: ['handle-scan-pid'] },
      };
      window.feedAgent = { ...common, instanceIdSource: 'os', process: 'codex.exe' };
      window.paginationFixture.onScanBatch({
        agents: [window.feedAgent],
        stats: { appHealth: { populationReliable: true, state: 'HEALTHY' } },
      });
      window.paginationFixture.onFileAccess(
        Array.from({ length: 65 }, (_, i) => ({
          ...common,
          eventId: 'feed-' + i,
          file: 'X:/Fixture/file-' + i + '.txt',
          timestamp: Date.now() - i * 1000,
          action: 'modified',
        })),
      );
      window.feedNetwork = Array.from({ length: 65 }, (_, i) => ({
        ...common,
        remoteIp: '192.0.2.' + (i + 1),
        remotePort: 443,
        localIp: '127.0.0.1',
        localPort: 8000 + i,
        state: 'ESTABLISHED',
        verdict: 'unknown',
      }));
      window.paginationFixture.onNetworkUpdate(window.feedNetwork);
    });
    let states = 0;
    for (const view of ['Events', 'Network']) {
      await page.locator('.sidebar').getByRole('button', { name: view, exact: true }).click();
      const feed = page.locator('.observation-table:visible');
      const older = feed.getByRole('button', { name: 'Show older activity', exact: true });
      const latest = feed.getByRole('button', { name: 'Show latest', exact: true });
      if (view === 'Events') {
        const partial = await feed.evaluate((node) => {
          const root = document.querySelector('#main');
          root.scrollTop = 0;
          root.focus({ preventScroll: true });
          const bounds = root.getBoundingClientRect();
          return {
            x: bounds.left + 40,
            y: bounds.top + 40,
            delta: Math.min(60, node.getBoundingClientRect().top - bounds.top - 40),
          };
        });
        assert(partial.delta > 0, 'fixture needs a partially visible feed');
        await page.mouse.move(partial.x, partial.y);
        await page.mouse.wheel(0, partial.delta);
        await page.waitForFunction(() => document.querySelector('#main').scrollTop > 0);
        assert(
          await feed.evaluate(
            (node) =>
              node.getBoundingClientRect().top >
              document.querySelector('#main').getBoundingClientRect().top,
          ),
          'partial scroll must leave the feed below the root top',
        );
        const original = feed.getByRole('button', {
          name: 'Open 1 observations for file-0.txt',
          exact: true,
        });
        const before = await original.evaluate((node) => {
          window.feedPartialOriginal = node;
          return {
            top: node.getBoundingClientRect().top,
            scroll: document.querySelector('#main').scrollTop,
          };
        });
        await page.evaluate(() =>
          window.paginationFixture.onFileAccess({
            eventId: 'feed-partial',
            agent: 'Codex',
            pid: 123,
            instanceId: '123:100',
            file: 'X:/Fixture/file-partial.txt',
            timestamp: Date.now(),
            action: 'modified',
          }),
        );
        await feed.getByText('Activity updates waiting', { exact: true }).waitFor();
        const after = await original.evaluate((node) => ({
          same: node === window.feedPartialOriginal,
          rootFocused: document.activeElement === document.querySelector('#main'),
          top: node.getBoundingClientRect().top,
          scroll: document.querySelector('#main').scrollTop,
        }));
        assert(
          after.same && after.rootFocused,
          'partial scroll must hold evidence without record focus',
        );
        assert(
          Math.abs(after.top - before.top) <= 1 && Math.abs(after.scroll - before.scroll) <= 1,
          'partial scroll delivery moved the reader',
        );
        await latest.click();
        await settleScroll(page);
      }
      for (const [width, height, scale, theme, reduced] of [
        [900, 600, 1.5, 'light', true],
        [900, 600, 1.5, 'dark', false],
        [1200, 800, 1, 'light-hc', true],
        [1200, 800, 1, 'dark-hc', false],
      ]) {
        await page.evaluate(() =>
          window.paginationFixture.onScanBatch({
            agents: [window.feedAgent],
            stats: { appHealth: { populationReliable: true, state: 'HEALTHY' } },
          }),
        );
        await page.setViewportSize({ width, height });
        await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
        await page.evaluate(
          ({ scale, theme, reduced }) => {
            document.documentElement.dataset.theme = theme;
            document.documentElement.dataset.motion = reduced ? 'reduce' : 'full';
            document.documentElement.style.setProperty('--ui-scale', String(scale));
          },
          { scale, theme, reduced },
        );
        if ((await latest.getAttribute('aria-disabled')) === 'true') {
          assert.equal(
            await feed.locator('.feed-status').innerText(),
            'Following latest retained activity',
          );
        } else {
          await latest.click();
          await settleScroll(page);
        }
        await older.focus();
        await older.press('Enter');
        for (let i = 0; i < 2 && (await older.getAttribute('aria-disabled')) !== 'true'; i++)
          await older.press('Enter');
        assert.equal(
          await feed.locator('tbody tr').count(),
          view === 'Events' ? (states > 0 ? 67 : 66) : 65,
        );
        assert(
          await older.evaluate((node) => node === document.activeElement),
          'incremental loading lost focus',
        );
        assert.equal(await older.getAttribute('aria-disabled'), 'true');
        await older.press('Enter');
        const resource = view === 'Events' ? 'file-30.txt' : '192.0.2.31:443';
        const record = feed.getByRole('button', {
          name: 'Open 1 observations for ' + resource,
          exact: true,
        });
        await record.focus();
        const before = await record.evaluate((node) => {
          window.feedFocused = node;
          return {
            scroll: document.querySelector('#main').scrollTop,
            top: node.getBoundingClientRect().top,
          };
        });
        if (states === 0 || states === 4) {
          await page.evaluate((view) => {
            if (view === 'Events')
              window.paginationFixture.onFileAccess({
                eventId: 'feed-new',
                agent: 'Codex',
                pid: 123,
                instanceId: '123:100',
                file: 'X:/Fixture/file-new.txt',
                timestamp: Date.now(),
                action: 'modified',
                attribution: { status: 'confirmed', evidence: ['handle-scan-pid'] },
              });
            else window.paginationFixture.onNetworkUpdate([...window.feedNetwork].reverse());
          }, view);
        }
        await page.waitForTimeout(50);
        const after = await record.evaluate((node) => ({
          same: node === window.feedFocused,
          focused: node === document.activeElement,
          scroll: document.querySelector('#main').scrollTop,
          top: node.getBoundingClientRect().top,
        }));
        assert(after.same && after.focused, 'delivery retargeted the focused record');
        assert(
          Math.abs(after.scroll - before.scroll) <= 1 && Math.abs(after.top - before.top) <= 1,
          'delivery moved the reader',
        );
        await record.press('Enter');
        const dialog = page.getByRole('dialog');
        assert(await dialog.getByRole('heading', { name: resource, exact: true }).isVisible());
        await dialog.getByRole('button', { name: 'Close', exact: true }).click();
        assert(await record.evaluate((node) => node === document.activeElement));
        await latest.click();
        await settleScroll(page);
        assert(await latest.evaluate((node) => node === document.activeElement));
        assert(
          await feed.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
          'feed controls overflow',
        );
        if (width === 900)
          await page.screenshot({
            path: resolve(out, 'feed-' + view.toLowerCase() + '-' + theme + '.png'),
          });
        states++;
      }
      const search = page.getByRole('searchbox', {
        name: view === 'Events' ? 'Search events' : 'Search connections',
        exact: true,
      });
      await search.fill(view === 'Events' ? 'file-64.txt' : '192.0.2.65');
      assert.equal(await feed.locator('tbody tr').count(), 1);
      assert(await search.evaluate((node) => node === document.activeElement), 'search lost focus');
      await search.fill('no-matching-retained-record');
      assert(await feed.getByText('No records match these filters.', { exact: true }).isVisible());
      assert.equal(await older.getAttribute('aria-disabled'), 'true');
      await search.fill('');
    }
    await page.locator('.sidebar').getByRole('button', { name: 'Events', exact: true }).click();
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const motionFeed = page.locator('.observation-table:visible');
    await motionFeed.evaluate((node) => {
      document.documentElement.dataset.motion = 'full';
      document.documentElement.classList.remove('no-motion');
      document.documentElement.style.setProperty('--ui-scale', '1');
      const root = document.querySelector('#main');
      root.scrollTop = 0;
      root.focus({ preventScroll: true });
      window.paginationFixture.onScanBatch({
        agents: [window.feedAgent],
        stats: { appHealth: { populationReliable: true, state: 'HEALTHY' } },
      });
      window.feedMotionLog = [];
      node.addEventListener('animationstart', (event) => {
        if (event.animationName.includes('feed-arrival'))
          window.feedMotionLog.push(event.target.textContent);
      });
      window.paginationFixture.onFileAccess({
        eventId: 'feed-motion-full',
        file: 'X:/Fixture/motion-full.txt',
        action: 'modified',
        timestamp: Date.now(),
      });
    });
    await page.waitForFunction(() =>
      window.feedMotionLog.some((label) => label.includes('motion-full.txt')),
    );
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await motionFeed.evaluate(() => {
      document.documentElement.dataset.motion = 'reduce';
      window.paginationFixture.onFileAccess({
        eventId: 'feed-motion-reduced',
        file: 'X:/Fixture/motion-reduced.txt',
        action: 'modified',
        timestamp: Date.now(),
      });
    });
    await motionFeed.getByText('motion-reduced.txt', { exact: true }).waitFor();
    await page.waitForFunction(
      () =>
        !Array.from(document.querySelectorAll('.observation-table'))
          .find((node) => node.getBoundingClientRect().height > 0)
          ?.querySelector('.feed-arrival'),
    );
    assert.equal(
      await motionFeed.locator('.feed-arrival').count(),
      0,
      'reduced motion did not cancel arrival classes',
    );
    assert(
      !(await page.evaluate(() =>
        window.feedMotionLog.some((label) => label.includes('motion-reduced.txt')),
      )),
      'reduced arrival animated',
    );
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => {
      document.documentElement.dataset.motion = 'full';
    });
    assert.equal(
      await motionFeed.locator('.feed-arrival').count(),
      0,
      'full motion replayed old arrivals',
    );
    assert.deepEqual(errors, []);
    console.log(
      'Incremental activity: ' +
        states +
        ' viewport/theme/motion states; keyboard loading, original identity, live reading, search and focus return passed.',
    );
  } finally {
    await page.close();
  }
}
