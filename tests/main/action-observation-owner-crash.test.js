import { afterEach, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { observeActionRoute } = require('../../src/main/action-observation-client');
const main = fileURLToPath(new URL('../../src/main/main.js', import.meta.url));
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const wait = (assertion) => vi.waitFor(assertion, { timeout: 4000, interval: 25 });
const cleanups = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function fixture(selection) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aegis-owner-crash-'));
  const marker = path.join(root, 'PRIVATE_EFFECT');
  const other = path.join(root, 'PRIVATE_UNUSED');
  const done = path.join(root, 'PRIVATE_FIXTURE_FINISHED');
  const identity = path.join(root, 'PRIVATE_CHILD_PID');
  // Independent fixture bound, deliberately not evidence of production containment.
  // At most 80 bytes of progress. Even a dead test runner cannot leave this child alive.
  const actions = ['first', 'second'].map((id, index) => {
    const target = index ? other : marker;
    const action = {
      executable: process.execPath,
      cwd: root,
      args: [
        '-e',
        `const fs=require('node:fs');const p=${JSON.stringify(target)};` +
          `fs.writeFileSync(${JSON.stringify(identity)},String(process.pid));` +
          `fs.writeFileSync(p,'x');let n=1;const t=setInterval(()=>{` +
          `if(n++<80)fs.appendFileSync(p,'x');},50);` +
          `setTimeout(()=>{clearInterval(t);fs.writeFileSync(${JSON.stringify(done)},'done');process.exit(0)},4000);`,
      ],
      env:
        process.platform === 'win32'
          ? { SYSTEMROOT: process.env.SystemRoot, WINDIR: process.env.SystemRoot }
          : {},
    };
    const requestPath = path.join(root, id + '-request.json');
    const policyPath = path.join(root, id + '-policy.json');
    fs.writeFileSync(requestPath, JSON.stringify({ schemaVersion: 1, action }));
    fs.writeFileSync(
      policyPath,
      JSON.stringify({
        schemaVersion: 2,
        defaultDecision: 'deny',
        rules: [{ action, decision: 'allow' }],
      }),
    );
    return { id, requestPath, policyPath };
  });
  const catalog = path.join(root, 'catalog.json');
  fs.writeFileSync(catalog, JSON.stringify({ schemaVersion: 1, actions }));
  const owners = [];
  cleanups.push(async () => {
    for (const owner of owners) {
      if (owner.exitCode === null && owner.signalCode === null) owner.kill('SIGKILL');
    }
    // After killing the owner, its child has at most four seconds of fixture lifetime.
    // Do not delete files beneath a still-running disposable child, including on failure.
    await pause(4200);
    expect(path.dirname(root)).toBe(path.resolve(os.tmpdir()));
    expect(fs.lstatSync(root).isSymbolicLink()).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  });
  function start(endpoint) {
    const args =
      selection === 'catalog'
        ? ['--action-mcp-catalog-stdio', catalog]
        : ['--action-mcp-stdio', actions[0].policyPath, actions[0].requestPath];
    const child = spawn(process.execPath, [main, ...args, '--observe', endpoint], {
      cwd: root,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, TEMP: root, TMP: root },
    });
    owners.push(child);
    child.stdin.on('error', () => {});
    let output = '',
      errors = '';
    child.stdout.on('data', (chunk) => {
      if (output.length + chunk.length > 32768) child.kill('SIGKILL');
      output = (output + chunk).slice(0, 32768);
    });
    child.stderr.on('data', (chunk) => {
      if (errors.length + chunk.length > 32768) child.kill('SIGKILL');
      errors = (errors + chunk).slice(0, 32768);
    });
    const exited = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => resolve(code));
    });
    return {
      child,
      exited,
      output: () => output,
      send: (message) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n'),
    };
  }
  return { root, marker, other, done, identity, start };
}

async function nativeWitness(identity) {
  if (process.platform !== 'win32') return null;
  const pid = Number(fs.readFileSync(identity, 'utf8'));
  expect(Number.isSafeInteger(pid) && pid > 0).toBe(true);
  const witness = spawn(
    path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    [
      '-NoProfile',
      '-NonInteractive',
      '-File',
      fileURLToPath(new URL('../fixtures/action-child-exit-witness.ps1', import.meta.url)),
      String(pid),
    ],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
  );
  cleanups.push(() => {
    if (witness.exitCode === null && witness.signalCode === null) witness.kill('SIGKILL');
  });
  let output = '';
  witness.stdout.on('data', (chunk) => {
    output += chunk;
  });
  const exited = new Promise((resolve, reject) => {
    witness.once('error', reject);
    witness.once('exit', resolve);
  });
  await wait(() => expect(output).toContain('ready'));
  return async () => {
    expect(await exited).toBe(0);
    expect(output.trim().split(/\r?\n/)).toEqual(['ready', 'terminated']);
  };
}

async function initialize(owner, endpoint) {
  await wait(() => expect(fs.existsSync(endpoint)).toBe(true));
  const observer = observeActionRoute(endpoint);
  cleanups.push(() => observer.close());
  owner.send({
    id: 10,
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'aegis-owner-crash-fixture', version: '1' },
    },
  });
  await wait(() => expect(owner.output()).toContain('"id":10'));
  owner.send({ method: 'notifications/initialized' });
  await wait(() => expect(observer.snapshot().state).toBe('observed'));
  return observer;
}

it.each(['single-action', 'catalog'])(
  '%s: killed owner loses coverage, leaves a stale descriptor and requires explicit new observation',
  async (selection) => {
    const f = fixture(selection);
    const endpoint = path.join(f.root, 'PRIVATE_ENDPOINT.json');
    const owner = f.start(endpoint);
    const observer = await initialize(owner, endpoint);
    const descriptor = fs.readFileSync(endpoint);
    owner.send({
      id: 1,
      method: 'tools/call',
      params: {
        name: selection === 'catalog' ? 'aegis_action_first' : 'aegis_execute_selected',
        arguments: {},
      },
    });
    await wait(() => expect(fs.existsSync(f.marker)).toBe(true));
    await wait(() =>
      expect(observer.snapshot().snapshot).toMatchObject({
        ownerInvocations: 1,
        ownerSettled: 0,
        cancellationRequests: 0,
      }),
    );
    const verifyTermination = await nativeWitness(f.identity);
    // Kill only the held owner, not a tree: a tree kill would conceal absent containment.
    expect(owner.child.kill('SIGKILL')).toBe(true);
    await owner.exited;
    if (verifyTermination) await verifyTermination();
    await wait(() => expect(observer.snapshot().state).toBe('coverage-lost'));
    const lost = observer.snapshot();
    expect(lost.snapshot).toMatchObject({
      ownerInvocations: 1,
      ownerSettled: 0,
      cancellationRequests: 0,
    });
    expect(fs.readFileSync(endpoint)).toEqual(descriptor);
    const size = fs.statSync(f.marker).size;
    if (verifyTermination) {
      await pause(150);
      expect(fs.statSync(f.marker).size).toBe(size);
      expect(fs.existsSync(f.done)).toBe(false);
    }
    expect(fs.existsSync(f.other)).toBe(false);

    const stale = observeActionRoute(endpoint);
    cleanups.push(() => stale.close());
    await wait(() => expect(stale.snapshot().state).toBe('unavailable'));
    expect(stale.snapshot().snapshot).toBeNull();
    const reuse = f.start(endpoint);
    expect(await reuse.exited).toBe(2);
    expect(fs.readFileSync(endpoint)).toEqual(descriptor);

    const freshEndpoint = path.join(f.root, 'PRIVATE_NEW_ENDPOINT.json');
    const freshOwner = f.start(freshEndpoint);
    const fresh = await initialize(freshOwner, freshEndpoint);
    expect(fresh.snapshot().snapshot.connectionId).not.toBe(lost.snapshot.connectionId);
    expect(fresh.snapshot().snapshot).toMatchObject({ ownerInvocations: 0, ownerSettled: 0 });
    expect(observer.snapshot()).toEqual(lost);
    freshOwner.child.stdin.end();
    expect(await freshOwner.exited).toBe(0);
    await wait(() => expect(fresh.snapshot().state).toBe('coverage-lost'));
    expect(fs.existsSync(freshEndpoint)).toBe(false);
    expect(fs.readFileSync(endpoint)).toEqual(descriptor);
    if (!verifyTermination) await wait(() => expect(fs.existsSync(f.done)).toBe(true));
    const finalSize = fs.statSync(f.marker).size;
    await pause(150);
    expect(fs.statSync(f.marker).size).toBe(finalSize);
    expect(observer.snapshot()).toEqual(lost);
    expect(owner.output()).not.toContain('"id":1,');
    expect(JSON.stringify([lost, fresh.snapshot(), stale.snapshot()])).not.toMatch(
      /PRIVATE|token|termination/,
    );
  },
  20000,
);
