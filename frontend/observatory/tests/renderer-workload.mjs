import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { chromium } from 'playwright';

// Compare built desktop renderers under identical, explicitly synthetic deliveries.
// Usage: node frontend/observatory/tests/renderer-workload.mjs <renderer-dir> <label>
const root = resolve(process.argv[2] || 'dist/renderer');
const label = process.argv[3] || 'current';
assert(/^[a-z0-9-]+$/i.test(label));
const output = resolve('dist/renderer-workload');
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
};
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    const file = resolve(
      root,
      '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname),
    );
    if (!file.startsWith(root + sep)) {
      response.writeHead(403).end();
      return;
    }
    const bytes = await readFile(file);
    response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' });
    response.end(bytes);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    locale: 'en-US',
    timezoneId: 'UTC',
    reducedMotion: 'no-preference',
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const listeners = {};
    const epoch = Date.UTC(2026, 8, 10, 12);
    let clock = epoch;
    Date.now = () => clock;
    localStorage.setItem('aegis-motion', 'full');
    localStorage.setItem('aegis-theme', 'dark');
    const agents = Array.from({ length: 49 }, (_, i) => ({
      agent: ['Codex', 'Claude Code', 'Cursor', 'Gemini CLI'][i % 4],
      process: 'fixture.exe',
      pid: i + 100,
      instanceId: `${i + 100}:fixture`,
      instanceIdSource: 'os',
      category: 'cli-tool',
      cwd: 'X:/synthetic-project',
    }));
    const stats = {
      currentAgents: 49,
      monitoringStarted: epoch - 100000,
      appHealth: { state: 'HEALTHY', populationReliable: true, identityDegraded: false },
    };
    const settings = { scanIntervalSec: 1, uiScale: 1, darkMode: true };
    window.aegis = new Proxy(
      {},
      {
        get(_target, name) {
          if (String(name).startsWith('on'))
            return (callback) => {
              listeners[name] = callback;
              return () => {
                delete listeners[name];
              };
            };
          return async () =>
            name === 'getStats'
              ? stats
              : name === 'getSettings'
                ? settings
                : name === 'getAppVersion'
                  ? 'workload-fixture'
                  : name === 'getResourceUsage'
                    ? { memMB: 80, heapMB: 20 }
                    : [];
        },
      },
    );
    window.workload = {
      seed() {
        listeners.onScanBatch({ stats, agents: structuredClone(agents) });
        listeners.onFileAccess(
          Array.from({ length: 500 }, (_, i) => {
            const a = agents[i % agents.length];
            return {
              agent: a.agent,
              pid: a.pid,
              instanceId: a.instanceId,
              timestamp: epoch - i * 100,
              file: `X:/synthetic-project/file-${i}.txt`,
              action: 'read',
              sensitive: i % 10 === 0,
              reason: '',
              attribution: { status: 'confirmed' },
            };
          }),
        );
        listeners.onNetworkUpdate(
          agents.map((a) => ({
            agent: a.agent,
            pid: a.pid,
            instanceId: a.instanceId,
            remoteIp: '192.0.2.1',
            remotePort: 443,
            verdict: 'unknown',
            verdictReason: 'ptr-missing',
          })),
        );
      },
      async deliver(sequence) {
        clock = epoch + sequence * 1000;
        listeners.onScanStatus({ scanning: true });
        await Promise.resolve();
        listeners.onScanBatch({
          agents: structuredClone(agents),
          stats: { ...stats },
          resourceUsage: { memMB: 80, heapMB: 20, cpuUser: sequence * 10000, cpuSystem: 0 },
        });
        await Promise.resolve();
        listeners.onAgentResourceUsage(
          agents.map((a) => ({
            instanceId: a.instanceId,
            cpu: sequence % 30,
            memMb: 100,
            collectionSequence: sequence,
            collectedAt: clock,
          })),
        );
        await Promise.resolve();
        listeners.onScanStatus({ scanning: false });
        await new Promise(requestAnimationFrame);
      },
    };
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.getByRole('heading', { name: 'Monitoring', exact: true, level: 1 }).waitFor();
  await page.evaluate(() => window.workload.seed());
  const session = await page.context().newCDPSession(page);
  await session.send('Performance.enable');
  const metric = async () =>
    Object.fromEntries(
      (await session.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]),
    );
  for (let i = 1; i <= 5; i++) await page.evaluate((i) => window.workload.deliver(i), i);
  await session.send('HeapProfiler.collectGarbage');
  const before = await metric();
  const start = performance.now();
  for (let i = 6; i <= 125; i++) await page.evaluate((i) => window.workload.deliver(i), i);
  const elapsedMs = performance.now() - start;
  const after = await metric();
  const navigation = [],
    retained = [];
  for (let round = 0; round < 4; round++) {
    for (const name of ['Agents', 'Events', 'Network', 'Statistics', 'Monitoring']) {
      const ms = await page.evaluate((name) => {
        const start = performance.now();
        [...document.querySelectorAll('.sidebar button')]
          .find((button) => button.getAttribute('aria-label') === name)
          .click();
        return new Promise((done) => {
          const observe = () =>
            document.querySelector('h1')?.textContent.trim() === name
              ? done(performance.now() - start)
              : setTimeout(observe, 0);
          observe();
        });
      }, name);
      navigation.push({ round, name, ms });
    }
    await session.send('HeapProfiler.collectGarbage');
    retained.push(await metric());
  }
  const visible = await page.evaluate(() => ({
    heading: document.querySelector('h1')?.textContent,
    summary: [...document.querySelectorAll('.summary-stat')].map((n) => n.textContent.trim()),
    nodes: document.querySelectorAll('*').length,
    animations: document.getAnimations().length,
  }));
  assert.equal(visible.heading, 'Monitoring');
  assert.equal(visible.summary[0].replace(/\s/g, ''), 'Agents4online49processesinsnapshot');
  assert.deepEqual(errors, []);
  await mkdir(output, { recursive: true });
  await page.screenshot({ path: resolve(output, `${label}.png`) });
  const result = {
    label,
    fixture:
      '49 processes, 500 file observations, 49 sockets, 120 ordered deliveries; synthetic desktop bridge; UTC/en-US; 1440x1000',
    elapsedMs,
    taskMs: (after.TaskDuration - before.TaskDuration) * 1000,
    scriptMs: (after.ScriptDuration - before.ScriptDuration) * 1000,
    layoutMs: (after.LayoutDuration - before.LayoutDuration) * 1000,
    before,
    after,
    retained,
    navigation,
    visible,
    errors,
  };
  await writeFile(resolve(output, `${label}.json`), JSON.stringify(result, null, 2));
  console.log(
    JSON.stringify({
      label,
      taskMs: result.taskMs,
      scriptMs: result.scriptMs,
      heapMiB: retained.map((m) => m.JSHeapUsedSize / 1048576),
      visible,
    }),
  );
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
