import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
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
    () => /^\d+$/.test(document.querySelector('.summary-strip strong')?.textContent?.trim() ?? ''),
    undefined,
    { timeout: 60000 },
  );
  const visiblePopulation = Number(
    await window.locator('.summary-strip strong').first().innerText(),
  );
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
    await window
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('button', { name, exact: true })
      .click();
    await window.getByRole('heading', { level: 1, name, exact: true }).waitFor();
  }
  await window.getByLabel('Scan interval (seconds)').fill('20');
  await window.getByRole('button', { name: 'Save settings', exact: true }).click();
  await window.getByText('Completed', { exact: true }).waitFor();
  assert.equal(
    await window.evaluate(async () => (await window.aegis.getSettings()).scanIntervalSec),
    20,
  );

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
  await window
    .getByRole('navigation')
    .getByRole('button', { name: 'Monitoring', exact: true })
    .click();
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
        visiblePopulation,
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
