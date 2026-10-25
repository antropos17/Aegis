import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Synthetic process/OS observations through existing main test seams. Real
// production entrypoint, local files, owned IPC/preload and rendered interaction.
// This does not qualify a genuine provider or native sensor.
const root = process.cwd();
const out = path.resolve(process.env.AEGIS_W4_SMOKE_OUT || 'dist/electron-qa/live-tool-context');
await fs.mkdir(out, { recursive: true });
const home = path.join(out, 'home');
const project = path.join(home, 'project');
const start = Date.now() - 3000;
const sessionId = '12345678-1234-4234-9234-123456789abc';
const eventId = '98765432-1234-4234-9234-123456789abc';
const marker = 'W4_PRIVATE_CONTENT_MUST_NOT_LEAVE_SOURCE';
const file = path.join(project, 'w4-owned.env');
const registry = path.join(home, '.claude', 'sessions', '424242.json');
const transcript = path.join(
  home,
  '.claude',
  'projects',
  project.replace(/[/\\:.]/g, '-'),
  `${sessionId}.jsonl`,
);
await fs.mkdir(project, { recursive: true });
await fs.mkdir(path.dirname(registry), { recursive: true });
await fs.mkdir(path.dirname(transcript), { recursive: true });
await fs.writeFile(registry, JSON.stringify({ sessionId, cwd: project, startedAt: start + 100 }));
await fs.writeFile(file, 'synthetic fixture only');
await fs.writeFile(
  transcript,
  [
    {
      type: 'assistant',
      sessionId,
      cwd: project,
      timestamp: new Date(start + 1000).toISOString(),
      message: {
        content: [
          { type: 'text', text: marker },
          {
            type: 'tool_use',
            id: 'private-call',
            name: 'Read',
            input: { file_path: file, private: marker },
          },
        ],
      },
    },
    {
      type: 'user',
      sessionId,
      cwd: project,
      timestamp: new Date(start + 2000).toISOString(),
      message: { content: [{ type: 'tool_result', tool_use_id: 'private-call', content: marker }] },
    },
  ]
    .map((row) => JSON.stringify(row))
    .join('\n') + '\n',
);
const env = { ...process.env, USERPROFILE: home, HOME: home };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  args: [
    root,
    `--user-data-dir=${path.join(out, 'profile')}`,
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
  ],
  env,
  timeout: 45000,
});
let page;
try {
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  console.log('Opened isolated Electron window');
  await page
    .getByRole('heading', { name: 'Monitoring', exact: true, level: 1 })
    .waitFor({ timeout: 30000 });
  await page.waitForFunction(
    async () => (await window.aegis.getStats()).appHealth?.state !== 'BOOTING',
    null,
    { timeout: 30000 },
  );
  await page.evaluate((id) => {
    window.__w4Delivered = false;
    const off = window.aegis.onFileAccess((value) => {
      const rows = Array.isArray(value) ? value : [value];
      if (rows.some((row) => row.eventId === id)) {
        window.__w4Delivered = true;
        off();
      }
    });
  }, eventId);
  await app.evaluate(
    async ({ app }, data) => {
      const root = app.getAppPath();
      const require = process.mainModule
        .require('node:module')
        .createRequire(root + '/package.json');
      const main = require(root + '/src/main/main.js');
      const scanner = require(root + '/src/main/process-scanner.js');
      const scan = require(root + '/src/main/scan-loop.js');
      scan.stopScanIntervals();
      scanner.getProcessCapabilities = () => ({ populationReliable: true });
      main._setLatestAgentsForTest([
        {
          agent: 'Claude Code',
          pid: 424242,
          startTime: data.start,
          instanceId: `424242:${data.start}`,
          instanceIdSource: 'os',
          cwd: data.project,
          category: 'ai',
        },
      ]);
      main.onFileEvent({
        eventId: data.eventId,
        agent: 'Claude Code',
        pid: 424242,
        instanceId: `424242:${data.start}`,
        timestamp: data.start + 1500,
        file: data.file,
        action: 'accessed',
        category: 'ai',
        sensitive: false,
        attribution: { status: 'inferred', evidence: [] },
      });
      require(root + '/src/main/audit-logger.js').flush();
    },
    { start, project, file, eventId },
  );
  console.log('Published synthetic observation through main');
  // Wait for the batched push before focusing the reading surface. Its retained
  // snapshot intentionally holds subsequent arrivals while the user is reading.
  await page.waitForFunction(() => window.__w4Delivered === true, null, { polling: 100 });
  await page
    .locator('.sidebar')
    .getByRole('button', { name: 'Events', exact: true })
    .evaluate((button) => button.click());
  await page.getByLabel('Search events').fill('w4-owned.env');
  await page
    .locator('.observation-open')
    .first()
    .evaluate((button) => button.click());
  console.log('Opened observation details');
  await page.waitForFunction(
    () =>
      document.querySelector('.tool-context button') ||
      document.querySelector('.observation-history .recent-event'),
  );
  if (await page.locator('.observation-history .recent-event').count())
    await page
      .locator('.observation-history .recent-event')
      .first()
      .evaluate((button) => button.click());
  const section = page.getByRole('region', { name: 'Preceding tool call' });
  // Activate the real DOM handler; native pointer/compositor delivery is outside
  // this IO/IPC journey and is covered by the browser interaction suite.
  await section
    .getByRole('button', { name: 'Explain from local history' })
    .evaluate((button) => button.click());
  await section.getByText('Claude Code · Read', { exact: true }).waitFor();
  assert.match(await section.innerText(), /clock alignment was not measured/);
  assert(!/Matched preceding call/.test(await section.innerText()));
  assert(!(await page.locator('body').innerText()).includes(marker));
  const reply = await page.evaluate(
    async (id) => window.aegis.explainToolContext(id),
    '00000000-0000-4000-8000-000000000000',
  );
  assert.equal(reply.toolContext.strength, 'unattributed');
  assert(!JSON.stringify(reply).includes(marker));
  console.log('Real IPC explanation and disclosure assertions passed');
  await fs.writeFile(path.join(out, 'rendered-explanation.txt'), await section.innerText());
  const auditDir = path.join(out, 'profile', 'audit-logs');
  const auditNames = (await fs.readdir(auditDir)).filter((name) =>
    /^aegis-audit-.*\.json$/.test(name),
  );
  assert(auditNames.length > 0, 'The real audit file must exist');
  const auditText = (
    await Promise.all(auditNames.map((name) => fs.readFile(path.join(auditDir, name), 'utf8')))
  ).join('\n');
  assert(auditText.includes('w4-owned.env'), 'The original OS observation must be audited');
  assert(!auditText.includes(marker));
  await fs.writeFile(
    path.join(out, 'receipt.json'),
    JSON.stringify(
      {
        scope: 'synthetic main process snapshot and OS event; real local IO, IPC and Electron UI',
        passed: true,
        source: 'claude-code',
        strength: 'inferred',
        rawContentDisclosed: false,
        nativeProviderQualified: false,
        activation: 'real DOM handler; native pointer and compositor excluded',
      },
      null,
      2,
    ),
  );
  console.log(
    'Live local explanation: real IO → main → preload → selected UI passed (synthetic process/event).',
  );
} catch (error) {
  await fs.writeFile(path.join(out, 'failure.txt'), String(error));
  if (page)
    await fs.writeFile(
      path.join(out, 'failure-dom.txt'),
      await page
        .locator('body')
        .innerText({ timeout: 2000 })
        .catch(() => 'DOM unavailable'),
    );
  throw error;
} finally {
  let closeTimer;
  try {
    await Promise.race([
      app.close(),
      new Promise((resolve) => {
        closeTimer = setTimeout(() => {
          const child = app.process();
          if (child.exitCode === null) {
            if (process.platform === 'win32') {
              try {
                execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
                  stdio: 'ignore',
                  timeout: 5000,
                });
              } catch {
                /* Already exited. */
              }
            } else child.kill('SIGKILL');
          }
          resolve();
        }, 8000);
      }),
    ]);
  } finally {
    clearTimeout(closeTimer);
  }
}
