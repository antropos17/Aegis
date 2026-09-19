import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir, writeFile, access, rm, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';

// Production renderer/preload and real checkers; dialogs select only owned fixtures.
const repo = process.cwd();
const owned = await mkdtemp(join(tmpdir(), 'aegis-action-coverage-'));
const out = resolve(repo, '.agent/b5-action-coverage-native');
await mkdir(out, { recursive: true });
const sentinel = join(owned, 'PRIVATE_SENTINEL');
const action = {
  executable: process.execPath,
  cwd: owned,
  args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(sentinel)},'PRIVATE_BODY')`],
  env: { PRIVATE_ENV: 'PRIVATE_VALUE' },
};
const entries = [];
for (const decision of ['allow', 'ask', 'deny']) {
  const policyPath = join(owned, decision + '-policy.json');
  const requestPath = join(owned, decision + '-request.json');
  await writeFile(
    policyPath,
    JSON.stringify({ schemaVersion: 2, defaultDecision: 'deny', rules: [{ action, decision }] }),
  );
  await writeFile(requestPath, JSON.stringify({ schemaVersion: 1, action }));
  entries.push({ id: decision, policyPath, requestPath });
}
const manifest = join(owned, 'catalog.json');
await writeFile(manifest, JSON.stringify({ schemaVersion: 1, actions: entries }));
const invalid = join(owned, 'invalid-policy.json');
await writeFile(invalid, '{"PRIVATE_INVALID":true}');
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
  global.__coverage = { queue: [], selections: 0, last: null };
  local.init({ getWindow: () => window, rendererUrl: pathToFileURL(index).href, dialog: {
    showOpenDialog: async () => { global.__coverage.selections++;
      const file = global.__coverage.queue.shift();
      return file ? { canceled: false, filePaths: [file] } : { canceled: true }; }
  } });
  ipcMain.handle('local-security:review', async (event, request) => {
    const result = await local.handle(event, request); global.__coverage.last = result; return result;
  });
  ipcMain.handle('get-settings', () => ({ darkMode: true, uiScale: 1, animationsEnabled: false }));
  ipcMain.handle('get-stats', () => ({ agents: [], currentAgents: 0 }));
  ipcMain.handle('get-resource-usage', () => ({}));
  ipcMain.handle('get-false-positives', () => []);
  await window.loadFile(index);
});
app.on('window-all-closed', () => app.quit());
`,
);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
let app;
const receipt = {
  productionRenderer: true,
  realPreload: true,
  realCheckers: true,
  nativeDialogs: 'stubbed to disposable files',
  executionPerformed: false,
  cleanup: false,
  pass: false,
};
try {
  app = await electron.launch({
    args: [harness, '--user-data-dir=' + join(owned, 'profile')],
    env,
    timeout: 45000,
  });
  const page = await app.firstWindow();
  await page
    .locator('.sidebar')
    .getByRole('button', { name: 'Action control', exact: true })
    .click();
  const workspace = page.locator('.action-coverage-workspace');
  const button = workspace.getByRole('button', { name: 'Choose files and check', exact: true });
  const resultRegion = page.getByRole('region', { name: 'Action check result', exact: true });
  const check = async (paths) => {
    await app.evaluate((_, paths) => {
      global.__coverage.queue = paths;
      global.__coverage.last = null;
    }, paths);
    await button.focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(
      () => !document.querySelector('.action-coverage-workspace form[aria-busy="true"]'),
    );
    const last = await app.evaluate(() => global.__coverage.last);
    assert(last, 'native check completed');
    assert(!JSON.stringify(last).includes('PRIVATE'), 'private canary in IPC');
    assert(!JSON.stringify(last).includes(owned), 'selected path in IPC');
    assert(!(await workspace.innerText().then((text) => /PRIVATE|Blocking verified/.test(text))));
    await assert.rejects(access(sentinel), 'a configuration check executed the selected action');
    return last;
  };
  for (const entry of entries) {
    const reply = await check([entry.policyPath, entry.requestPath]);
    assert.equal(reply.success, true);
    assert.equal(reply.check.report.configuration, 'valid');
    assert.equal(reply.check.report.policyDecision, entry.id);
    assert.equal(reply.check.report.executionPerformed, false);
    assert.equal(reply.check.report.blockingVerification, 'not-performed');
    assert(await resultRegion.isVisible());
    assert(await resultRegion.getByText('Next step', { exact: true }).isVisible());
    assert.equal(await resultRegion.locator('details.technical').getAttribute('open'), null);
  }
  const beforeCancel = await resultRegion.innerText();
  assert.equal((await check([entries[0].policyPath, null])).cancelled, true);
  assert.equal(await resultRegion.innerText(), beforeCancel, 'cancel replaced prior result');
  const invalidReply = await check([invalid, entries[0].requestPath]);
  assert.equal(invalidReply.check.report.configuration, 'invalid');
  await workspace.getByLabel('Selection type', { exact: true }).selectOption('catalog');
  await workspace.getByLabel('Execution route', { exact: true }).selectOption('mcp-stdio');
  const catalog = await check([manifest]);
  assert.equal(catalog.check.kind, 'catalog');
  assert.deepEqual(
    catalog.check.report.actions.map((entry) => entry.policyDecision),
    ['allow', 'ask', 'deny'],
  );
  const captured = await resultRegion.innerText();
  await workspace.getByLabel('Execution route', { exact: true }).selectOption('mcp-review');
  assert.equal(await resultRegion.innerText(), captured, 'draft changed captured route');
  await page.screenshot({ path: resolve(out, 'catalog-native.png') });
  const review = await check([manifest]);
  assert.equal(review.check.report.terminal, 'unavailable');
  assert.equal(review.check.report.terminalScope, 'checking-process-only');
  await resultRegion.locator('details.technical > summary').focus();
  await page.keyboard.press('Enter');
  assert.notEqual(await resultRegion.locator('details.technical').getAttribute('open'), null);
  assert(
    await resultRegion.getByText('Terminal in the checking process', { exact: true }).isVisible(),
  );
  await page.setViewportSize({ width: 900, height: 600 });
  await page.evaluate(() => document.documentElement.style.setProperty('--ui-scale', '1.5'));
  await resultRegion.scrollIntoViewIfNeeded();
  assert(await workspace.evaluate((root) => root.scrollWidth <= root.clientWidth + 1));
  await page.screenshot({ path: resolve(out, 'catalog-review-native-150.png') });
  const count = await app.evaluate(() => global.__coverage.selections);
  const rejected = await page.evaluate(() =>
    window.aegis.localSecurityReview({
      action: 'check-route',
      route: 'direct',
      policyPath: 'PRIVATE_PATH',
    }),
  );
  assert.equal(rejected.error, 'invalid-review-request');
  assert.equal(await app.evaluate(() => global.__coverage.selections), count);
  const foreign = join(owned, 'foreign.html');
  await writeFile(foreign, '<!doctype html><title>Foreign fixture</title>');
  await app.evaluate(
    async ({ BrowserWindow }, file) => BrowserWindow.getAllWindows()[0].loadFile(file),
    foreign,
  );
  const denied = await page.evaluate(() =>
    window.aegis.localSecurityReview({ action: 'check-catalog', route: 'mcp-stdio' }),
  );
  assert.equal(denied.error, 'request-denied');
  assert.equal(await app.evaluate(() => global.__coverage.selections), count);
  Object.assign(receipt, {
    singleAllowAskDeny: true,
    cancelledSelectionRetained: true,
    invalidConfiguration: true,
    mixedCatalog: true,
    draftDoesNotRelabelResult: true,
    desktopTerminalUnavailable: true,
    keyboardActivation: true,
    privateCanariesExcluded: true,
    forgedPathDenied: true,
    foreignDocumentDenied: true,
    pass: true,
  });
} finally {
  if (app) await app.close();
  assert.equal(dirname(owned), resolve(tmpdir()));
  assert.equal((await lstat(owned)).isSymbolicLink(), false);
  await rm(owned, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  receipt.cleanup = true;
  await writeFile(resolve(out, 'verification.json'), JSON.stringify(receipt, null, 2));
}
console.log('Action coverage Electron checks passed; owned profile and selected fixtures removed.');
