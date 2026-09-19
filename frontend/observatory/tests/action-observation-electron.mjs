import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, access, rm, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';

const repo = process.cwd();
const owned = await mkdtemp(join(tmpdir(), 'aegis-observation-ui-'));
const out = resolve(repo, '.agent/b5-observation-native');
await mkdir(out, { recursive: true });
const endpoint = join(owned, 'observation.json');
const policy = join(owned, 'PRIVATE_POLICY.json'),
  request = join(owned, 'PRIVATE_REQUEST.json');
const action = {
  executable: process.execPath,
  cwd: owned,
  args: ['-e', "require('node:fs').writeFileSync('PRIVATE_SENTINEL','unexpected')"],
  env: {},
};
await writeFile(
  policy,
  JSON.stringify({
    schemaVersion: 2,
    defaultDecision: 'deny',
    rules: [{ action, decision: 'deny' }],
  }),
);
await writeFile(request, JSON.stringify({ schemaVersion: 1, action }));
const harness = join(owned, 'harness.cjs');
await writeFile(
  harness,
  `
const { app, BrowserWindow, ipcMain } = require('electron');
const { pathToFileURL } = require('node:url');
const local = require(${JSON.stringify(resolve(repo, 'src/main/local-security-ipc.js'))});
app.setPath('userData', ${JSON.stringify(join(owned, 'profile'))});
app.setPath('sessionData', ${JSON.stringify(join(owned, 'profile'))});
app.whenReady().then(async () => {
  const index = ${JSON.stringify(resolve(repo, 'dist/renderer/index.html'))};
  const window = new BrowserWindow({ show: false, width: 1200, height: 800,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false,
      preload: ${JSON.stringify(resolve(repo, 'src/main/preload.js'))} } });
  local.init({ getWindow: () => window, rendererUrl: pathToFileURL(index).href, dialog: {
    showOpenDialog: async () => ({ canceled: false, filePaths: [${JSON.stringify(endpoint)}] }) } });
  ipcMain.handle('local-security:review', (event, request) => local.handle(event, request));
  ipcMain.handle('get-settings', () => ({ darkMode: true, uiScale: 1, animationsEnabled: false }));
  ipcMain.handle('get-stats', () => ({ agents: [], currentAgents: 0 }));
  ipcMain.handle('get-resource-usage', () => ({}));
  ipcMain.handle('get-false-positives', () => []);
  await window.loadFile(index);
});
app.on('window-all-closed', () => app.quit());
`,
);
const child = spawn(
  process.execPath,
  ['src/main/main.js', '--action-mcp-stdio', policy, request, '--observe', endpoint],
  { cwd: repo, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
);
const exited = once(child, 'close');
const killTimer = setTimeout(() => child.kill(), 90000);
let stdout = '',
  stderr = '';
child.stdout.on('data', (chunk) => {
  stdout += chunk;
  assert(stdout.length < 65536);
});
child.stderr.on('data', (chunk) => {
  stderr += chunk;
  assert(stderr.length < 65536);
});
child.stdin.on('error', () => {});
const wait = async (check) => {
  const deadline = Date.now() + 10000;
  while (!(await check())) {
    assert(Date.now() < deadline, 'fixture deadline');
    await new Promise((r) => setTimeout(r, 50));
  }
};
const send = (message) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
let app;
const receipt = {
  realNodeOwner: true,
  realElectronPreload: true,
  dialogs: 'stubbed to owned endpoint',
  independentProviderIdentity: false,
  blockingVerified: false,
  pass: false,
  cleanup: false,
};
try {
  await wait(async () => {
    try {
      await access(endpoint);
      return true;
    } catch {
      return false;
    }
  });
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: [harness], env, timeout: 45000 });
  const page = await app.firstWindow();
  await page
    .locator('.sidebar')
    .getByRole('button', { name: 'Action control', exact: true })
    .click();
  const panel = page.getByRole('region', { name: 'Live route observation', exact: true });
  const choose = panel.getByRole('button', { name: 'Choose observation endpoint' });
  await choose.focus();
  await page.keyboard.press('Enter');
  await panel.getByRole('status').filter({ hasText: 'Waiting for MCP initialization' }).waitFor();
  send({
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'claude-code', version: '2.1.263' },
    },
  });
  await wait(() => stdout.includes('"id":1'));
  send({ method: 'notifications/initialized' });
  await panel
    .getByRole('status')
    .filter({ hasText: /^Observed$/ })
    .waitFor();
  assert(await panel.getByText('claude-code · 2.1.263', { exact: true }).isVisible());
  assert(
    (await page.evaluate(() => window.aegis.localSecurityReview({ action: 'route-observation' })))
      .observation.snapshot.actionAttempts === 0,
  );
  send({ id: 2, method: 'tools/call', params: { name: 'aegis_execute_selected', arguments: {} } });
  await wait(() => stdout.includes('"id":2'));
  await panel.getByText('1 / 1', { exact: true }).waitFor();
  await assert.rejects(access(join(owned, 'PRIVATE_SENTINEL')));
  const live = await page.evaluate(() =>
    window.aegis.localSecurityReview({ action: 'route-observation' }),
  );
  assert(!JSON.stringify(live).includes('PRIVATE'));
  assert(!JSON.stringify(live).includes(owned));
  assert(!JSON.stringify(live).includes('token'));
  for (const [theme, width, height, scale] of [
    ['dark', 1200, 800, 1],
    ['light', 900, 600, 1.5],
  ]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(
      ({ theme, scale }) => {
        document.documentElement.dataset.theme = theme;
        document.documentElement.style.setProperty('--ui-scale', String(scale));
      },
      { theme, scale },
    );
    await panel.scrollIntoViewIfNeeded();
    assert(await panel.evaluate((root) => root.scrollWidth <= root.clientWidth + 1));
    await page.screenshot({ path: resolve(out, `observed-${theme}.png`) });
  }
  child.stdin.end();
  const [exit] = await exited;
  assert.equal(exit, 0);
  await panel.getByRole('status').filter({ hasText: 'Coverage lost' }).waitFor();
  assert(await panel.getByText('1 / 1', { exact: true }).isVisible());
  assert(!/PRIVATE|Blocking verified/.test(await panel.innerText()));
  assert.equal(await choose.isEnabled(), true);
  await page.screenshot({ path: resolve(out, 'coverage-lost.png') });
  await page.locator('.sidebar').getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Language', { exact: true }).selectOption('pt');
  await page
    .locator('.sidebar')
    .getByRole('button', { name: 'Controle de ações', exact: true })
    .click();
  const translated = page.locator('.observation-panel');
  await translated.getByRole('status').filter({ hasText: 'Cobertura perdida' }).waitFor();
  await translated
    .getByRole('button', { name: 'Escolher ponto de observação' })
    .scrollIntoViewIfNeeded();
  assert(await translated.evaluate((root) => root.scrollWidth <= root.clientWidth + 1));
  await page.screenshot({ path: resolve(out, 'coverage-lost-pt.png') });
  await assert.rejects(access(endpoint));
  const rejected = await page.evaluate(() =>
    window.aegis.localSecurityReview({ action: 'observe-route', path: 'PRIVATE_PATH' }),
  );
  assert.equal(rejected.error, 'invalid-review-request');
  Object.assign(receipt, {
    initialized: true,
    denySettled: true,
    noSentinel: true,
    coverageLost: true,
    privateCanariesExcluded: true,
    keyboard: true,
    layouts: ['1200x800 dark 100%', '900x600 light 150%', '900x600 Portuguese 150%'],
    pass: true,
  });
} finally {
  child.stdin.end();
  if (child.exitCode === null) child.kill();
  await exited;
  clearTimeout(killTimer);
  if (app) await app.close();
  assert.equal(dirname(owned), resolve(tmpdir()));
  assert.equal((await lstat(owned)).isSymbolicLink(), false);
  await rm(owned, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  receipt.cleanup = true;
  await writeFile(resolve(out, 'verification.json'), JSON.stringify(receipt, null, 2));
}
console.log('Action observation native desktop verification passed.');
