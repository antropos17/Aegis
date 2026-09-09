import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { checkResourceGeometry } from './resource-layer-check.mjs';
const root = process.cwd();
const out = resolve(
  root,
  process.env.AEGIS_SMOKE_EXECUTABLE ? 'dist/packaged-qa' : 'dist/electron-qa',
);
await mkdir(out, { recursive: true });
const env = { ...process.env, TEMP: 'X:/tmp', TMP: 'X:/tmp' };
delete env.ELECTRON_RUN_AS_NODE;
const launchOptions = {
  ...(process.env.AEGIS_SMOKE_EXECUTABLE
    ? { executablePath: process.env.AEGIS_SMOKE_EXECUTABLE }
    : {}),
  args: [
    ...(process.env.AEGIS_SMOKE_EXECUTABLE ? [] : [root]),
    '--user-data-dir=' + resolve(out, 'profile'),
  ],
  env,
  timeout: 45000,
};
let app = await electron.launch(launchOptions);
const errors = [];
try {
  const window = await app.firstWindow();
  window.on('pageerror', (e) => errors.push(e.message));
  await window
    .getByRole('heading', { name: 'Monitoring', exact: true, level: 1 })
    .waitFor({ timeout: 30000 });
  const deadline = Date.now() + 55000;
  let observed = false;
  while (Date.now() < deadline) {
    const health = await window.evaluate(async () => (await window.aegis.getStats()).appHealth);
    if (health.populationReliable === true) {
      observed = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert(observed, 'No reliable population observed within 55 seconds');
  // Health becomes reliable before the scan pipeline finishes publishing its batch.
  // Assert the visible renderer population separately from the backend getter.
  await window.waitForFunction(
    () => /^\d+/.test(document.querySelector('.summary-stat strong')?.textContent?.trim() ?? ''),
    undefined,
    { timeout: 60000 },
  );
  const visibleAgentGroups = Number.parseInt(
    await window.locator('.summary-stat strong').first().innerText(),
  );
  const rosterNames = await window
    .locator('.radar-roster .roster-identity strong')
    .allTextContents();
  assert.equal(rosterNames.length, Math.min(4, visibleAgentGroups));
  assert.equal(rosterNames.length, new Set(rosterNames).size, 'radar repeats product names');
  assert.equal(await window.locator('.radar-blip').count(), rosterNames.length);
  assert.equal(await window.locator('.radar-info, .radar-mini-chart').count(), 0);
  await window.locator('.radar-agent-card').first().click();
  await window.getByRole('button', { name: 'Open agent', exact: true }).click();
  await window.getByText('Agent overview', { exact: true }).waitFor();
  await window.keyboard.press('Escape');
  await window.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(
    await window.locator('.radar-blip[aria-pressed="true"]').count(),
    1,
    'closing agent details clears the radar selection',
  );
  for (const layer of ['Files', 'Network']) {
    await window.locator('.radar-layers').getByRole('button', { name: layer, exact: true }).click();
    const all = window.getByRole('button', { name: 'Show all agents', exact: true });
    if (await all.isVisible()) await all.click();
    await window.mouse.move(0, 0);
    await checkResourceGeometry(window);
    // Check every endpoint currently visible to the native sensors, including empty DNS.
    const next = window.getByLabel('Next radar resources');
    while ((await next.isVisible()) && (await next.isEnabled())) {
      await next.click();
      await window.mouse.move(0, 0);
      await checkResourceGeometry(window);
    }
    await window
      .locator('.radar-panel')
      .screenshot({ path: resolve(out, `radar-${layer.toLowerCase()}.png`) });
  }
  await window.locator('.radar-layers').getByRole('button', { name: 'Radar', exact: true }).click();
  const stats = await window.evaluate(async () => {
    const stats = await window.aegis.getStats();
    return { agents: stats.currentAgents, health: stats.appHealth, gap: stats.observationGap };
  });
  const methods = await window.evaluate(() => Object.keys(window.aegis));
  assert.equal(methods.length, 54);
  for (const name of [
    'Agents',
    'Events',
    'Network',
    'Rules & permissions',
    'Agent catalog',
    'AI analysis',
    'Reports',
    'Audit',
    'Statistics',
    'Settings',
  ]) {
    await window.locator('.sidebar').getByRole('button', { name, exact: true }).click();
    await window.getByRole('heading', { level: 1, name, exact: true }).waitFor();
    if (name === 'Reports') {
      const names = await window.locator('.report-agent-group .table-agent').allTextContents();
      assert(names.length > 0, 'report lacks the observed agent groups');
      assert.equal(names.length, new Set(names).size, 'report repeats a product');
      await window.waitForFunction(() => !document.documentElement.dataset.transitionSurface);
      await window.screenshot({ path: resolve(out, 'reports.png') });
    }
    if (name === 'Agents') {
      const names = await window.locator('.agent-group-row:visible .table-agent').allTextContents();
      assert(names.length > 0, 'real agent groups are missing');
      assert.equal(names.length, new Set(names).size, 'agent table repeats the same product');
      assert.equal(
        await window.locator('.sidebar .count').innerText(),
        String(names.length),
        'navigation counts processes as agents',
      );
      await window.locator('.agent-group-row:visible .table-agent').first().click();
      await window.getByText('Agent overview', { exact: true }).waitFor();
      assert.equal(await window.getByRole('button', { name: 'Suspend', exact: true }).count(), 0);
      assert((await window.locator('#modal .process-row').count()) > 0, 'group lost its processes');
      await window.keyboard.press('Escape');
      await window.getByRole('dialog').waitFor({ state: 'hidden' });
    }
  }
  await window.getByLabel('Theme', { exact: true }).selectOption('light-hc');
  await window.getByLabel('Scan interval (seconds)').evaluate((input) => {
    input.value = '20';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await window.getByRole('button', { name: 'Save settings', exact: true }).click();
  await window.getByText('Completed', { exact: true }).waitFor();
  assert.equal(
    await window.evaluate(async () => (await window.aegis.getSettings()).scanIntervalSec),
    20,
  );
  assert.equal(await window.evaluate(() => localStorage.getItem('aegis-theme')), 'light-hc');
  await window.getByRole('button', { name: 'Toggle theme', exact: true }).click();
  assert.equal(await window.getByLabel('Theme', { exact: true }).inputValue(), 'dark');
  await window.getByRole('button', { name: 'Toggle theme', exact: true }).click();
  assert.equal(await window.getByLabel('Theme', { exact: true }).inputValue(), 'light');

  // Only the disposable profile receives this sentinel. No provider request is made.
  const sentinel = 'observatory-test-key-never-export';
  const saved = await window.evaluate(
    async (key) =>
      window.aegis.saveSettings({ ...(await window.aegis.getSettings()), anthropicApiKey: key }),
    sentinel,
  );
  assert.equal(saved.success, true);
  await app.evaluate(({ shell, app }, out) => {
    shell.openPath = async () => '';
    app.setPath('temp', out);
  }, out);
  const exported = [];
  for (const [method, extension] of [
    ['exportConfig', 'json'],
    ['exportLog', 'json'],
    ['exportCsv', 'csv'],
    ['generateReport', 'html'],
    ['exportFullAudit', 'json'],
    ['exportZip', 'zip'],
  ]) {
    const filePath = resolve(out, `${method}.${extension}`);
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ filePath, canceled: false });
    }, filePath);
    const result = await window.evaluate(async (method) => window.aegis[method](), method);
    assert.equal(result.success, true, `${method}: ${result.error}`);
    const bytes = await readFile(result.path ?? filePath);
    assert(bytes.length > 0, `${method}: empty output`);
    if (extension !== 'zip') assert(!bytes.toString().includes(sentinel), `${method}: leaked key`);
    if (extension === 'zip') assert.equal(bytes.subarray(0, 2).toString(), 'PK');
    exported.push(method);
  }
  await app.evaluate(
    ({ dialog }, filePath) => {
      dialog.showOpenDialog = async () => ({ filePaths: [filePath], canceled: false });
    },
    resolve(out, 'exportConfig.json'),
  );
  const imported = await window.evaluate(async () => window.aegis.importConfig());
  assert.equal(imported.success, true);
  assert.equal(
    await window.evaluate(async () => (await window.aegis.getSettings()).anthropicApiKey),
    sentinel,
  );
  await window.locator('.sidebar').getByRole('button', { name: 'Monitoring', exact: true }).click();
  await window.getByRole('heading', { name: 'Monitoring', level: 1, exact: true }).waitFor();
  await window.waitForFunction(() => !document.documentElement.dataset.transitionSurface);
  await window.screenshot({ path: resolve(out, 'desktop.png') });
  const hardening = await app.evaluate(({ BrowserWindow }) => {
    const prefs = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return {
      contextIsolation: prefs.contextIsolation,
      nodeIntegration: prefs.nodeIntegration,
      sandbox: prefs.sandbox,
    };
  });
  assert.equal(hardening.contextIsolation, true);
  assert.equal(hardening.nodeIntegration, false);
  assert.equal(hardening.sandbox, true);
  assert.deepEqual(errors, []);
  await writeFile(
    resolve(out, 'smoke.json'),
    JSON.stringify(
      {
        stats,
        visibleAgentGroups,
        hardening,
        errors,
        exported,
        tested:
          '11 workspaces; real sensors; settings save; six native export handlers; configuration import; isolated profile; no process intervention or provider request',
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      agents: stats.agents,
      populationReliable: stats.health.populationReliable,
      workspaces: 11,
      hardening,
      errors,
    }),
  );
  await window.getByRole('button', { name: 'Toggle theme', exact: true }).click();
  const savedTheme = await window.evaluate(() => document.documentElement.dataset.theme);
  await app.close();
  app = await electron.launch(launchOptions);
  const restarted = await app.firstWindow();
  await restarted.getByRole('heading', { name: 'Monitoring', exact: true, level: 1 }).waitFor();
  assert.equal(
    await restarted.evaluate(async () => (await window.aegis.getSettings()).scanIntervalSec),
    20,
  );
  assert.equal(await restarted.evaluate(() => document.documentElement.dataset.theme), savedTheme);
  console.log(
    'Settings survived Electron restart. Six exports and key-free configuration round trip passed.',
  );
} finally {
  await app.close();
}
