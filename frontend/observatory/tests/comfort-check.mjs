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
 * @since 0.14.1
 */
export async function checkFooter(browser, url, out) {
  const catalog = JSON.parse(
    await readFile(new URL('../translations/pt-BR.json', import.meta.url), 'utf8'),
  );
  const phase = process.env.FOOTER_QA_PHASE === 'red' ? 'red' : 'green';
  const measurements = [];
  const errors = [];
  const shots = [];
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
                if ((selected && !process.env.FOOTER_QA_READY_SHOT_ONLY) || readyShot) {
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
              await page.keyboard.press('Tab');
              assert(
                await delivery.evaluate((node) => document.activeElement === node),
                'Tab missed delivery',
              );
              const focusBounds = await delivery.evaluate((node) => {
                const box = node.getBoundingClientRect();
                const frame = node.closest('footer').getBoundingClientRect();
                return {
                  buttonLeft: box.left,
                  buttonRight: box.right,
                  buttonWidth: box.width,
                  frameLeft: frame.left,
                  frameRight: frame.right,
                  frameWidth: frame.width,
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
                for (let index = 0; index < 24; index++) await page.keyboard.press('ArrowLeft');
                await page.waitForTimeout(200);
                assert(
                  await delivery.evaluate((node) => {
                    const box = node.getBoundingClientRect();
                    const frame = node.closest('footer').getBoundingClientRect();
                    return box.left >= frame.left - 1 && box.left <= frame.right - 1;
                  }),
                  'Keyboard cannot reveal the beginning of the long delivery label',
                );
              }
              for (let index = 0; index < 24; index++) await page.keyboard.press('ArrowRight');
              await page.waitForTimeout(200);
              assert(
                await footer
                  .locator(':scope > span')
                  .last()
                  .evaluate((node) => {
                    const box = node.getBoundingClientRect();
                    const frame = node.closest('footer').getBoundingClientRect();
                    return box.left >= frame.left - 1 && box.right <= frame.right + 1;
                  }),
                'Keyboard cannot reveal the observed-time tail',
              );
              if (focusBounds.buttonWidth > focusBounds.frameWidth)
                assert(
                  await delivery.evaluate((node) => {
                    const box = node.getBoundingClientRect();
                    const frame = node.closest('footer').getBoundingClientRect();
                    return box.right >= frame.left + 1 && box.right <= frame.right + 1;
                  }),
                  'Keyboard cannot reveal the end of the long delivery label',
                );
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
