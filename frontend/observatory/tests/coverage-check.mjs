import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

function fixture(platform) {
  return {
    agents: [
      {
        agent: 'Synthetic Codex',
        process: 'codex',
        pid: 42,
        status: 'running',
        category: 'ai',
        instanceId: platform === 'darwin' ? 'unknown:42' : '42:12347',
        instanceIdSource: platform === 'darwin' ? 'unknown' : 'os',
      },
    ],
    stats: {
      appHealth: {
        state: 'DEGRADED',
        watchPlan: {
          state: 'HEALTHY',
          liveWatcherCount: 3,
          unavailableGroups: [],
          projectState: 'not-observed',
        },
        populationReliable: true,
        identityDegraded: false,
        sensors: {
          byId: {
            'fs-chokidar': { state: 'HEALTHY', lossCount: 0, consecutiveFailures: 0 },
            process: {
              state: 'HEALTHY',
              lossCount: 0,
              consecutiveFailures: 0,
              lastSuccessAt: 1792396800000,
            },
            'etw-file':
              platform === 'windows'
                ? { state: 'DISABLED', detail: 'diagnostic-opt-in-required', lossCount: 0 }
                : { state: 'UNSUPPORTED', detail: 'windows-only', lossCount: 0 },
            ...(platform === 'windows'
              ? {}
              : {
                  'native-sensor': {
                    state: 'DEGRADED',
                    detail: 'unsupported-admission',
                    lossCount: 3,
                  },
                }),
          },
        },
      },
      nativeSensor:
        platform === 'windows'
          ? null
          : {
              platform,
              phase: 'running',
              reason: 'ready',
              mode: platform === 'darwin' ? 'libproc' : 'procfs',
              modeReason: 'startup-fallback',
              providerState: 'HEALTHY',
              watchScope: platform === 'darwin' ? 'identity-unavailable' : 'current',
              pathScope: 'explicit-directories',
              paused: false,
              qualification: 'unverified',
              polling: 'unchanged',
              coverage: {
                exec: 'coverage-lost',
                exit: 'coverage-lost',
                fork: 'coverage-lost',
                fileOpen: 'coverage-lost',
                tcpConnect: 'coverage-lost',
              },
              admission: { state: 'unsupported-admission', accepted: 0, rejected: 7 },
              lossCount: 3,
              restart: { used: 1, remaining: 2, lastAt: null },
            },
    },
  };
}

/** Check a finite synthetic browser matrix against the production renderer bundle.
 * @param {import('playwright').Browser} browser Browser @param {string} url Static renderer URL
 * @param {string} out Owned artifact directory @param {string[]} only Optional scenario identities
 * @returns {Promise<object[]>} Evidence @since 0.19.2-beta
 */
export async function checkCoverage(browser, url, out, only = []) {
  await mkdir(out, { recursive: true });
  const results = [];
  for (const scenario of [
    {
      id: 'linux-dark-desktop',
      platform: 'linux',
      motion: 'full',
      theme: 'dark',
      locale: 'en',
      width: 1200,
      height: 800,
    },
    {
      id: 'mac-light-pt-desktop',
      platform: 'darwin',
      theme: 'light',
      locale: 'pt',
      width: 900,
      height: 600,
    },
    {
      id: 'linux-dark-short',
      platform: 'linux',
      theme: 'dark',
      locale: 'en',
      width: 390,
      height: 560,
    },
    {
      id: 'windows-light-pt-short',
      platform: 'windows',
      theme: 'light',
      locale: 'pt',
      width: 390,
      height: 560,
    },
    {
      id: 'missing-light-desktop',
      platform: 'missing',
      theme: 'light',
      locale: 'en',
      width: 1200,
      height: 800,
    },
    {
      id: 'loading-dark-short',
      platform: 'linux',
      state: 'loading',
      theme: 'dark',
      locale: 'en',
      width: 390,
      height: 560,
    },
    {
      id: 'error-light-short',
      platform: 'linux',
      state: 'error',
      theme: 'light',
      locale: 'en',
      width: 390,
      height: 560,
    },
    {
      id: 'stale-dark-desktop',
      platform: 'linux',
      state: 'stale',
      theme: 'dark',
      locale: 'en',
      width: 900,
      height: 600,
    },
    {
      id: 'hostile-dark-short',
      platform: 'linux',
      state: 'hostile',
      theme: 'dark',
      locale: 'en',
      width: 390,
      height: 560,
    },
    {
      id: 'binary-missing-pt-short',
      platform: 'linux',
      state: 'factory-missing',
      theme: 'light',
      locale: 'pt',
      width: 390,
      height: 560,
    },
    {
      id: 'restart-pt-short',
      platform: 'linux',
      state: 'factory-restart',
      theme: 'dark',
      locale: 'pt',
      width: 390,
      height: 560,
    },
  ].filter((scenario) => !only.length || only.includes(scenario.id))) {
    const page = await browser.newPage({
      viewport: { width: scenario.width, height: scenario.height },
      reducedMotion: scenario.motion === 'full' ? 'no-preference' : 'reduce',
    });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const data = fixture(scenario.platform);
    if (scenario.platform === 'missing') delete data.stats.nativeSensor;
    if (scenario.state === 'factory-missing' || scenario.state === 'factory-restart') {
      Object.assign(data.stats.nativeSensor, {
        phase: scenario.state === 'factory-missing' ? 'unavailable' : 'waiting',
        reason: scenario.state === 'factory-missing' ? 'binary-missing' : 'restart-pending',
        mode: null,
        modeReason: null,
        providerState: 'FAILED',
      });
      data.stats.appHealth.sensors.byId['native-sensor'].state = 'FAILED';
    }
    if (scenario.state === 'hostile') {
      data.stats.nativeSensor.mode = 'C:/fixture-private-path';
      data.stats.nativeSensor.reason = 'C:/fixture-private-path';
      data.stats.nativeSensor.providerState = 'constructor';
      data.stats.appHealth.sensors.byId['C:/fixture-private-path'] = {
        state: 'C:/fixture-private-path',
      };
      data.agents[0].agent =
        'Synthetic <img src=x onerror=alert(1)> agent with a long display name';
    }
    try {
      await page.addInitScript(
        ({ scenario, data }) => {
          localStorage.setItem('aegis-advanced-mode', 'true');
          localStorage.setItem('aegis-theme', scenario.theme);
          localStorage.setItem('aegis-motion', scenario.motion ?? 'reduce');
          localStorage.setItem('aegis.language', scenario.locale);
          const listeners = new Map();
          window.projectFixtureCalls = [];
          window.coverageFixtureUpdate = (stats) => listeners.get('onStatsUpdate')?.(stats);
          window.coverageFixtureBatch = (batch) => listeners.get('onScanBatch')?.(batch);
          window.aegis = new Proxy(
            {},
            {
              get: (_, key) => {
                if (String(key).startsWith('on'))
                  return (callback) => {
                    listeners.set(key, callback);
                    if (key === 'onScanBatch' && !['loading', 'error'].includes(scenario.state))
                      queueMicrotask(() => callback(data));
                    return () => listeners.delete(key);
                  };
                return async (...args) => {
                  if (key === 'controlProjectWatch') window.projectFixtureCalls.push(args);
                  if (key === 'getStats') {
                    if (scenario.state === 'loading') return new Promise(() => {});
                    if (scenario.state === 'error') throw Error('Synthetic fixture unavailable');
                    return data.stats;
                  }
                  if (key === 'getSettings') return { darkMode: scenario.theme === 'dark' };
                  if (key === 'getUpdateStatus') return { status: 'idle' };
                  if (key === 'getFalsePositives') return [];
                  if (key === 'getAppVersion') return 'Synthetic coverage fixture';
                  return {};
                };
              },
            },
          );
        },
        { scenario, data },
      );
      await page.goto(url + '?view=coverage');
      const panel = page.locator('.coverage-workspace');
      await panel.waitFor();
      await page.evaluate(() => {
        const note = document.createElement('div');
        note.textContent = 'SYNTHETIC BROWSER FIXTURE · NO NATIVE CAPTURE';
        note.style.cssText =
          'position:fixed;bottom:0;left:0;right:0;z-index:9999;background:#222;color:#fff;font:11px/18px sans-serif;text-align:center;pointer-events:none';
        document.body.append(note);
      });
      if (scenario.state === 'stale') {
        data.stats.appHealth.populationReliable = false;
        await page.evaluate((stats) => window.coverageFixtureUpdate(stats), data.stats);
        await panel
          .getByText('Retained coverage readings. Current observation is unavailable.')
          .waitFor();
      }
      if (scenario.state === 'error') await panel.getByRole('alert').waitFor();
      if (scenario.state === 'loading')
        await panel.getByText('Waiting for coverage data…').waitFor();
      const layout = await panel.evaluate((node) => ({
        panelWidth: node.clientWidth,
        panelScrollWidth: node.scrollWidth,
        mainWidth: document.querySelector('#main').clientWidth,
        mainScrollWidth: document.querySelector('#main').scrollWidth,
        documentWidth: document.documentElement.clientWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        recurringAnimations: node
          .getAnimations({ subtree: true })
          .filter((animation) => animation.effect?.getTiming().iterations === Infinity).length,
      }));
      assert(layout.panelScrollWidth <= layout.panelWidth + 1, scenario.id + ' panel overflow');
      assert(layout.mainScrollWidth <= layout.mainWidth + 1, scenario.id + ' main overflow');
      assert(
        layout.documentScrollWidth <= layout.documentWidth + 1,
        scenario.id + ' document overflow',
      );
      assert.equal(layout.recurringAnimations, 0, scenario.id + ' recurring coverage animation');
      const contrast = await panel.evaluate((node) => {
        const luminance = (color) => {
          const channels = color
            .match(/[\d.]+/g)
            .slice(0, 3)
            .map(Number)
            .map((part) => {
              const value = part / 255;
              return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
            });
          return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
        };
        const background = luminance(
          getComputedStyle(node.querySelector('.panel')).backgroundColor,
        );
        const values = ['dt', 'dd', '.muted'].map((selector) => {
          const foreground = luminance(getComputedStyle(node.querySelector(selector)).color);
          return (
            (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05)
          );
        });
        const notice = node.querySelector('.notice');
        if (notice) {
          const text = luminance(getComputedStyle(notice).color);
          const fill = luminance(getComputedStyle(notice).backgroundColor);
          values.push((Math.max(text, fill) + 0.05) / (Math.min(text, fill) + 0.05));
        }
        return values;
      });
      assert(
        contrast.every((ratio) => ratio >= 4.5),
        scenario.id + ' text contrast',
      );
      assert(
        !(await panel.innerText()).includes('C:/fixture-private-path'),
        'fixed diagnostics leaked',
      );
      assert.equal(await panel.locator('img').count(), 0, 'agent display text interpreted as HTML');
      await page.screenshot({ path: resolve(out, `synthetic-${scenario.id}.png`) });
      await panel
        .getByRole('region', {
          name: scenario.locale === 'pt' ? 'Sensor nativo da plataforma' : 'Native platform sensor',
        })
        .scrollIntoViewIfNeeded();
      if (scenario.state === 'factory-missing')
        await panel
          .getByText('O executável do sensor está ausente', { exact: true })
          .scrollIntoViewIfNeeded();
      if (scenario.state === 'factory-restart') {
        await panel.getByText('Aguardando reinicialização', { exact: true }).waitFor();
        await panel.getByText('Reinicialização agendada', { exact: true }).waitFor();
        await panel.getByText('Reinicialização agendada', { exact: true }).scrollIntoViewIfNeeded();
      }
      await page.screenshot({ path: resolve(out, `synthetic-${scenario.id}-native.png`) });
      if (scenario.state === 'factory-restart') {
        Object.assign(data.stats.nativeSensor, {
          phase: 'failed',
          reason: 'restart-exhausted',
          restart: { used: 3, remaining: 0, lastAt: null },
        });
        await page.evaluate((stats) => window.coverageFixtureUpdate(stats), data.stats);
        await panel.getByText('Limite de reinicializações atingido', { exact: true }).waitFor();
        await panel.getByText('Detalhe do provedor', { exact: true }).scrollIntoViewIfNeeded();
        await page.screenshot({ path: resolve(out, 'synthetic-restart-exhausted-pt-short.png') });
      }
      await panel.locator('.agent-list').scrollIntoViewIfNeeded();
      await page.screenshot({ path: resolve(out, `synthetic-${scenario.id}-agents.png`) });
      assert.deepEqual(errors, [], scenario.id + ' page errors');
      results.push({ ...scenario, layout, contrast, errors });
      if (scenario.id === 'linux-dark-desktop') {
        const project = panel.getByRole('region', { name: 'Project changes' });
        for (const [state, label] of [
          ['not-observed', 'Not observed'],
          ['starting', 'Starting'],
          ['observed', 'Observed'],
          ['unavailable', 'Unavailable'],
          ['unknown', 'Unknown'],
        ]) {
          data.stats.appHealth.watchPlan.projectState = state;
          await page.evaluate((stats) => window.coverageFixtureUpdate(stats), data.stats);
          await project.getByText(label, { exact: true }).waitFor();
        }
        data.stats.appHealth.watchPlan.projectState = 'not-observed';
        await page.evaluate((stats) => window.coverageFixtureUpdate(stats), data.stats);
        await project
          .getByText(
            'Project changes are not observed. Choose a project folder in Monitoring settings.',
            { exact: true },
          )
          .waitFor();
        await project.getByRole('button', { name: 'Project folder settings' }).focus();
        await page.keyboard.press('Enter');
        await page.getByRole('heading', { name: 'Settings', level: 1, exact: true }).waitFor();
        const monitoring = page
          .getByRole('navigation', { name: 'Settings sections' })
          .getByRole('button', { name: 'Monitoring', exact: true });
        assert.equal(await monitoring.getAttribute('aria-current'), 'location');
        await page.getByRole('heading', { name: 'Monitoring', level: 2, exact: true }).waitFor();
        assert(
          await page
            .getByRole('heading', { name: 'Monitoring', level: 2, exact: true })
            .evaluate((node) => node === document.activeElement),
          'project settings focus',
        );
        assert(
          (await page.evaluate(() => window.projectFixtureCalls)).every(
            (args) => args[0] === 'status',
          ),
          'navigation unexpectedly chose a folder',
        );
        await page.getByRole('button', { name: 'View monitoring coverage' }).click();
        await panel.waitFor({ state: 'visible' });
        results.at(-1).projectCoverage = {
          states: 5,
          settingsMonitoring: true,
          nativeConsent: false,
        };
        await panel.getByRole('button', { name: 'Sensor statistics', exact: true }).focus();
        await page.keyboard.press('Enter');
        await page.getByRole('heading', { name: 'Statistics', level: 1, exact: true }).waitFor();
        assert.equal(
          await page
            .getByRole('button', { name: 'Sensors', exact: true })
            .getAttribute('aria-current'),
          'location',
        );
        assert(
          await page.locator('#main').evaluate((node) => node.contains(document.activeElement)),
          'statistics focus',
        );
        await page.locator('footer button').first().focus();
        await page.keyboard.press('Enter');
        await panel.waitFor({ state: 'visible' });
        assert(
          await page.locator('#main').evaluate((node) => document.activeElement === node),
          'coverage focus',
        );
        const action = panel.getByRole('button', { name: 'Review action control' });
        await action.focus();
        await page.keyboard.press('Enter');
        await page
          .getByRole('heading', { name: 'Action control', level: 1, exact: true })
          .waitFor();
        assert(
          await page.locator('#main').evaluate((node) => document.activeElement === node),
          'action control focus',
        );
        await page.keyboard.press('Alt+ArrowLeft');
        await panel.waitFor({ state: 'visible' });
        await page
          .locator('.sidebar')
          .getByRole('button', { name: 'Settings', exact: true })
          .click();
        await page.getByRole('button', { name: 'View monitoring coverage' }).focus();
        await page.keyboard.press('Enter');
        await panel.waitFor({ state: 'visible' });
        await page.keyboard.press('Control+k');
        await page.getByRole('combobox').fill('native polling');
        await page.getByRole('option').waitFor();
        await page.keyboard.press('Enter');
        await page.getByRole('heading', { name: 'Coverage', level: 1, exact: true }).waitFor();
        const focus = panel.getByRole('button', { name: 'Sensor statistics', exact: true });
        await focus.focus();
        await page.keyboard.press('Tab');
        assert(
          await action.evaluate((node) => node === document.activeElement),
          'toolbar tab order',
        );
        assert(
          await action.evaluate((node) => getComputedStyle(node).outlineStyle !== 'none'),
          'visible focus indicator',
        );
        await page.screenshot({ path: resolve(out, 'synthetic-keyboard-focus.png') });
        await page
          .locator('.sidebar')
          .getByRole('button', { name: 'Monitoring', exact: true })
          .click();
        await page.getByRole('button', { name: 'Pause view', exact: true }).click();
        const current = structuredClone(data.stats);
        Object.assign(current.nativeSensor, {
          lossCount: 29,
          providerState: 'FAILED',
          reason: 'binary-missing',
          phase: 'unavailable',
        });
        await page.evaluate(({ stats, agents }) => window.coverageFixtureBatch({ stats, agents }), {
          stats: current,
          agents: [
            { ...data.agents[0], agent: 'Synthetic latest Codex', pid: 43, instanceId: '43:999' },
          ],
        });
        await page.locator('footer button').first().focus();
        await page.keyboard.press('Enter');
        await panel.waitFor({ state: 'visible' });
        const native = panel.getByRole('region', { name: 'Native platform sensor' });
        assert.equal(
          await native
            .getByText('Observed loss', { exact: true })
            .evaluate((node) => node.nextElementSibling.textContent),
          '29',
        );
        await native.getByText('Sensor executable is missing', { exact: true }).waitFor();
        await panel
          .getByRole('region', { name: 'Per-agent coverage' })
          .getByText('Synthetic latest Codex', { exact: true })
          .waitFor();
        await native.getByText('Provider detail', { exact: true }).scrollIntoViewIfNeeded();
        await page.screenshot({
          path: resolve(out, 'synthetic-paused-overview-current-coverage.png'),
        });
        current.nativeSensor.lossCount = 41;
        current.appHealth.populationReliable = false;
        await page.evaluate((stats) => window.coverageFixtureUpdate(stats), current);
        await panel
          .getByText('Retained coverage readings. Current observation is unavailable.', {
            exact: true,
          })
          .waitFor();
        assert.equal(
          await native
            .getByText('Observed loss', { exact: true })
            .evaluate((node) => node.nextElementSibling.textContent),
          '41',
        );
        await page.screenshot({
          path: resolve(out, 'synthetic-paused-overview-current-outage.png'),
        });
        await page.keyboard.press('Alt+ArrowLeft');
        await page.getByRole('button', { name: 'Resume view', exact: true }).waitFor();
        const retained = page.getByRole('complementary', { name: 'Observed agents' });
        assert(
          (await retained.innerText()).includes('Synthetic Codex'),
          'paused Overview population was replaced',
        );
        assert(
          !(await retained.innerText()).includes('Synthetic latest Codex'),
          'paused Overview advanced to current population',
        );
        await page.screenshot({
          path: resolve(out, 'synthetic-overview-still-paused-retained.png'),
        });
        results.at(-1).pauseNavigation = {
          currentLoss: 29,
          outageLoss: 41,
          overviewStillPaused: true,
          overviewRetainedAgent: 'Synthetic Codex',
          currentCoverageAgent: 'Synthetic latest Codex',
        };
        assert.deepEqual(errors, [], 'pause navigation page errors');
      }
    } finally {
      await page.close();
    }
  }
  await writeFile(
    resolve(out, 'browser-matrix.json'),
    JSON.stringify({ synthetic: true, nativeCapture: false, results }, null, 2),
  );
  return results;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve('dist/renderer');
  const server = createServer(async (request, response) => {
    const name = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const target = resolve(root, '.' + (name === '/' ? '/index.html' : name));
    if (!target.startsWith(root + sep)) {
      response.writeHead(403);
      response.end();
      return;
    }
    try {
      response.setHeader(
        'Content-Type',
        {
          '.html': 'text/html',
          '.js': 'text/javascript',
          '.css': 'text/css',
          '.svg': 'image/svg+xml',
        }[extname(target)] ?? 'application/octet-stream',
      );
      response.end(await readFile(target));
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const browser = await chromium.launch({
    headless: true,
    ...(process.argv[3] ? { channel: process.argv[3] } : {}),
  });
  try {
    const rows = await checkCoverage(
      browser,
      `http://127.0.0.1:${server.address().port}/`,
      resolve(process.argv[2] ?? 'out/coverage-browser'),
      process.argv[4]?.split(',') ?? [],
    );
    console.log(
      `Coverage: ${rows.length} synthetic layouts, keyboard routes and focus passed. Browser ${browser.version()}.`,
    );
  } finally {
    await browser.close();
    await new Promise((done) => server.close(done));
  }
}
