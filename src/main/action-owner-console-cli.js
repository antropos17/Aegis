'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');
const { createOwnerConsole } = require('./action-owner-console');

async function terminateAndWait(child) {
  if (!child) return;
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    let timer;
    const done = () => {
      clearTimeout(timer);
      child.removeListener('close', done);
      resolve();
    };
    child.once('close', done);
    timer = setTimeout(done, 3000);
    try {
      child.kill();
    } catch {
      /* already closed */
    }
    if (child.exitCode !== null || child.signalCode !== null) done();
  });
}

/** Run only the selected-delete broker after the packaged verifier authenticates its owner. */
async function runOwnerConsoleReview(args, bootstrap) {
  if (
    process.platform !== 'win32' ||
    typeof process.resourcesPath !== 'string' ||
    typeof bootstrap?.pipe !== 'string' ||
    !/^aegis-owner-[a-f0-9]{32}$/.test(bootstrap.pipe) ||
    typeof bootstrap.secret !== 'string' ||
    !/^[A-Za-z0-9+/]{43}=$/.test(bootstrap.secret) ||
    Buffer.from(bootstrap.secret, 'base64').length !== 32 ||
    Buffer.from(bootstrap.secret, 'base64').toString('base64') !== bootstrap.secret
  )
    return 2;
  const environment = {
    AEGIS_OWNER_PIPE: bootstrap.pipe,
    AEGIS_OWNER_SECRET: bootstrap.secret,
  };
  for (const key of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP'])
    if (process.env[key]) environment[key] = process.env[key];
  let child;
  let terminal;
  try {
    child = spawn(
      path.join(process.resourcesPath, 'sidecar', 'aegis-owner-console.exe'),
      ['--verify'],
      {
        env: environment,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'ignore'],
      },
    );
    // Avoid passing these credentials to the broker or any subsequently spawned helper.
    delete environment.AEGIS_OWNER_PIPE;
    delete environment.AEGIS_OWNER_SECRET;
    bootstrap.pipe = undefined;
    bootstrap.secret = undefined;
    terminal = await createOwnerConsole({ child });
    if (!terminal) return 2;
    const run = (selected, options) =>
      require('./action-mcp-review').handleActionMcpReview(selected, { ...options, terminal });
    const result = args.includes('--observe')
      ? await require('./action-observation-server').runObservedMcp(args, run, 'mcp-review')
      : await run(args);
    return (await terminal.close()) ? result : 2;
  } catch {
    if (terminal) await terminal.close();
    else await terminateAndWait(child);
    return 2;
  } finally {
    delete environment.AEGIS_OWNER_PIPE;
    delete environment.AEGIS_OWNER_SECRET;
    bootstrap.pipe = undefined;
    bootstrap.secret = undefined;
  }
}

module.exports = { runOwnerConsoleReview };
