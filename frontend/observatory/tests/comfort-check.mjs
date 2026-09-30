import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/** Check related navigation and every internal workspace section.
 * @param {import('playwright').Browser} browser Browser @param {string} url Preview
 * @param {string} out Screenshots @returns {Promise<void>} Verified @since 0.14.1
 */
export async function checkComfort(browser, url, out) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const settled = async () => {
    await page.waitForFunction(() => !document.documentElement.dataset.transitionSurface);
    await page.waitForTimeout(180);
  };
  const navigate = async (name) => {
    await page.locator('.sidebar').getByRole('button', { name, exact: true }).click();
    await settled();
    assert(
      (await page.locator('.workspace-tabs [role=tab]').count()) <= 3,
      'workspace strip grows without bounds',
    );
  };
  let checks = 0;
  try {
    await page.goto(url);
    await page.getByRole('heading', { name: 'Monitoring', level: 1, exact: true }).waitFor();
    for (const size of [
      { width: 1200, height: 800 },
      { width: 900, height: 600 },
    ]) {
      await page.setViewportSize(size);
      for (const theme of ['dark', 'light']) {
        await page.evaluate(
          ({ theme, scale }) => {
            document.documentElement.dataset.theme = theme;
            document.documentElement.style.setProperty('--ui-scale', String(scale));
          },
          { theme, scale: size.width === 900 ? 1.5 : 1 },
        );
        for (const view of ['Agents', 'Statistics', 'Settings', 'Reports', 'Audit']) {
          await navigate(view);
          const tabs = page
            .locator('#content > div:not([hidden]) .section-tabs')
            .first()
            .getByRole('tab');
          const labels = await tabs.allTextContents();
          for (const label of labels) {
            await tabs.filter({ hasText: label.trim() }).click();
            await settled();
            const dimensions = await page.evaluate(() => ({
              document: document.documentElement.scrollWidth <= innerWidth + 2,
              main:
                document.querySelector('#main').scrollWidth <=
                document.querySelector('#main').clientWidth + 2,
              selected: [...document.querySelectorAll('.section-tabs [aria-selected=true]')].filter(
                (el) => el.checkVisibility(),
              ).length,
            }));
            assert(dimensions.document && dimensions.main, view + ' overflows viewport');
            assert(dimensions.selected > 0, view + ' has no active section');
            if (view === 'Statistics') {
              const rail = page.locator('.metric-rail:visible button');
              const count = await rail.count();
              for (let index = 0; index < count; index++) {
                await rail.nth(index).click();
                assert.equal(await rail.nth(index).getAttribute('aria-pressed'), 'true');
                assert(await page.locator('.plot:visible').getAttribute('aria-label'));
              }
            }
            checks++;
          }
          await page.locator('#main').evaluate((el) => (el.scrollTop = 0));
          await page.screenshot({
            path: resolve(
              out,
              'comfort-' + view.toLowerCase() + '-' + theme + '-' + size.width + '.png',
            ),
          });
        }
      }
    }
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.evaluate(() => document.documentElement.style.setProperty('--ui-scale', '1'));
    await page.getByRole('button', { name: 'Commands', exact: false }).click();
    const search = page.getByRole('combobox', { name: 'Find a workspace or action' });
    await search.fill('Statistics Tokens');
    await search.press('Enter');
    await page.getByRole('heading', { name: 'Statistics', level: 1, exact: true }).waitFor();
    await settled();
    assert.equal(
      await page.getByRole('tab', { name: 'Tokens', exact: true }).getAttribute('aria-selected'),
      'true',
    );
    await page.getByRole('button', { name: 'Pause view', exact: true }).click();
    const paused = await page.locator('.coverage-line').innerText();
    await page.waitForTimeout(2200);
    assert.equal(
      await page.locator('.coverage-line').innerText(),
      paused,
      'paused Statistics collected new samples',
    );
    assert.match(await page.locator('.live-state').innerText(), /paused/i);
    await page.getByRole('button', { name: 'Resume view', exact: true }).click();
    await page.getByRole('button', { name: 'Commands', exact: false }).click();
    await search.fill('Appearance');
    await search.press('Enter');
    await page.getByRole('heading', { name: 'Settings', level: 1, exact: true }).waitFor();
    await settled();
    assert.equal(
      await page
        .getByRole('tab', { name: 'Appearance', exact: true })
        .getAttribute('aria-selected'),
      'true',
    );
    await page.getByRole('tab', { name: 'Monitoring', exact: true }).click();
    await page.getByLabel('Scan interval (seconds)', { exact: true }).fill('17');
    await navigate('Events');
    await navigate('Settings');
    assert.equal(
      await page.getByLabel('Scan interval (seconds)', { exact: true }).inputValue(),
      '17',
    );
    await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
    await navigate('Monitoring');
    await page.keyboard.press('Control+k');
    await search.fill('never-existing-destination');
    await page.getByText('No matching destination.', { exact: true }).waitFor();
    assert.equal(
      await page.getByRole('listbox', { name: 'Destinations' }).getByRole('option').count(),
      0,
    );
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.deepEqual(errors, []);
    console.log(
      'Comfort: ' +
        checks +
        ' internal section layouts, metric switching, related navigation, deep search, paused history and retained drafts passed.',
    );
  } finally {
    await page.close();
  }
}

/** Exercise compact status content and keyboard routes on real desktop assets.
 * @param {import('playwright').Browser} browser Browser
 * @param {string} url Desktop build URL
 * @param {string} out Artifact directory
 * @returns {Promise<void>} Verified footer bounds and keyboard navigation
 * @since 0.17.0
 */
export async function checkFooter(browser, url, out) {
  const catalog = JSON.parse(
    await readFile(new URL('../translations/pt-BR.json', import.meta.url), 'utf8'),
  );
  const phase = process.env.FOOTER_QA_PHASE === 'red' ? 'red' : 'green';
  const measurements = [];
  const errors = [];
  const shots = [];
  const textEndpoints = async (locator, ends = ['first', 'last']) => {
    const points = await locator.evaluate((node, ends) => {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode())
        if (walker.currentNode.textContent.trim()) nodes.push(walker.currentNode);
      return ends.map((end) => {
        const text = end === 'first' ? nodes[0] : nodes.at(-1);
        const offset =
          end === 'first' ? text.textContent.search(/\S/) : text.textContent.search(/\s*$/) - 1;
        const range = document.createRange();
        range.setStart(text, offset);
        range.setEnd(text, offset + 1);
        const box = range.getBoundingClientRect();
        const x = box.left + box.width / 2;
        const y = box.top + box.height / 2;
        const hit = document.elementFromPoint(x, y);
        return {
          end,
          x,
          y,
          visible: box.width > 0 && box.height > 0 && node.contains(hit),
          hit: hit?.className?.baseVal ?? hit?.className ?? null,
        };
      });
    }, ends);
    measurements.push({ textEndpoints: points });
    if (points.some((point) => !point.visible))
      measurements.push({
        failedPlacement: await locator.evaluate(() => {
          const footer = document.querySelector('.observatory-app footer');
          const trigger = document.querySelector('.alert-trigger');
          return {
            footer: footer.getBoundingClientRect().toJSON(),
            trigger: trigger.getBoundingClientRect().toJSON(),
            margin: getComputedStyle(footer).marginRight,
            width: getComputedStyle(document.documentElement).getPropertyValue(
              '--observatory-alert-trigger-width',
            ),
            height: getComputedStyle(document.documentElement).getPropertyValue(
              '--observatory-alert-trigger-height',
            ),
            tail: footer.querySelector(':scope > span:last-child').getBoundingClientRect().toJSON(),
            tailWidth: footer.querySelector(':scope > span:last-child').scrollWidth,
            scrollLeft: footer.scrollLeft,
            scrollWidth: footer.scrollWidth,
            clientWidth: footer.clientWidth,
            maximumScroll: footer.scrollWidth - footer.clientWidth,
          };
        }),
      });
    assert(
      points.every((point) => point.visible),
      'Footer text endpoint occluded: ' + JSON.stringify(points),
    );
  };
  try {
    for (const locale of ['pt', 'en']) {
      const t = (key) => (locale === 'pt' ? (catalog[key] ?? key) : key);
      const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
      page.on('pageerror', (error) => errors.push(error.message));
      await page.emulateMedia({ reducedMotion: 'reduce' });
      try {
        await page.addInitScript((locale) => {
          localStorage.setItem('aegis.language', locale);
          const listeners = {};
          window.footerFixture = listeners;
          window.aegis = new Proxy(
            {},
            {
              get: (_, method) => {
                if (method.startsWith('on'))
                  return (callback) => {
                    listeners[method] = callback;
                    return () => delete listeners[method];
                  };
                return async () => {
                  if (method === 'getSettings') return { darkMode: true, uiScale: 1 };
                  if (method === 'getAppVersion') return 'Synthetic footer QA';
                  if (method === 'listSensitiveAlerts')
                    return { success: true, items: [], status: 'ready' };
                  if (method === 'getAllPermissions')
                    return {
                      permissions: { Codex: { network: 'monitor' } },
                      instancePermissions: {},
                    };
                  if (
                    [
                      'getRules',
                      'getAuditEntriesBefore',
                      'getFalsePositives',
                      'getTokenCosts',
                    ].includes(method)
                  )
                    return [];
                  return {};
                };
              },
            },
          );
        }, locale);
        await page.goto(url + '?view=rules');
        await page.evaluate(() => document.fonts.ready);
        const main = page.locator('#main');
        const footer = page.locator('.observatory-app footer');
        await main.getByLabel(t('Target'), { exact: true }).selectOption('Codex');
        for (const width of [900, 1200])
          for (const scale of [1.5, 1]) {
            await page.setViewportSize({ width, height: width === 900 ? 600 : 800 });
            for (const theme of ['dark-hc', 'light', 'dark', 'light-hc']) {
              await page.evaluate(
                ({ theme, scale }) => {
                  document.documentElement.dataset.theme = theme;
                  document.documentElement.style.setProperty('--ui-scale', String(scale));
                },
                { theme, scale },
              );
              for (const state of [
                'unknown',
                'unknown-unobserved',
                'ready',
                'loss',
                'write-failed',
              ]) {
                await page.evaluate((state) => {
                  const stats = {
                    appHealth: {
                      populationReliable: true,
                      ...(state === 'unknown-unobserved' ? {} : { state: 'HEALTHY' }),
                    },
                    observationGap: { state: 'NONE' },
                    ...(state.startsWith('unknown')
                      ? {}
                      : {
                          auditDelivery: {
                            droppedEntries: state === 'loss' ? 7 : 0,
                            bufferDepth: state === 'loss' ? 3 : 0,
                            writeFailed: state === 'write-failed',
                          },
                        }),
                  };
                  window.footerFixture.onScanBatch({
                    stats,
                    agents: [],
                    resourceUsage: state.startsWith('unknown')
                      ? {}
                      : { cpuUser: 1000, cpuSystem: 500, memMB: 142, heapMB: 68 },
                  });
                }, state);
                // CPU is a difference of two cumulative samples, not an invented seed percentage.
                if (!state.startsWith('unknown')) {
                  await page.waitForTimeout(2);
                  await page.evaluate(() =>
                    window.footerFixture.onScanBatch({
                      resourceUsage: { cpuUser: 2000, cpuSystem: 1000, memMB: 142, heapMB: 68 },
                    }),
                  );
                }
                const metrics = footer.locator(':scope > span').first();
                const delivery = footer.locator('.audit-delivery');
                const expectedDelivery =
                  t('Audit delivery') +
                  ' ' +
                  (state.startsWith('unknown')
                    ? t('status unavailable')
                    : t('{value0} lost this session · {value1} pending write')
                        .replace('{value0}', state === 'loss' ? '7' : '0')
                        .replace('{value1}', state === 'loss' ? '3' : '0')) +
                  (state === 'write-failed' ? ' ' + t('· Last write failed') : '');
                await footer.getByRole('button', { name: expectedDelivery, exact: true }).waitFor();
                assert(
                  await delivery.evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
                  'Delivery label is clipped inside its button',
                );
                const text = (await metrics.innerText()).replace(/\s+/g, ' ');
                assert(
                  text.includes(t('AEGIS CPU')) &&
                    text.includes(t('· RAM')) &&
                    text.includes(t('· heap')),
                );
                if (state.startsWith('unknown')) assert.match(text, /—%.*— MB.*— MB/);
                else {
                  assert.match(text, /[\d.]+%.*142 MB.*68 MB/);
                  assert(!text.includes('—'));
                }
                const label = `${locale}/${width}/${scale}/${theme}/${state}`;
                const measured = await footer.evaluate((node) => {
                  const box = node.getBoundingClientRect();
                  const main = document.querySelector('#main').getBoundingClientRect();
                  return {
                    footerHeight: box.height,
                    footerBottom: box.bottom,
                    mainHeight: main.height,
                    mainBottom: main.bottom,
                    footerTop: box.top,
                    viewportHeight: innerHeight,
                    documentWidth: document.documentElement.scrollWidth,
                    viewportWidth: innerWidth,
                  };
                });
                measurements.push({ label, ...measured });
                const refresh = main.getByRole('button', { name: t('Refresh'), exact: true });
                const refreshHit = await refresh.evaluate((node) => {
                  const box = node.getBoundingClientRect();
                  const main = document.querySelector('#main').getBoundingClientRect();
                  const x = box.left + box.width / 2;
                  const y = box.top + box.height / 2;
                  const hit = document.elementFromPoint(x, y);
                  return {
                    x,
                    y,
                    onScreen: y >= main.top && y <= main.bottom,
                    visible: node.contains(hit),
                    hit: hit?.className ?? null,
                  };
                });
                measurements.push({ refreshHit, label });
                if (refreshHit.onScreen)
                  assert(
                    refreshHit.visible,
                    'Visible Refresh control is occluded: ' + JSON.stringify(refreshHit),
                  );
                if (refreshHit.onScreen) await textEndpoints(refresh);
                const selected =
                  locale === 'pt' &&
                  width === 900 &&
                  scale === 1.5 &&
                  theme === 'dark-hc' &&
                  (state === 'unknown' || (phase === 'green' && state === 'loss'));
                const readyShot =
                  phase === 'green' &&
                  locale === 'en' &&
                  width === 1200 &&
                  scale === 1 &&
                  theme === 'light' &&
                  state === 'ready';
                if (
                  !process.env.FOOTER_QA_OVERLAY &&
                  ((selected && !process.env.FOOTER_QA_READY_SHOT_ONLY) || readyShot)
                ) {
                  const path = resolve(out, `footer-${phase}-${locale}-${state}.png`);
                  await page.screenshot({ path });
                  shots.push(path);
                }
                assert(
                  measured.footerHeight <= 64,
                  label + ` footer consumes ${measured.footerHeight}px`,
                );
                assert(measured.mainHeight >= 300, label + ' main workspace is too short');
                assert(
                  measured.mainBottom <= measured.footerTop + 1,
                  label + ' footer covers workspace',
                );
                assert(
                  Math.abs(measured.footerBottom - measured.viewportHeight) <= 1,
                  label + ' footer not anchored',
                );
                assert(
                  measured.documentWidth <= measured.viewportWidth + 1,
                  label + ' document overflows',
                );
              }
              const sensor = footer.locator('button').first();
              const delivery = footer.locator('.audit-delivery');
              const beforeFocus = await page.evaluate(() => ({
                mainScroll: document.querySelector('#main').scrollTop,
                sidebarScroll: document.querySelector('.sidebar nav').scrollTop,
                headerTop: document.querySelector('.topbar').getBoundingClientRect().top,
                windowY: scrollY,
              }));
              await footer.evaluate((node) => (node.scrollLeft = 0));
              await sensor.focus();
              await textEndpoints(sensor);
              await page.keyboard.press('Tab');
              assert(
                await delivery.evaluate((node) => document.activeElement === node),
                'Tab missed delivery',
              );
              const focusBounds = await delivery.evaluate((node) => {
                const box = node.getBoundingClientRect();
                const scroller = node.closest('footer');
                const frame = scroller.getBoundingClientRect();
                const style = getComputedStyle(scroller);
                const frameLeft = frame.left + scroller.clientLeft;
                const frameRight = frameLeft + scroller.clientWidth;
                return {
                  buttonLeft: box.left,
                  buttonRight: box.right,
                  buttonWidth: box.width,
                  frameLeft,
                  frameRight,
                  frameWidth: scroller.clientWidth,
                  contentWidth:
                    scroller.clientWidth -
                    parseFloat(style.paddingLeft) -
                    parseFloat(style.paddingRight),
                  vertical: box.top >= frame.top && box.bottom <= frame.bottom,
                };
              });
              measurements.push({ focus: `${locale}/${width}/${scale}/${theme}`, ...focusBounds });
              assert(focusBounds.vertical, 'Focused delivery is clipped vertically');
              if (focusBounds.buttonWidth <= focusBounds.frameWidth)
                assert(
                  focusBounds.buttonLeft >= focusBounds.frameLeft - 1 &&
                    focusBounds.buttonRight <= focusBounds.frameRight + 1,
                  'Focused delivery is clipped by footer scroll',
                );
              if (focusBounds.buttonWidth <= focusBounds.frameWidth) await textEndpoints(delivery);
              if (
                width === 900 &&
                scale === 1.5 &&
                focusBounds.buttonWidth <= focusBounds.frameWidth
              )
                assert(
                  await footer.evaluate((node) => node.scrollLeft > 0),
                  'Tab did not reveal overflowed delivery',
                );
              // The final observed-time span is not focusable: exercise native horizontal keys,
              // rather than claiming that a programmatic scroll proves keyboard access.
              if (focusBounds.buttonWidth > focusBounds.frameWidth) {
                for (let index = 0; index < 48; index++) await page.keyboard.press('ArrowLeft');
                await page.waitForTimeout(200);
                assert(
                  await delivery.evaluate((node) => {
                    const box = node.getBoundingClientRect();
                    const scroller = node.closest('footer');
                    const left = scroller.getBoundingClientRect().left + scroller.clientLeft;
                    return box.left >= left - 1 && box.left <= left + scroller.clientWidth - 1;
                  }),
                  'Keyboard cannot reveal the beginning of the long delivery label',
                );
                await textEndpoints(delivery, ['first']);
              }
              for (let index = 0; index < 48; index++) await page.keyboard.press('ArrowRight');
              await page.waitForTimeout(200);
              if (
                ['capture', 'final'].includes(process.env.FOOTER_QA_OVERLAY) &&
                locale === 'pt' &&
                width === 900 &&
                scale === 1.5 &&
                theme === 'dark-hc'
              ) {
                const path = resolve(out, 'footer-overlay-tail.png');
                await page.screenshot({ path });
                shots.push(path);
              }
              assert(
                await footer
                  .locator(':scope > span')
                  .last()
                  .evaluate((node) => {
                    const box = node.getBoundingClientRect();
                    const scroller = node.closest('footer');
                    const left = scroller.getBoundingClientRect().left + scroller.clientLeft;
                    return box.left >= left - 1 && box.right <= left + scroller.clientWidth + 1;
                  }),
                'Keyboard cannot reveal the observed-time tail',
              );
              await textEndpoints(footer.locator(':scope > span').last());
              if (focusBounds.buttonWidth > focusBounds.frameWidth)
                assert(
                  await delivery.evaluate((node) => {
                    const box = node.getBoundingClientRect();
                    const scroller = node.closest('footer');
                    const left = scroller.getBoundingClientRect().left + scroller.clientLeft;
                    return box.right >= left + 1 && box.right <= left + scroller.clientWidth + 1;
                  }),
                  'Keyboard cannot reveal the end of the long delivery label',
                );
              if (focusBounds.buttonWidth > focusBounds.frameWidth)
                await textEndpoints(delivery, ['last']);
              const endScroll = await footer.evaluate((node) => node.scrollLeft);
              if (endScroll > 1) {
                await page.keyboard.press('ArrowLeft');
                assert(
                  (await footer.evaluate((node) => node.scrollLeft)) < endScroll,
                  'Delivery Left did not reverse horizontal scrolling',
                );
                assert(
                  await delivery.evaluate((node) => document.activeElement === node),
                  'Delivery arrow changed focus',
                );
                for (let index = 0; index < 48; index++) await page.keyboard.press('ArrowRight');
              }
              await sensor.focus();
              const sensorStart = await footer.evaluate((node) => node.scrollLeft);
              const maximumScroll = await footer.evaluate(
                (node) => node.scrollWidth - node.clientWidth,
              );
              if (sensorStart < maximumScroll - 1) {
                await page.keyboard.press('ArrowRight');
                assert(
                  (await footer.evaluate((node) => node.scrollLeft)) > sensorStart,
                  'Sensor Right did not scroll horizontal content',
                );
                assert(
                  await sensor.evaluate((node) => document.activeElement === node),
                  'Sensor arrow changed focus',
                );
                const sensorRight = await footer.evaluate((node) => node.scrollLeft);
                await page.keyboard.press('ArrowLeft');
                assert(
                  (await footer.evaluate((node) => node.scrollLeft)) < sensorRight,
                  'Sensor Left did not reverse horizontal scrolling',
                );
              }
              await delivery.focus();
              await delivery.evaluate((node) => {
                window.footerModifierEvents = [];
                window.footerModifierListener = (event) => {
                  if (
                    event.key === 'ArrowRight' &&
                    (event.ctrlKey || event.metaKey || event.shiftKey)
                  )
                    window.footerModifierEvents.push({
                      defaultPrevented: event.defaultPrevented,
                      trusted: event.isTrusted,
                    });
                };
                node.addEventListener('keydown', window.footerModifierListener);
              });
              for (const key of ['Control+ArrowRight', 'Meta+ArrowRight', 'Shift+ArrowRight'])
                await page.keyboard.press(key);
              assert.deepEqual(
                await delivery.evaluate((node) => {
                  node.removeEventListener('keydown', window.footerModifierListener);
                  return window.footerModifierEvents;
                }),
                Array.from({ length: 3 }, () => ({ defaultPrevented: false, trusted: true })),
                'Footer intercepted a modified arrow',
              );
              assert(
                await delivery.evaluate((node) => document.activeElement === node),
                'Modified footer arrow changed focus',
              );
              for (let index = 0; index < 48; index++) await page.keyboard.press('ArrowRight');
              await textEndpoints(footer.locator(':scope > span').last());
              const trigger = page.locator('.alert-trigger');
              assert(
                await trigger.evaluate((node) => {
                  const box = node.getBoundingClientRect();
                  const footer = document
                    .querySelector('.observatory-app footer')
                    .getBoundingClientRect();
                  const hit = document.elementFromPoint(
                    box.left + box.width / 2,
                    box.top + box.height / 2,
                  );
                  return (
                    box.left >= footer.right &&
                    box.top >= footer.top &&
                    box.bottom <= footer.bottom &&
                    node.contains(hit)
                  );
                }),
                'Alerts trigger is covered or overlaps footer',
              );
              await trigger.focus();
              await page.keyboard.press('Enter');
              const center = page.getByRole('dialog', {
                name: t('Sensitive activity review'),
                exact: true,
              });
              await center.waitFor();
              assert(
                await center.evaluate((node) => {
                  const box = node.getBoundingClientRect();
                  const trigger = document.querySelector('.alert-trigger').getBoundingClientRect();
                  return box.top >= 0 && box.bottom <= trigger.top;
                }),
                'Alert review overlaps trigger or leaves viewport',
              );
              await textEndpoints(footer.locator(':scope > span').last());
              if (
                ['capture', 'final'].includes(process.env.FOOTER_QA_OVERLAY) &&
                locale === 'pt' &&
                width === 900 &&
                scale === 1.5 &&
                theme === 'dark-hc'
              ) {
                const path = resolve(out, 'footer-overlay-center.png');
                await page.screenshot({ path });
                shots.push(path);
              }
              const close = center.getByRole('button', {
                name: t('Close alert review'),
                exact: true,
              });
              await close.focus();
              await page.keyboard.press('Enter');
              await center.waitFor({ state: 'hidden' });
              assert(
                await trigger.evaluate((node) => document.activeElement === node),
                'Close did not restore Alerts focus',
              );
              await page.keyboard.press('Enter');
              await center.waitFor();
              await page.keyboard.press('Escape');
              await center.waitFor({ state: 'hidden' });
              assert(
                await trigger.evaluate((node) => document.activeElement === node),
                'Escape did not restore Alerts focus',
              );
              await page.evaluate(() =>
                window.footerFixture.onFileAccess({
                  eventId: 'footer-qa-' + Date.now(),
                  action: 'read',
                  timestamp: Date.now(),
                  file: 'X:/Fixture/.env',
                  agent: 'Codex',
                  sensitive: true,
                  reason: 'Synthetic footer notification',
                  attribution: { status: 'inferred' },
                }),
              );
              const toast = page.locator('.notifications .sensitive');
              await toast.waitFor();
              assert(
                await toast.evaluate(
                  (node) =>
                    node.getBoundingClientRect().bottom <=
                    document.querySelector('.alert-trigger').getBoundingClientRect().top,
                ),
                'Toast overlaps Alerts trigger',
              );
              await textEndpoints(footer.locator(':scope > span').last());
              if (
                process.env.FOOTER_QA_OVERLAY === 'capture' &&
                locale === 'pt' &&
                width === 900 &&
                scale === 1.5 &&
                theme === 'dark-hc'
              ) {
                const path = resolve(out, 'footer-overlay-toast.png');
                await page.screenshot({ path });
                shots.push(path);
              }
              const dismiss = toast.getByRole('button', {
                name: t('Dismiss notification'),
                exact: true,
              });
              await dismiss.focus();
              await page.keyboard.press('Enter');
              await toast.waitFor({ state: 'hidden' });
              assert.deepEqual(
                await page.evaluate(() => ({
                  mainScroll: document.querySelector('#main').scrollTop,
                  sidebarScroll: document.querySelector('.sidebar nav').scrollTop,
                  headerTop: document.querySelector('.topbar').getBoundingClientRect().top,
                  windowY: scrollY,
                })),
                beforeFocus,
                'Footer focus/keys shifted another surface',
              );
              await delivery.focus();
              await page.keyboard.press('Shift+Tab');
              assert(
                await sensor.evaluate((node) => document.activeElement === node),
                'Reverse Tab missed sensor',
              );
              await page.keyboard.press('Tab');
              await page.keyboard.press('Enter');
              await main
                .getByRole('heading', { name: t('Audit'), level: 1, exact: true })
                .waitFor();
              assert.equal(
                await main
                  .getByRole('tab', { name: t('Delivery'), exact: true })
                  .getAttribute('aria-selected'),
                'true',
              );
              await sensor.focus();
              await page.keyboard.press('Enter');
              await main
                .getByRole('heading', { name: t('Statistics'), level: 1, exact: true })
                .waitFor();
              assert.equal(
                await main
                  .getByRole('tab', { name: t('Sensors'), exact: true })
                  .getAttribute('aria-selected'),
                'true',
              );
              await page.keyboard.press('Alt+ArrowLeft');
              await main
                .getByRole('heading', { name: t('Audit'), level: 1, exact: true })
                .waitFor();
              await page.keyboard.press('Alt+ArrowRight');
              await main
                .getByRole('heading', { name: t('Statistics'), level: 1, exact: true })
                .waitFor();
              await page
                .locator('.sidebar')
                .getByRole('button', { name: t('Rules & permissions'), exact: true })
                .click();
              const network = main.getByLabel(t('Network'), { exact: true });
              await network.selectOption('block');
              const resetDetails = main.locator('.permission-reset');
              if (!(await resetDetails.evaluate((node) => node.open)))
                await resetDetails.locator('summary').press('Enter');
              for (const control of [
                network,
                main.getByRole('button', { name: t('Save permissions'), exact: true }),
                main.getByRole('button', { name: t('Reset all to defaults'), exact: true }),
              ]) {
                await control.focus();
                assert(
                  await control.evaluate((node) => {
                    const box = node.getBoundingClientRect();
                    return [
                      [0.2, 0.5],
                      [0.5, 0.5],
                      [0.8, 0.5],
                    ].every(([x, y]) =>
                      node.contains(
                        document.elementFromPoint(
                          box.left + box.width * x,
                          box.top + box.height * y,
                        ),
                      ),
                    );
                  }),
                  'Focused permission control is occluded',
                );
                if (await control.evaluate((node) => node.tagName === 'BUTTON'))
                  await textEndpoints(control);
                assert(
                  await control.evaluate((node) => {
                    const box = node.getBoundingClientRect();
                    const main = document.querySelector('#main').getBoundingClientRect();
                    const footer = document
                      .querySelector('.observatory-app footer')
                      .getBoundingClientRect();
                    return (
                      document.activeElement === node &&
                      box.top >= main.top - 1 &&
                      box.bottom <= Math.min(main.bottom, footer.top) + 1
                    );
                  }),
                  'Focused permission control is covered or unreachable',
                );
              }
            }
          }
      } finally {
        await page.close();
      }
    }
    assert.deepEqual(errors, [], 'footer browser runtime errors');
    console.log(
      'Footer: 160 status layouts; full metrics/delivery copy, Tab scroll and Audit/Sensors routes; permission controls remain reachable. Synthetic host only.',
    );
  } finally {
    await writeFile(
      resolve(out, `footer-${phase}-measurements.json`),
      JSON.stringify({ phase, measurements, shots, errors }, null, 2) + '\n',
    );
  }
}
