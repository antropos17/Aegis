import { afterEach, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { runGuardian } = require('../fixtures/mcp-crash-custody/bounded-runner.cjs');
const { selectFixture, createFixture } = require('../fixtures/mcp-crash-custody/owned-path.cjs');
const opted =
  process.env.AEGIS_MCP_CRASH_FIXTURE !== undefined ||
  process.env.AEGIS_MCP_CRASH_ROOT !== undefined;
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const guardianSource = path.join(repository, 'tests/fixtures/mcp-crash-custody/Guardian.cs');
const crashWorker = path.join(repository, 'tests/main/fixtures/mcp-gateway-crash-worker.cjs');
const upstream = path.join(repository, 'tests/main/fixtures/mcp-gateway-server.cjs');
const helper = path.join(repository, 'build/sidecar/aegis-mcpjob.exe');
const sources = [
  'Native.cs',
  'AppContainerProfile.cs',
  'AppContainerWorkspace.cs',
  'AppContainerWorkspaceInventory.cs',
  'AppContainerInput.cs',
  'AppContainerExecutable.cs',
].map((name) => path.join(repository, 'sidecar/mcpjob', name));
let root;
let completed = false;
let pending = null;
let controller = null;
const custody = [];
const hash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const save = (file, value) => fs.writeFileSync(file, JSON.stringify(value));

function fixtureEnv(directory) {
  return {
    SystemRoot: process.env.SystemRoot || process.env.SYSTEMROOT,
    TEMP: directory,
    TMP: directory,
    HOME: directory,
    USERPROFILE: directory,
    APPDATA: directory,
    LOCALAPPDATA: directory,
    NODE_DISABLE_COMPILE_CACHE: '1',
  };
}
afterEach(async () => {
  controller?.abort();
  let settled = !pending;
  if (pending) {
    let timer;
    settled = await Promise.race([
      pending.then(
        () => true,
        () => false,
      ),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), 3000);
      }),
    ]);
    clearTimeout(timer);
  }
  // One small fixture root is retained per run as verification evidence; each of
  // three guardian transcripts is capped at 8192 bytes. Do not auto-expire receipts
  // or remove an uncertain tree; the caller owns any later retention decision.
  if (root)
    console.info('Retained synthetic crash fixture:', root, {
      completed,
      settled,
      confirmedPhases: custody.filter(Boolean).length,
    });
  root = undefined;
  completed = false;
  pending = null;
  controller = null;
  custody.length = 0;
});

// Explicit Windows fixture acceptance only; default CI skips rather than qualifying this route.
it.skipIf(!opted)(
  'keeps a consumed grant spent after a held Windows gateway is killed with an effect and no response',
  async () => {
    controller = new AbortController();
    const signal = controller.signal;
    const selected = selectFixture();
    createFixture(selected);
    root = selected;
    const files = Object.fromEntries(
      [
        'policy',
        'request',
        'manifest',
        'config',
        'effects',
        'started',
        'listed',
        'store',
        'disclosure',
        'secrets',
        'reviews',
      ].map((name) => [name, path.join(root, name)]),
    );
    fs.mkdirSync(files.store);
    const objectSchema = (properties) => ({
      type: 'object',
      properties,
      required: Object.keys(properties),
      additionalProperties: false,
    });
    const tool = {
      name: 'record',
      inputSchema: objectSchema({ recipient: { type: 'string', maxLength: 64 } }),
      outputSchema: objectSchema({ accepted: { type: 'boolean' } }),
    };
    const action = {
      executable: process.execPath,
      cwd: root,
      args: [upstream, files.config],
      env: { SYSTEMROOT: process.env.SystemRoot || process.env.SYSTEMROOT, TEMP: root, TMP: root },
    };
    const now = Date.now();
    const grant = {
      id: '1'.repeat(32),
      taskId: 't'.repeat(32),
      notBefore: now - 1000,
      expiresAt: now + 120000,
      tool: 'record',
      arguments: { recipient: 'chosen' },
    };
    save(files.policy, {
      schemaVersion: 2,
      defaultDecision: 'deny',
      rules: [{ action, decision: 'allow' }],
    });
    save(files.request, { schemaVersion: 1, action });
    save(files.manifest, { schemaVersion: 2, tools: [tool], grants: [grant] });
    save(files.config, { ...files, tool, mode: 'hang' });
    save(files.secrets, { schemaVersion: 1, values: ['Synthetic_Secret_847'] });
    save(files.disclosure, {
      schemaVersion: 1,
      tools: [{ name: 'record', paths: ['/recipient'] }],
    });
    const effects = () =>
      fs.existsSync(files.effects)
        ? fs.readFileSync(files.effects, 'utf8').trim().split('\n').map(JSON.parse)
        : [];
    const compiler = path.join(
      process.env.SystemRoot || process.env.SYSTEMROOT,
      'Microsoft.NET/Framework64/v4.0.30319/csc.exe',
    );
    const executable = path.join(root, 'guardian.exe');
    const compile = spawnSync(
      compiler,
      [
        '/nologo',
        '/target:exe',
        '/platform:x64',
        '/optimize+',
        '/warnaserror+',
        '/reference:System.Web.Extensions.dll',
        `/out:${executable}`,
        guardianSource,
        ...sources,
      ],
      { cwd: root, env: fixtureEnv(root), windowsHide: true, timeout: 20000, maxBuffer: 65536 },
    );
    expect(compile.status).toBe(0);
    const nodeHash = hash(process.execPath),
      helperHash = hash(helper);
    const provenance = Object.fromEntries(
      [
        ['guardianSource', guardianSource],
        ['guardianExecutable', executable],
        ['node', process.execPath],
        ['helper', helper],
        ['compiler', compiler],
        ['crashWorker', crashWorker],
        ['upstream', upstream],
        ['runner', path.join(repository, 'tests/fixtures/mcp-crash-custody/bounded-runner.cjs')],
        ['pathGate', path.join(repository, 'tests/fixtures/mcp-crash-custody/owned-path.cjs')],
        ['parentCheck', path.join(repository, 'tests/fixtures/mcp-crash-custody/check-parent.ps1')],
        ['gatewayJob', path.join(repository, 'src/main/mcp-gateway-windows-job.js')],
        ['helperProgram', path.join(repository, 'sidecar/mcpjob/Program.cs')],
        ...sources.map((source) => [path.basename(source), source]),
      ].map(([name, file]) => [name, hash(file)]),
    );
    const used = path.join(
      files.store,
      createHash('sha256').update(grant.id).digest('hex') + '.used',
    );
    const expectedEffects = [{ name: 'record', arguments: { recipient: 'chosen' } }];
    const phase = async (mode, check) => {
      if (signal.aborted) throw Error('fixture-cancelled');
      let readyError;
      pending = runGuardian({
        command: executable,
        cwd: root,
        env: fixtureEnv(root),
        signal,
        args: [process.execPath, crashWorker, helper, root, mode, nodeHash, helperHash],
        onReady: () => {
          if (signal.aborted) throw Error('fixture-cancelled');
          try {
            check();
          } catch (error) {
            readyError = error;
            throw error;
          }
        },
      });
      const result = await pending;
      if (signal.aborted) throw Error('fixture-cancelled');
      pending = null;
      custody.push(result.status === 'confirmed');
      const receipt = {
        mode,
        status: result.status,
        code: result.code,
        reason: result.reason,
        provenance,
        output: result.output,
      };
      fs.writeFileSync(path.join(root, `receipt-${mode}.json`), JSON.stringify(receipt), {
        flag: 'wx',
      });
      console.info('Synthetic custody receipt:', JSON.stringify(receipt));
      if (readyError) throw readyError;
      expect(result.status).toBe('confirmed');
    };
    await phase('effect', () => {
      expect(effects()).toEqual(expectedEffects);
      expect(fs.readFileSync(files.reviews, 'utf8')).toBe('effect\n');
      expect(fs.lstatSync(used).isFile()).toBe(true);
    });
    await phase('spent', () => {
      expect(JSON.parse(fs.readFileSync(path.join(root, 'result-spent'), 'utf8'))).toEqual({
        error: 'gateway-call-failed',
        clean: true,
      });
      expect(fs.readFileSync(files.reviews, 'utf8')).toBe('effect\n');
      expect(effects()).toEqual(expectedEffects);
    });
    if (signal.aborted) throw Error('fixture-cancelled');
    save(files.manifest, {
      schemaVersion: 2,
      tools: [tool],
      grants: [{ ...grant, id: '2'.repeat(32) }],
    });
    await phase('decline', () => {
      expect(JSON.parse(fs.readFileSync(path.join(root, 'result-decline'), 'utf8'))).toEqual({
        error: 'gateway-review-declined',
        clean: true,
      });
      expect(fs.readFileSync(files.reviews, 'utf8')).toBe('effect\ndecline\n');
      expect(effects()).toEqual(expectedEffects);
    });
    if (signal.aborted) throw Error('fixture-cancelled');
    completed = true;
  },
  90000,
);
