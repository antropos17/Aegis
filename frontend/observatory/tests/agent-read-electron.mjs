import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { _electron as electron } from 'playwright';
import { diagnostics, delay, observeQuit } from './etw-support.mjs';
import { exitWithin, inspectProfile } from './sensor-support.mjs';

import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  agentReadPassed,
  idleReadPassed,
} from '../../../tools/development/agent-read-contract.mjs';
const { values } = parseArgs({
  options: {
    executable: { type: 'string' },
    'agent-executable': { type: 'string' },
    output: { type: 'string' },
    'first-read': { type: 'boolean', default: false },
    ordinary: { type: 'boolean', default: false },
    'idle-ms': { type: 'string', default: '65000' },
  },
});
assert(process.platform === 'win32' && process.arch === 'x64', 'Windows x64 required');
const idleMs = Number(values['idle-ms']);
assert(
  Number.isSafeInteger(idleMs) && idleMs >= 65000 && idleMs <= 120000,
  'Idle must be 65–120 seconds',
);
for (const value of [values.executable, values['agent-executable'], values.output])
  assert(path.isAbsolute(value ?? ''), 'Absolute paths required');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const out = path.resolve(values.output),
  candidate = path.dirname(values.executable),
  cli = fs.realpathSync(values['agent-executable']);
const relative = path.relative(root, out);
assert(relative.startsWith('..') || path.isAbsolute(relative), 'Output must be outside source');
for (let cursor = path.dirname(out); ; cursor = path.dirname(cursor)) {
  const entry = fs.lstatSync(cursor);
  assert(
    entry.isDirectory() && !entry.isSymbolicLink(),
    'Output ancestors must be ordinary directories',
  );
  if (cursor === path.dirname(cursor)) break;
}
assert(fs.statSync(cli).isFile(), 'Actual installed Claude Code executable required');
fs.mkdirSync(out);
const workspace = path.join(out, 'fixture'),
  profile = path.join(out, 'profile'),
  home = path.join(out, 'home'),
  temp = path.join(out, 'temp');
for (const p of [workspace, home, temp]) fs.mkdirSync(p);
const file = path.join(workspace, '.env.aegis-read-check'),
  warmup = path.join(workspace, 'README.aegis-check.txt');
const marker = 'AEGIS_DUMMY_' + crypto.randomBytes(18).toString('hex');
const warmupMarker = 'AEGIS_WARMUP_' + crypto.randomBytes(10).toString('hex');
const env = { ...process.env, TEMP: temp, TMP: temp };
delete env.ELECTRON_RUN_AS_NODE;
const canonical = (p) => path.resolve(p).toLowerCase();
const r = {
  status: 'FAIL',
  startedAt: new Date().toISOString(),
  productionAdmission: false,
  realAgent: 'Claude Code',
  fixtureOnly: true,
  mode: values.ordinary ? 'ordinary' : 'diagnostic',
  requestedIdleMs: idleMs,
  file,
  scenario: values['first-read'] ? 'first-read' : 'persistent',
  workflow: values['first-read']
    ? 'first genuine Read of a newly created synthetic .env, without a prior fixture read'
    : 'persistent genuine Read of README, then a newly created synthetic .env',
};
let app,
  appProcess,
  agent,
  page,
  done = false,
  output = '',
  outputBytes = 0,
  polling = true,
  poll,
  pollError;
const messages = () =>
  output.split(/\r?\n/).flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
try {
  const initial = JSON.parse(
    execFileSync(path.join(candidate, 'resources/etw-file/EtwFile.exe'), ['inspect'], {
      env,
      windowsHide: true,
      timeout: 10000,
      maxBuffer: 4096,
    }).toString(),
  );
  assert(
    initial.status === 4201 && initial.present === false,
    'Diagnostic session is occupied or its absence is unknown',
  );
  agent = spawn(
    cli,
    [
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--no-session-persistence',
      '--disable-slash-commands',
      '--strict-mcp-config',
      '--tools',
      'Read',
      '--allowedTools',
      'Read',
    ],
    { cwd: workspace, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  agent.on('exit', () => (done = true));
  agent.stdin.on('error', () => {});
  const collect = (b) => {
    outputBytes += b.length;
    if (outputBytes <= 262144) output += b.toString('utf8');
  };
  agent.stdout.on('data', collect);
  agent.stderr.on('data', collect);
  await once(agent, 'spawn');
  r.agentPid = agent.pid;
  app = await electron.launch({
    executablePath: values.executable,
    args: [
      '--user-data-dir=' + profile,
      ...(values.ordinary ? [] : ['--etw-file-diagnostic-root=' + workspace]),
    ],
    env: { ...env, HOME: home, USERPROFILE: home },
    timeout: 30000,
  });
  appProcess = app.process();
  Object.assign(
    r,
    await app.evaluate(({ app, BrowserWindow }) => {
      const require = process.mainModule
        .require('node:module')
        .createRequire(app.getAppPath() + '/package.json');
      const w = BrowserWindow.getAllWindows()[0];
      w.setIgnoreMouseEvents(true);
      w.setFocusable(false);
      w.blur();
      return {
        packaged: app.isPackaged && app.getAppPath().endsWith('app.asar'),
        diagnosticBuild: require('./package.json').aegisEtwDiagnostic === true,
        noDiagnosticArguments: !process.argv.some((value) => value.startsWith('--etw-file-')),
      };
    }),
  );
  assert(r.packaged && r.diagnosticBuild === !values.ordinary);
  await observeQuit(app, path.join(out, 'shutdown.json'));
  page = await app.firstWindow();
  await page.evaluate((pid) => {
    window.__realAgent = null;
    window.aegis.onScanBatch((batch) => {
      if (batch.stats?.appHealth?.populationReliable === true) {
        const a = batch.agents?.find((a) => a.pid === pid);
        if (a) window.__realAgent = a;
      }
    });
  }, agent.pid);
  await page.getByRole('heading', { name: 'Monitoring', level: 1, exact: true }).waitFor();
  if (values.ordinary) {
    const before = await diagnostics(app);
    r.noAutomaticCapture = before.phase === 'disabled' && before.summaries.length === 0;
    assert(r.noAutomaticCapture && r.noDiagnosticArguments);
    await page.locator('.sidebar').getByRole('button', { name: 'Events', exact: true }).click();
    await page.getByRole('textbox', { name: 'Folder to monitor', exact: true }).fill(workspace);
    await page.getByRole('button', { name: 'Start file read monitoring', exact: true }).click();
    r.operatorStartedCapture = true;
  }
  console.log('Waiting for one manually confirmed UAC window.');
  let d;
  const readyUntil = Date.now() + 135000;
  do {
    d = await diagnostics(app);
    if (['running', 'failed', 'recovered'].includes(d.phase)) break;
    await delay(200);
  } while (Date.now() < readyUntil);
  assert.equal(d.phase, 'running');
  r.liveReady = true;
  if (values.ordinary) {
    const started = performance.now();
    while (performance.now() - started < idleMs) {
      await delay(1000);
      assert.equal((await diagnostics(app)).phase, 'running', 'Ordinary capture stopped early');
    }
    r.continuousCaptureMs = Math.floor(performance.now() - started);
    console.log('Ordinary capture stayed live beyond the diagnostic minute limit.');
  }
  const identityUntil = Date.now() + 25000;
  do {
    r.agentIdentity = await page.evaluate(() => window.__realAgent);
    if (r.agentIdentity) break;
    await delay(100);
  } while (Date.now() < identityUntil && !done);
  assert(
    r.agentIdentity?.instanceId && r.agentIdentity.agent === 'Claude Code',
    'Real agent identity not observed',
  );
  if (values['first-read'] && Object.hasOwn(d, 'issuerPreparation')) {
    const until = Date.now() + 10000;
    do {
      const snapshot = await diagnostics(app);
      r.preparationRecord = snapshot.issuerPreparation?.prepared?.find(
        (row) =>
          row.pid === agent.pid &&
          row.createTime100ns === r.agentIdentity.createTime100ns &&
          row.threads > 0,
      );
      if (r.preparationRecord) r.preparationAsOfQpc = snapshot.issuerPreparation.asOfQpc;
      if (r.preparationRecord) break;
      await delay(100);
    } while (Date.now() < until);
    r.issuerPreparedBeforeRead = !!r.preparationRecord;
    assert(
      r.issuerPreparedBeforeRead,
      'Real agent workers were not prepared before its first read',
    );
  }
  poll = (async () => {
    while (polling) {
      try {
        const data = await diagnostics(app);
        assert(!JSON.stringify(data).includes(marker), 'Contents entered diagnostic snapshot');
        for (const row of data.records) {
          if (row.path && canonical(row.path) === canonical(file)) {
            r.pathReadProof ??= row;
            if (
              row.issuerPid === agent.pid &&
              row.generationWitness === r.agentIdentity.createTime100ns &&
              row.agent === 'Claude Code'
            )
              r.readProof ??= row;
          }
        }
        const stats = await page.evaluate(() => window.aegis.getStats());
        assert(!JSON.stringify(stats).includes(marker), 'Contents entered renderer stats');
        const target = stats.fileReadDiagnostics?.reads?.find(
          (row) =>
            canonical(row.path) === canonical(file) &&
            row.agent === 'Claude Code' &&
            row.pid === agent.pid &&
            row.instanceId === r.agentIdentity.instanceId,
        );
        if (target) r.rendererObservation = target;
      } catch (e) {
        pollError = e.message;
      }
      await delay(100);
    }
  })();
  const turn = async (target, value, key) => {
    const prompt =
      'Monitoring acceptance check in this disposable directory. Use only Read to read ' +
      target +
      '. Read no other file, modify nothing, use no other tools or delegation. Reply with the exact value of ' +
      key +
      ' from that file; it is a harmless synthetic test marker.';
    agent.stdin.write(
      JSON.stringify({ type: 'user', message: { role: 'user', content: prompt } }) + '\n',
    );
    const until = Date.now() + 35000;
    while (
      !messages().some(
        (row) => row.type === 'result' && !row.is_error && row.result?.includes(value),
      ) &&
      !done &&
      Date.now() < until &&
      outputBytes <= 262144
    )
      await delay(100);
    assert(outputBytes <= 262144, 'Provider output budget exceeded');
    assert(
      messages().some(
        (row) => row.type === 'result' && !row.is_error && row.result?.includes(value),
      ),
      'Genuine Read turn did not return its marker',
    );
  };
  if (!values['first-read']) {
    fs.writeFileSync(warmup, ('AEGIS_WARMUP_TOKEN=' + warmupMarker + '\n# ').padEnd(4096, 'x'));
    await turn(warmup, warmupMarker, 'AEGIS_WARMUP_TOKEN');
    r.warmupRead = true;
    console.log('Real agent read the owned README; creating the synthetic sensitive file.');
    assert(!done, 'The real agent did not remain available between turns');
    await delay(1800);
  }
  fs.writeFileSync(file, ('AEGIS_FIXTURE_TOKEN=' + marker + '\n# ').padEnd(4096, 'x'));
  await turn(file, marker, 'AEGIS_FIXTURE_TOKEN');
  r.returnedCanary = true;
  console.log('Real agent returned the synthetic value; checking kernel and visible UI evidence.');
  const tools = messages()
    .flatMap((row) => row.message?.content ?? [])
    .filter((block) => block.type === 'tool_use');
  r.actualToolRead = tools.some(
    (block) => block.name === 'Read' && canonical(block.input?.file_path ?? '') === canonical(file),
  );
  r.onlyRequestedReads = tools.every(
    (block) =>
      block.name === 'Read' &&
      [canonical(file), ...(values['first-read'] ? [] : [canonical(warmup)])].includes(
        canonical(block.input?.file_path ?? ''),
      ),
  );
  r.firstReadOnly = values['first-read'] && tools.length === 1 && r.onlyRequestedReads;
  assert(r.actualToolRead && r.onlyRequestedReads);
  r.providerModel = messages().find(
    (row) => row.type === 'system' && row.subtype === 'init',
  )?.model;
  const proofUntil = Date.now() + 5000;
  while (!r.readProof && Date.now() < proofUntil && !pollError) await delay(100);
  assert(!pollError, pollError);
  assert(r.readProof, 'No verified kernel read for the real agent and synthetic .env');
  await page.locator('.sidebar').getByRole('button', { name: 'Events', exact: true }).click();
  const panel = page.getByRole('region', { name: 'File read observations', exact: true });
  const row = panel
    .locator('tbody tr')
    .filter({ hasText: '.env.aegis-read-check' })
    .filter({ hasText: 'Claude Code' })
    .filter({ hasText: 'PID ' + agent.pid });
  await row.waitFor();
  const text = await row.innerText();
  for (const expected of [
    'Claude Code',
    'Read observed',
    'Potential sensitive read',
    'Candidate path',
    'Issuing process verified',
  ])
    assert(text.includes(expected), 'Missing visible evidence: ' + expected);
  r.uiReadAndRisk = true;
  if (values.ordinary) {
    const status = await panel.getByRole('status').innerText();
    assert(/Kernel events lost: \d+/.test(status));
    assert(/Collector records dropped: \d+/.test(status));
    assert(/Mapping resets: \d+/.test(status));
    r.lossAccountingVisible = true;
    r.visibleLosses = (
      await page.evaluate(() => window.aegis.getStats())
    ).fileReadDiagnostics.losses;
  }
  await panel.scrollIntoViewIfNeeded();
  await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'));
  await panel.screenshot({ path: path.join(out, 'reads-dark.png') });
  await page.evaluate(() => (document.documentElement.dataset.theme = 'light'));
  await panel.screenshot({ path: path.join(out, 'reads-light.png') });
  if (values.ordinary && !values['first-read']) {
    await panel.getByRole('button', { name: 'Stop file read monitoring', exact: true }).click();
    const until = Date.now() + 20000;
    while ((await diagnostics(app)).phase !== 'stopped' && Date.now() < until) await delay(100);
    const stopped = await diagnostics(app);
    r.operatorStoppedCapture = stopped.phase === 'stopped' && !stopped.restartBlocked;
    assert(r.operatorStoppedCapture, 'Explicit Stop did not complete owned cleanup');
  }
  r.status = 'PASS';
} catch (e) {
  r.failure = e.message;
  process.exitCode = 1;
  r.providerProgress = {
    exitCode: agent?.exitCode,
    events: [...new Set(messages().map((x) => x.type))],
    tools: messages()
      .flatMap((row) => row.message?.content ?? [])
      .filter((b) => b.type === 'tool_use')
      .map((b) => b.name),
  };
  if (app && page) {
    try {
      await page.locator('.sidebar').getByRole('button', { name: 'Events', exact: true }).click();
      const panel = page.getByRole('region', { name: 'File read observations', exact: true });
      await panel.scrollIntoViewIfNeeded();
      await panel.screenshot({ path: path.join(out, 'failure-state.png') });
    } catch {
      // Preserve the original failure if its window is already unavailable.
    }
  }
} finally {
  polling = false;
  await poll;
  if (agent) {
    agent.stdin.end();
    try {
      r.agentExit = await exitWithin(agent, 10000);
    } catch {
      agent.kill();
      r.agentTerminationRequested = true;
      await exitWithin(agent, 5000).catch(() => {
        r.agentCleanupUnconfirmed = true;
      });
    }
  }
  if (app) {
    await app.evaluate(({ app }) => app.quit()).catch(() => {});
    try {
      r.appExit = await exitWithin(appProcess, 20000);
      r.appClosed = true;
    } catch {
      r.appCleanupUnconfirmed = true;
      process.exitCode = 1;
    }
  }
  if (fs.existsSync(path.join(out, 'shutdown.json'))) {
    const final = JSON.parse(fs.readFileSync(path.join(out, 'shutdown.json')));
    r.summary = final.summaries?.at(-1);
  }
  if (fs.existsSync(profile)) {
    try {
      const rows = inspectProfile(profile, marker, agent?.pid, workspace);
      inspectProfile(profile, warmupMarker, agent?.pid, workspace);
      r.contentExcluded = true;
      r.noDiagnosticAudit = !rows.some(
        (row) =>
          row.source === 'etw-file' ||
          row.path?.toLowerCase().startsWith(workspace.toLowerCase() + path.sep),
      );
    } catch (e) {
      r.privacyFailure = e.message;
      process.exitCode = 1;
    }
  }
  try {
    r.independentAbsence = JSON.parse(
      execFileSync(path.join(candidate, 'resources/etw-file/EtwFile.exe'), ['inspect'], {
        env,
        windowsHide: true,
        timeout: 10000,
        maxBuffer: 4096,
      }).toString(),
    );
    const script = '@(Get-CimInstance Win32_Process -Filter "Name = \'EtwFile.exe\'").Count';
    r.remainingNativeProcesses = Number(
      execFileSync(
        path.join(process.env.WINDIR, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
        ['-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference='Stop'; " + script],
        {
          env: {
            ...env,
            PSModulePath: path.join(process.env.WINDIR, 'System32/WindowsPowerShell/v1.0/Modules'),
          },
          windowsHide: true,
          timeout: 10000,
          maxBuffer: 4096,
        },
      )
        .toString()
        .trim(),
    );
  } catch (e) {
    r.cleanupFailure = e.code ?? 'inspection-failed';
    process.exitCode = 1;
  }
  r.agentVersion = execFileSync(cli, ['--version'], {
    env,
    encoding: 'utf8',
    timeout: 10000,
    windowsHide: true,
    maxBuffer: 4096,
  }).trim();
  const idleJourney = values.ordinary && values['first-read'];
  if (!(idleJourney ? idleReadPassed(r) : agentReadPassed(r))) {
    r.status = 'FAIL';
    r.failure ??= 'Incomplete journey or cleanup evidence';
    process.exitCode = 1;
  }
  r.completedAt = new Date().toISOString();
  const receipt = JSON.stringify(r, null, 2) + '\n';
  assert(Buffer.byteLength(receipt) <= 262144);
  fs.writeFileSync(path.join(out, 'receipt.json'), receipt, { flag: 'wx' });
  console.log(
    JSON.stringify({
      status: r.status,
      failure: r.failure,
      warmupRead: r.warmupRead,
      returnedCanary: r.returnedCanary,
      kernelRead: !!r.readProof,
      uiReadAndRisk: r.uiReadAndRisk,
      providerProgress: r.providerProgress,
      appClosed: r.appClosed,
    }),
  );
}
