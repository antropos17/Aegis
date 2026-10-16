import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { parseArgs } from 'node:util';
import { _electron as electron } from 'playwright';

const { values } = parseArgs({
  options: { executable: { type: 'string' }, output: { type: 'string' } },
});
assert(process.platform === 'win32' && process.arch === 'x64', 'Windows x64 required');
assert(
  path.isAbsolute(values.executable ?? '') && path.isAbsolute(values.output ?? ''),
  'Absolute executable/output required',
);
const out = values.output;
fs.mkdirSync(out);
const env = { ...process.env, TEMP: path.join(out, 'temp'), TMP: path.join(out, 'temp') };
fs.mkdirSync(env.TEMP);
delete env.ELECTRON_RUN_AS_NODE;
const receipt = {
  status: 'FAIL',
  startedAt: new Date().toISOString(),
  fixture: 'disposable Aider process-name signature; no provider execution',
  samples: [],
};
let app, appProcess, fixture, page;
const errors = [];
const exitWithin = async (child, ms) => {
  if (child.exitCode !== null) return child.exitCode;
  let timer;
  try {
    return await Promise.race([
      once(child, 'exit').then(([code]) => code),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Owned process exit unconfirmed')), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};
const exists = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
};
try {
  const compiler = path.join(process.env.WINDIR, 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
  const probe = path.join(out, 'aider.exe');
  execFileSync(
    compiler,
    [
      '/nologo',
      '/target:exe',
      '/platform:x64',
      '/warnaserror+',
      `/out:${probe}`,
      path.resolve('tests/fixtures/monitoring-process.cs'),
    ],
    { env, windowsHide: true, timeout: 30000, maxBuffer: 65536 },
  );
  fixture = spawn(probe, [], { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  fixture.stdin.on('error', () => {});
  const [ready] = await once(fixture.stdout, 'data', { signal: AbortSignal.timeout(10000) });
  assert.equal(ready.toString().trim(), 'ready');
  receipt.fixturePid = fixture.pid;
  app = await electron.launch({
    executablePath: values.executable,
    args: ['--user-data-dir=' + path.join(out, 'profile')],
    env,
    timeout: 30000,
  });
  // Keep the original Node child handle: Playwright disposes its process()
  // accessor when the Electron connection closes.
  appProcess = app.process();
  receipt.packaged = await app.evaluate(
    ({ app }) => app.isPackaged && app.getAppPath().endsWith('app.asar'),
  );
  assert.equal(receipt.packaged, true);
  page = await app.firstWindow();
  // This is a shared interactive desktop. Keep the owned test window visible
  // while native mouse/keyboard input goes to the user's other windows. CDP
  // drives this scenario; production webPreferences and timers stay unchanged.
  receipt.windowInputIsolated = await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setIgnoreMouseEvents(true);
    window.setFocusable(false);
    window.blur();
    return !window.isFocusable() && !window.isFocused();
  });
  assert.equal(receipt.windowInputIsolated, true);
  page.on('pageerror', (error) => {
    if (errors.length < 20) errors.push(error.message);
  });
  await page.getByRole('heading', { name: 'Monitoring', exact: true, level: 1 }).waitFor();
  await page.evaluate((pid) => {
    window.__monitorProbe = { batches: [], pid };
    window.aegis.onScanBatch((batch) => {
      const probe = window.__monitorProbe;
      const health = batch.stats?.appHealth;
      const own = batch.agents?.find((agent) => agent.pid === probe.pid);
      probe.batches.push({
        at: Date.now(),
        reliable: health?.populationReliable === true && health?.identityDegraded === false,
        cadence: batch.stats?.scanCadence?.maxProcessGapMs,
        fixture: own
          ? {
              agent: own.agent,
              pid: own.pid,
              instanceId: own.instanceId,
              source: own.instanceIdSource,
            }
          : null,
      });
    });
  }, fixture.pid);
  await page.waitForFunction(
    () => window.__monitorProbe.batches.some((batch) => batch.reliable && batch.fixture),
    undefined,
    { timeout: 55000 },
  );
  const first = await page.evaluate(() =>
    window.__monitorProbe.batches.find((batch) => batch.reliable && batch.fixture),
  );
  assert.equal(first.fixture.agent, 'Aider');
  assert.equal(first.fixture.source, 'os');
  assert.match(first.fixture.instanceId, new RegExp(`^${fixture.pid}:[0-9]+$`));
  receipt.instanceId = first.fixture.instanceId;
  receipt.fixtureDetected = true;
  await page.locator('.sidebar').getByRole('button', { name: 'Agents', exact: true }).click();
  const context = page.getByRole('region', { name: 'Selected agent context', exact: true });
  await context.getByLabel('Selected agent', { exact: true }).selectOption('Aider');
  await context.getByLabel('Selected process', { exact: true }).selectOption(receipt.instanceId);
  assert.equal(
    await context.getByLabel('Selected process', { exact: true }).inputValue(),
    receipt.instanceId,
  );
  receipt.fixtureSelectable = true;
  // Cover the 3s -> 42s startup gap and 42s -> 82s warmup transition on
  // default settings. No fake timers, forced scans or fabricated IPC deliveries.
  while (Date.now() - first.at < 85000) {
    assert.equal(fixture.exitCode, null, 'Fixture exited before observation completed');
    const sample = await page.evaluate(() => ({
      at: Date.now(),
      label: document.querySelector('.live-badge')?.textContent.trim(),
      batches: window.__monitorProbe.batches.length,
    }));
    if (!sample.label) {
      await page.locator('.live-badge').waitFor({ state: 'visible', timeout: 2000 });
      sample.label = (await page.locator('.live-badge').innerText()).trim();
    }
    receipt.samples.push(sample);
    assert.match(sample.label, /^(Live|Scanning)$/);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  receipt.warmupObservedMs = Date.now() - first.at;
  const stats = await page.evaluate(() => window.aegis.getStats());
  const sensor = stats.appHealth?.sensors?.byId?.['proc-snapshot'];
  assert.equal(sensor?.state, 'HEALTHY');
  assert.equal(sensor?.detail, 'class5');
  receipt.snapshotClass = sensor.detail;
  await page.screenshot({ path: path.join(out, 'monitoring.png') });
  await page.getByRole('button', { name: 'Pause view', exact: true }).click();
  assert.equal(await page.locator('.live-badge').innerText(), 'View paused');
  fixture.stdin.end();
  assert.equal(await exitWithin(fixture, 10000), 0);
  const stoppedAt = Date.now();
  await page.waitForFunction(
    (stoppedAt) =>
      window.__monitorProbe.batches.some(
        (batch) => batch.at >= stoppedAt && batch.reliable && !batch.fixture,
      ),
    stoppedAt,
    { timeout: 30000 },
  );
  receipt.fixtureExited = true;
  assert.equal(
    await context.getByLabel('Selected process', { exact: true }).inputValue(),
    receipt.instanceId,
  );
  assert.match(
    await context
      .getByLabel('Selected process', { exact: true })
      .locator('option:checked')
      .innerText(),
    new RegExp(`^PID ${fixture.pid}(?: · |$)`),
  );
  receipt.pauseRetained = true;
  await page.getByRole('button', { name: 'Resume view', exact: true }).click();
  await page
    .getByText('Selection retained · current measurements unavailable', { exact: true })
    .waitFor();
  assert.equal(
    await context
      .getByLabel('Selected process', { exact: true })
      .locator('option:checked')
      .innerText(),
    'Selected process · no longer observed',
  );
  receipt.resumeExpired = true;
  await page.screenshot({ path: path.join(out, 'exited.png') });
  receipt.batches = await page.evaluate(() => window.__monitorProbe.batches);
  receipt.batchCount = receipt.batches.length;
  assert(receipt.batchCount >= 4);
  assert.deepEqual(errors, []);
  const rootPid = appProcess.pid;
  const childPids = await app.evaluate(({ app }) => app.getAppMetrics().map((item) => item.pid));
  const helperPids = execFileSync(
    path.join(process.env.WINDIR, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `@(Get-CimInstance Win32_Process -Filter 'ParentProcessId = ${rootPid}' | Select-Object -ExpandProperty ProcessId) | ConvertTo-Json -Compress`,
    ],
    { env, windowsHide: true, timeout: 10000, maxBuffer: 65536 },
  )
    .toString()
    .trim();
  receipt.ownedPids = [
    ...new Set([rootPid, ...childPids, ...[JSON.parse(helperPids || '[]')].flat()]),
  ];
  const closed = app.waitForEvent('close', { timeout: 15000 });
  await page.getByRole('button', { name: 'Quit AEGIS', exact: true }).click();
  await page
    .getByRole('dialog', { name: 'Quit AEGIS?', exact: true })
    .getByRole('button', { name: 'Quit AEGIS', exact: true })
    .click();
  await closed;
  assert.equal(await exitWithin(appProcess, 10000), 0);
  const closureDeadline = Date.now() + 10000;
  while (receipt.ownedPids.some(exists) && Date.now() < closureDeadline)
    await new Promise((resolve) => setTimeout(resolve, 100));
  assert(
    receipt.ownedPids.every((pid) => !exists(pid)),
    'Owned app/helper process remains',
  );
  receipt.closureConfirmed = true;
  receipt.status = 'PASS';
} catch (error) {
  receipt.failure = error.message;
  receipt.pageErrors = errors;
  if (page && !page.isClosed()) {
    try {
      receipt.failureView = await page.evaluate(() => ({
        title: document.title,
        heading: document.querySelector('h1')?.textContent,
        selected: document.querySelector('[aria-current="page"]')?.textContent,
      }));
      await page.screenshot({ path: path.join(out, 'failure.png'), timeout: 5000 });
    } catch {
      /* Preserve the original failure. */
    }
  }
  process.exitCode = 1;
} finally {
  if (fixture && fixture.exitCode === null) {
    fixture.stdin.end();
    try {
      await exitWithin(fixture, 10000);
    } catch {
      receipt.fixtureCleanupUnconfirmed = true;
      process.exitCode = 1;
    }
  }
  if (app && appProcess?.exitCode === null) {
    try {
      await app.close();
    } catch {
      receipt.appCleanupUnconfirmed = true;
      process.exitCode = 1;
    }
  }
  receipt.completedAt = new Date().toISOString();
  fs.writeFileSync(path.join(out, 'receipt.json'), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ status: receipt.status, failure: receipt.failure, output: out }));
}
