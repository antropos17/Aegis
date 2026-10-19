import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';

// Synthetic r2 regression metadata only; no native correlation evidence.
const out = process.argv[2];
assert(out, 'Pass an X-drive report directory');
await mkdir(out, { recursive: true });
const root = resolve('dist/renderer');
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const target = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!target.startsWith(root + sep)) throw Error('Outside renderer');
    response.setHeader(
      'Content-Type',
      {
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.html': 'text/html',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
      }[extname(target)] || 'application/octet-stream',
    );
    response.end(await readFile(target));
  } catch {
    response.writeHead(404);
    response.end();
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const results = [];
const errors = [];
try {
  for (const state of [
    'matched',
    'ambiguous',
    'incomplete',
    'partial',
    'global-reason',
    'hostile-enum',
    'hostile-wrapper',
  ]) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript((state) => {
      const candidate = {
        source: 'claude-code',
        sessionRef: 'a'.repeat(64),
        callRef: 'b'.repeat(64),
        toolName: 'Read',
        argsDigest: 'c'.repeat(64),
        objectDigest: 'd'.repeat(64),
        argsShape: { operation: 'read', objectKind: 'path' },
        startMs: 1000,
        endMs: 2000,
        deltaMs: 250,
        strength: 'confirmed',
        reasons: [],
      };
      const context = {
        schemaVersion: 1,
        relation: 'preceded-by',
        strength: 'confirmed',
        reasons: ['exact-binding-object-and-interval'],
        candidateCount: 1,
        candidatesTruncated: false,
        ambiguous: false,
        objectMatch: 'matched',
        sessionBinding: 'confirmed',
        candidates: [candidate],
      };
      if (state === 'ambiguous')
        Object.assign(context, {
          strength: 'confirmed',
          candidateCount: 12,
          candidatesTruncated: true,
          ambiguous: true,
          reasons: [
            'exact-binding-object-and-interval',
            'ambiguous-tool-calls',
            'context-truncated',
          ],
          candidates: [candidate, { ...candidate, callRef: 'e'.repeat(64), toolName: 'Edit' }],
        });
      if (state === 'incomplete') {
        // Historical inconsistent input must never retain a matched candidate badge.
        candidate.endMs = null;
        candidate.reasons = ['end-time-unavailable'];
      }
      if (state === 'partial') context.reasons.push('partial-source');
      if (state === 'global-reason') context.reasons.push('clock-skew-unavailable');
      if (state === 'hostile-enum') candidate.strength = { toString: null, valueOf: null };
      let entry = {
        type: 'file-accessed',
        action: 'accessed',
        timestamp: new Date().toISOString(),
        path: 'X:/Synthetic/.env',
        attribution: { status: 'unattributed', evidence: [] },
        toolContext: context,
      };
      if (state === 'hostile-wrapper') {
        const raw = { prompt: 'DO-NOT-DISPLAY', arguments: { path: 'DO-NOT-DISPLAY' } };
        const wrapped = { records: [{ toolContext: raw, source: 'Nested OS evidence retained' }] };
        entry = {
          type: 'security-event',
          timestamp: entry.timestamp,
          action: 'OS evidence retained',
          source: 'OS evidence retained',
          detail: { ...wrapped, toolContext: raw },
          details: wrapped,
          toolContext: { ...context, strength: { toString: null, valueOf: null } },
        };
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
                    ? 'Synthetic tool context fixture'
                    : method === 'getAgentDatabase'
                      ? { agents: [] }
                      : method === 'getCustomAgents' || method === 'getFalsePositives'
                        ? []
                        : {};
          },
        },
      );
    }, state);
    await page.goto(base);
    await page.locator('.sidebar').getByRole('button', { name: 'Audit', exact: true }).click();
    const trigger = page.locator('.observation-open').first();
    await trigger.focus();
    await trigger.press('Enter');
    const dialog = page.getByRole('dialog');
    const section = page.getByRole('region', { name: 'Preceding tool call' });
    await section.waitFor();
    assert.match(await section.innerText(), /Live tool correlation is unavailable/);
    assert(!/PID confirmed|[a-f0-9]{64}|DO-NOT-DISPLAY/.test(await section.innerText()));
    if (state === 'matched') assert.match(await section.innerText(), /Matched preceding call/);
    else
      assert(
        !/\bmatched\b|\bconfirmed\b/.test((await section.innerText()).toLowerCase()),
        `${state}: contradictory matched claim`,
      );
    assert(!/DO-NOT-DISPLAY/.test(await dialog.textContent()), `${state}: overview capsule leak`);
    if (state === 'ambiguous')
      assert.match(await section.innerText(), /Multiple candidates; no single tool call/);
    if (state === 'incomplete')
      assert.match(await section.innerText(), /completion time unavailable/);
    if (state === 'global-reason')
      assert.match(await section.innerText(), /Clock alignment is unavailable/);
    if (state === 'partial')
      assert.match(await section.innerText(), /Only part of the tool history/);
    if (state.startsWith('hostile'))
      assert.match(await section.innerText(), /could not be validated/);
    const overview = dialog.getByRole('tab', { name: 'Overview', exact: true });
    await overview.focus();
    await overview.press('ArrowRight');
    await dialog.getByRole('tab', { name: 'Attributes', exact: true }).waitFor();
    assert.equal(
      await dialog
        .getByRole('tab', { name: 'Attributes' })
        .evaluate((n) => n === document.activeElement),
      true,
    );
    assert(!/Session ref|Args digest|Call ref/.test(await dialog.innerText()));
    assert(!/DO-NOT-DISPLAY/.test(await dialog.textContent()), `${state}: attributes capsule leak`);
    if (state === 'hostile-wrapper') {
      await dialog.locator('details').evaluateAll((nodes) =>
        nodes.forEach((node) => {
          node.open = true;
        }),
      );
      assert.match(await dialog.innerText(), /Nested OS evidence retained/);
    }
    await page.keyboard.press('Home');
    await section.waitFor();
    assert.equal(await overview.evaluate((n) => n === document.activeElement), true);
    for (const [width, height, scale] of [
      [1200, 800, 1],
      [390, 640, 1],
    ]) {
      await page.setViewportSize({ width, height });
      for (const theme of [width === 390 ? 'light' : 'dark']) {
        await page.evaluate(
          ({ theme, scale }) => {
            document.documentElement.dataset.theme = theme;
            document.documentElement.style.setProperty('--ui-scale', String(scale));
          },
          { theme, scale },
        );
        await section.evaluate((node) => node.scrollIntoView({ block: 'start' }));
        await page.waitForFunction(() => !document.documentElement.dataset.transitionSurface);
        const layout = await dialog.evaluate((node) => {
          const box = node.getBoundingClientRect();
          const section = node.querySelector('.tool-context');
          const body = node.querySelector('#modal-body');
          const text = getComputedStyle(section);
          const luminance = (color) => {
            const rgb = color
              .match(/[\d.]+/g)
              .slice(0, 3)
              .map((v) => {
                const n = Number(v) / 255;
                return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
              });
            return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
          };
          const background = luminance(text.backgroundColor);
          const contrast = (color) => {
            const foreground = luminance(color);
            return (
              (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05)
            );
          };
          return {
            outside:
              box.x < 0 ||
              box.right > innerWidth + 1 ||
              box.top < 0 ||
              box.bottom > innerHeight + 1,
            bodyOverflow: body.scrollWidth > body.clientWidth + 1,
            sectionOverflow: section.scrollWidth > section.clientWidth + 1,
            color: text.color,
            background: text.backgroundColor,
            inkContrast: contrast(text.color),
            mutedContrast: contrast(getComputedStyle(section.querySelector('.limit')).color),
            warningContrast: section.querySelector('.context-warning')
              ? contrast(getComputedStyle(section.querySelector('.context-warning')).color)
              : null,
          };
        });
        assert.equal(layout.outside, false, `${state}/${width}/${theme}: dialog outside viewport`);
        assert.equal(layout.bodyOverflow, false, `${state}/${width}/${theme}: body overflow`);
        assert.equal(layout.sectionOverflow, false, `${state}/${width}/${theme}: context overflow`);
        assert(
          layout.inkContrast >= 4.5 &&
            layout.mutedContrast >= 4.5 &&
            (layout.warningContrast === null || layout.warningContrast >= 4.5),
          'section text contrast below 4.5:1',
        );
        results.push({ state, width, height, scale, theme, ...layout });
        if (width !== 1200 || theme === 'dark') {
          await page.evaluate(() => {
            let label = document.getElementById('synthetic-check-label');
            if (!label) {
              label = document.createElement('div');
              label.id = 'synthetic-check-label';
              document.body.append(label);
            }
            label.textContent = 'SYNTHETIC METADATA FIXTURE · NO LIVE CORRELATION';
            Object.assign(label.style, {
              position: 'fixed',
              top: '0',
              left: '0',
              zIndex: '100000',
              color: 'white',
              background: 'black',
              padding: '4px',
              font: '11px monospace',
            });
          });
          await page.screenshot({
            path: resolve(out, `synthetic-tool-context-r2-${state}-${width}-${theme}.png`),
          });
          if (
            width === 390 &&
            (await section.getByRole('list', { name: 'Recorded tool candidates' }).count())
          ) {
            await section
              .getByRole('list', { name: 'Recorded tool candidates' })
              .evaluate((node) => node.scrollIntoView({ block: 'end' }));
            await page.screenshot({
              path: resolve(
                out,
                `synthetic-tool-context-r2-${state}-${width}-${theme}-candidates.png`,
              ),
            });
          }
        }
        if (state === 'hostile-wrapper') {
          await overview.focus();
          await overview.press('ArrowRight');
          await dialog.locator('details').evaluateAll((nodes) =>
            nodes.forEach((node) => {
              node.open = true;
            }),
          );
          await dialog
            .getByText('Nested OS evidence retained', { exact: true })
            .first()
            .scrollIntoViewIfNeeded();
          assert(!/DO-NOT-DISPLAY/.test(await dialog.textContent()));
          assert(
            await dialog
              .locator('#modal-body')
              .evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
          );
          await page.screenshot({
            path: resolve(
              out,
              `synthetic-tool-context-r2-hostile-wrapper-${width}-${theme}-attributes.png`,
            ),
          });
          await page.keyboard.press('Home');
          await section.waitFor();
          await dialog.locator('details').evaluateAll((nodes) =>
            nodes.forEach((node) => {
              node.open = true;
            }),
          );
          await dialog
            .getByText('Nested OS evidence retained', { exact: true })
            .first()
            .scrollIntoViewIfNeeded();
          assert(!/DO-NOT-DISPLAY/.test(await dialog.textContent()));
          await page.screenshot({
            path: resolve(
              out,
              `synthetic-tool-context-r2-hostile-wrapper-${width}-${theme}-overview-evidence.png`,
            ),
          });
        }
      }
    }
    await dialog.getByRole('button', { name: 'Close details', exact: true }).focus();
    const focus = await dialog.getByRole('button', { name: 'Close details' }).evaluate((node) => {
      const css = getComputedStyle(node);
      return { width: css.outlineWidth, style: css.outlineStyle, color: css.outlineColor };
    });
    assert.notEqual(focus.style, 'none');
    assert(parseFloat(focus.width) >= 2);
    await page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(
      await trigger.evaluate((n) => n === document.activeElement),
      true,
      'modal did not restore trigger focus',
    );
    results.push({ state, keyboard: 'Tab arrows/Home, Escape, trigger focus restored', focus });
    await page.close();
  }
  assert.deepEqual(errors, []);
  await writeFile(
    resolve(out, 'browser-r2-receipt.json'),
    JSON.stringify(
      {
        synthetic: true,
        runtime: 'production renderer, Edge headless',
        liveCorrelationVerified: false,
        results,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(`${results.length - 7} synthetic r2 layout states and 7 keyboard journeys passed`);
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
