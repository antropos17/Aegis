'use strict';

// One genuine installed Claude session, current OS scanner and production IPC/UI.
// The selected file observation is a LAB event, not native read-sensor acceptance.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const { _electron: electron } = require('playwright');

const root = process.cwd();
const out = path.resolve(
  process.env.AEGIS_CLAUDE_QUALIFICATION_OUT || 'out/development/live-claude',
);
const cli = path.join(os.homedir(), '.local', 'bin', 'claude.exe');
const id = randomUUID(),
  eventId = randomUUID();
const project = path.join(out, 'project'),
  file = path.join(project, 'w4-native-fixture.env');
const marker = 'W4_PRIVATE_FIXTURE_' + randomUUID();
let app, page, child, timer, childDone;

async function waitFile(name, timeout = 90000) {
  const start = Date.now();
  for (;;) {
    try {
      return JSON.parse(await fs.readFile(path.join(out, name), 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (child?.exitCode !== null || Date.now() - start > timeout)
      throw Error('claude-stage-unavailable:' + name);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
async function main() {
  await fs.mkdir(project, { recursive: true });
  assert(!(await fs.readdir(out)).includes('receipt.json'), 'Use a fresh output directory');
  await fs.writeFile(file, marker + '\n');
  const hookFile = path.join(out, 'hook.cjs');
  await fs.writeFile(
    hookFile,
    `const fs=require('node:fs');const path=require('node:path');const root=${JSON.stringify(out)};
let bytes=0,text='';process.stdin.setEncoding('utf8');process.stdin.on('data',v=>{bytes+=Buffer.byteLength(v);if(bytes>65536)process.exit(2);text+=v});process.stdin.on('end',async()=>{
try {const row=JSON.parse(text);const kind=row.hook_event_name;const data={kind,sessionId:row.session_id,at:Date.now(),tool:row.tool_name||null};
if(kind==='PreToolUse'&&row.tool_name==='Read'&&row.tool_input?.file_path===${JSON.stringify(file)})fs.writeFileSync(path.join(root,'read.json'),JSON.stringify(data));
if(kind==='SessionStart'||kind==='Stop'){fs.writeFileSync(path.join(root,kind+'.json'),JSON.stringify(data));const release=path.join(root,'release-'+kind);const start=Date.now();while(!fs.existsSync(release)&&Date.now()-start<90000)await new Promise(r=>setTimeout(r,100));}
}catch{process.exitCode=2;}});`,
  );
  const command = `"${process.execPath.replaceAll('\\', '/')}" "${hookFile.replaceAll('\\', '/')}"`;
  const settings = path.join(out, 'settings.json');
  await fs.writeFile(
    settings,
    JSON.stringify({
      hooks: Object.fromEntries(
        ['SessionStart', 'PreToolUse', 'Stop'].map((name) => [
          name,
          [{ hooks: [{ type: 'command', command, timeout: 100 }] }],
        ]),
      ),
    }),
  );
  const config = JSON.parse(
    await fs
      .readFile(path.join(os.homedir(), '.claude', 'settings.json'), 'utf8')
      .catch(() => '{}'),
  );
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CLAUDECODE;
  app = await electron.launch({
    args: [
      root,
      '--user-data-dir=' + path.join(out, 'profile'),
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
    env,
    timeout: 45000,
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  await page
    .getByRole('heading', { name: 'Monitoring', exact: true, level: 1 })
    .waitFor({ timeout: 30000 });
  await page.evaluate(() => {
    window.__w4Agents = [];
    window.aegis.onScanBatch((batch) => {
      if (Array.isArray(batch.agents)) window.__w4Agents = batch.agents;
    });
    window.__w4Delivered = false;
  });
  const args = [
    '--print',
    '--output-format',
    'json',
    '--session-id',
    id,
    '--setting-sources',
    '',
    '--settings',
    settings,
    '--strict-mcp-config',
    '--mcp-config',
    '{"mcpServers":{}}',
    '--tools',
    'Read',
    '--allowedTools',
    'Read',
    '--max-budget-usd',
    '0.50',
  ];
  if (config.model) args.push('--model', config.model);
  args.push(
    `Use the Read tool exactly once on ${file} with limit 5. Do not use another tool. Then reply exactly READ_OK without quoting the file.`,
  );
  child = spawn(cli, args, {
    cwd: project,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '',
    stderrBytes = 0;
  child.stdout.on('data', (value) => {
    if (output.length < 65536) output += value.toString('utf8');
  });
  child.stderr.on('data', (value) => {
    stderrBytes += value.length;
  });
  childDone = new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
    child.once('error', () => resolve({ code: -1 }));
  });
  timer = setTimeout(() => {
    if (child.exitCode === null)
      execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        timeout: 5000,
      });
  }, 150000);
  console.log('Started owned Claude process; configured model preserved');
  const start = await waitFile('SessionStart.json');
  assert.equal(start.sessionId, id);
  await page.waitForFunction(
    (pid) =>
      window.__w4Agents.some(
        (row) => row.pid === pid && row.agent === 'Claude Code' && row.instanceIdSource === 'os',
      ),
    child.pid,
    { polling: 100, timeout: 30000 },
  );
  const observed = await page.evaluate((pid) => {
    const row = window.__w4Agents.find((a) => a.pid === pid);
    return {
      pid: row.pid,
      startTime: row.startTime,
      instanceId: row.instanceId,
      createTime100ns: row.createTime100ns,
    };
  }, child.pid);
  console.log('Production scanner observed real Claude generation');
  await fs.writeFile(path.join(out, 'release-SessionStart'), 'release');
  const stop = await waitFile('Stop.json');
  assert.equal(stop.sessionId, id);
  const read = await waitFile('read.json', 1000);
  assert.equal(read.sessionId, id);
  console.log('Genuine Read completed; Claude held at its task-local Stop hook');
  await page.evaluate((selected) => {
    const off = window.aegis.onFileAccess((value) => {
      if ((Array.isArray(value) ? value : [value]).some((row) => row.eventId === selected)) {
        window.__w4Delivered = true;
        off();
      }
    });
  }, eventId);
  await app.evaluate(
    async ({ app }, data) => {
      const require = process.mainModule
        .require('node:module')
        .createRequire(app.getAppPath() + '/package.json');
      require('./src/main/main.js').onFileEvent({
        ...data.observed,
        eventId: data.eventId,
        agent: 'Claude Code',
        timestamp: data.at,
        file: data.file,
        action: 'accessed',
        category: 'ai',
        sensitive: false,
        attribution: { status: 'inferred', evidence: [] },
      });
      require('./src/main/audit-logger.js').flush();
    },
    { observed, eventId, at: read.at, file },
  );
  await page.waitForFunction(() => window.__w4Delivered, null, { polling: 100 });
  const reply = await page.evaluate(
    (selected) => window.aegis.explainToolContext(selected),
    eventId,
  );
  const nextRequestAfter = Date.now() + 1000;
  assert.equal(reply.toolContext.sessionBinding, 'confirmed', JSON.stringify(reply));
  assert.equal(reply.toolContext.strength, 'inferred');
  assert(reply.toolContext.candidates.some((row) => row.toolName === 'Read'));
  assert(!JSON.stringify(reply).includes(marker));
  // Reuse the returned explanation's real UI command after the one-second rate gate.
  await page
    .locator('.sidebar')
    .getByRole('button', { name: 'Events', exact: true })
    .evaluate((button) => button.click());
  await page.getByLabel('Search events').fill('w4-native-fixture.env');
  await page
    .locator('.observation-open')
    .first()
    .evaluate((button) => button.click());
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
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, nextRequestAfter - Date.now())));
  await section
    .getByRole('button', { name: 'Explain from local history' })
    .evaluate((button) => button.click());
  await section.getByText('Claude Code · Read', { exact: true }).waitFor();
  const rendered = await section.innerText();
  assert(rendered.includes('Recorded session binding; association limited'));
  assert(!rendered.includes(marker));
  await fs.writeFile(path.join(out, 'rendered-explanation.txt'), rendered);
  await fs.writeFile(path.join(out, 'release-Stop'), 'release');
  const exit = await childDone;
  clearTimeout(timer);
  assert.equal(exit.code, 0, 'Genuine Claude did not complete');
  const result = JSON.parse(output);
  assert(!result.is_error, 'Genuine Claude reported failure');
  assert(result.result.includes('READ_OK'));
  const receipt = {
    passed: true,
    sessionBinding: 'confirmed',
    association: 'inferred',
    genuineClaude: true,
    processObservation:
      'production scanner plus held-handle full-resolution birth/cwd/session selector',
    osEventSynthetic: true,
    nativeReadSensorQualified: false,
    rawContentDisclosed: false,
    claudeExit: exit,
    stderrBytes,
    reply: reply.toolContext,
  };
  await fs.writeFile(path.join(out, 'receipt.json'), JSON.stringify(receipt, null, 2));
  console.log(
    'PASS: genuine Claude history -> verified process/session -> real IPC and rendered explanation',
  );
}
main()
  .catch(async (error) => {
    await fs.writeFile(path.join(out, 'failure.txt'), String(error));
    console.error(String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    clearTimeout(timer);
    for (const kind of ['SessionStart', 'Stop'])
      await fs.writeFile(path.join(out, 'release-' + kind), 'release').catch(() => {});
    if (child?.exitCode === null) {
      try {
        execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
          stdio: 'ignore',
          timeout: 5000,
        });
      } catch {
        /* Owned child exited. */
      }
    }
    if (app) {
      const own = app.process();
      const kill = setTimeout(() => {
        if (own.exitCode === null) {
          try {
            execFileSync('taskkill.exe', ['/PID', String(own.pid), '/T', '/F'], {
              stdio: 'ignore',
              timeout: 5000,
            });
          } catch {
            /* Already exited. */
          }
        }
      }, 8000);
      try {
        await app.close();
      } finally {
        clearTimeout(kill);
      }
    }
  });
