'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const output = process.argv[2];
if (!output || !path.isAbsolute(output) || fs.existsSync(output)) {
  throw new Error('Pass a new absolute output directory outside the repository');
}
const relative = path.relative(root, output);
if (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  throw new Error('Output is inside repository');
fs.mkdirSync(output, { recursive: true });
fs.mkdirSync(path.join(output, 'temp'));
const fingerprint = {};
for (const folder of ['src/main', 'bench/cycle-profile', 'dist/renderer', 'sidecar/resources']) {
  for (const name of fs.readdirSync(path.join(root, folder), { recursive: true })) {
    const file = path.join(root, folder, name);
    if (fs.lstatSync(file).isFile())
      fingerprint[`${folder}/${name.replaceAll('\\', '/')}`] = createHash('sha256')
        .update(fs.readFileSync(file))
        .digest('hex');
  }
}
fs.writeFileSync(
  path.join(output, 'manifest.json'),
  JSON.stringify(
    {
      head: execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: root,
        encoding: 'utf8',
        windowsHide: true,
      }).trim(),
      snapshotBinarySha256: fs.existsSync(path.join(root, 'build/sidecar/aegis-procsnap.exe'))
        ? createHash('sha256')
            .update(fs.readFileSync(path.join(root, 'build/sidecar/aegis-procsnap.exe')))
            .digest('hex')
        : null,
      resourceBinarySha256: fs.existsSync(path.join(root, 'build/sidecar/aegis-resources.exe'))
        ? createHash('sha256')
            .update(fs.readFileSync(path.join(root, 'build/sidecar/aegis-resources.exe')))
            .digest('hex')
        : null,
      fingerprint,
      startedAt: new Date().toISOString(),
      limits: { durationMs: 180000, watchdogMs: 210000, reportSamplesPerStage: 4096 },
    },
    null,
    2,
  ),
);
const env = {
  ...process.env,
  AEGIS_CYCLE_OUTPUT: output,
  AEGIS_PROC_SNAPSHOT: 'auto',
  TEMP: path.join(output, 'temp'),
  TMP: path.join(output, 'temp'),
};
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), [path.join(__dirname, 'electron.cjs')], {
  cwd: root,
  env,
  windowsHide: true,
  stdio: 'ignore',
});
const started = Date.now();
const progress = setInterval(() => {
  const file = path.join(output, 'report.json');
  let ticks = null;
  try {
    ticks = JSON.parse(fs.readFileSync(file, 'utf8')).ticks.length;
  } catch {
    /* checkpoint pending */
  }
  process.stdout.write(
    JSON.stringify({ elapsedSeconds: Math.round((Date.now() - started) / 1000), ticks }) + '\n',
  );
}, 30000);
const deadline = setTimeout(() => {
  if (child.exitCode !== null || !child.pid) return;
  if (process.platform === 'win32')
    execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore',
      timeout: 10000,
    });
  else child.kill('SIGKILL');
}, 210000);
child.once('error', () => {
  clearInterval(progress);
  clearTimeout(deadline);
  process.exitCode = 1;
});
child.once('exit', (code) => {
  clearInterval(progress);
  clearTimeout(deadline);
  let complete = false;
  let steadyProcessTicks = 0;
  try {
    const report = JSON.parse(fs.readFileSync(path.join(output, 'report.json'), 'utf8'));
    complete = report.complete === true;
    steadyProcessTicks = report.ticks.filter(
      (tick) =>
        tick.kind === 'process' &&
        Number.isFinite(tick.durationMs) &&
        tick.atMs - tick.durationMs >= report.warmupMs,
    ).length;
  } catch {
    /* failed launch */
  }
  process.stdout.write(JSON.stringify({ exitCode: code, complete, steadyProcessTicks }) + '\n');
  process.exitCode = code === 0 && complete && steadyProcessTicks >= 3 ? 0 : 1;
});
