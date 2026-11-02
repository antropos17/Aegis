import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { setTimeout as pause } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const [exe, output, helper] = process.argv.slice(2);
assert(process.platform === 'win32' && [exe, output, helper].every((p) => p && path.isAbsolute(p)));
assert(!fs.existsSync(output), 'New task-owned output required');
fs.mkdirSync(output);
const hash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const save = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2));
const receipt = {
  schema: 'aegis-packaged-owner-delete/1',
  status: 'FAIL',
  source: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  package: {
    exeSha256: hash(exe),
    archiveSha256: hash(path.join(path.dirname(exe), 'resources/app.asar')),
  },
  observerSha256: hash(helper),
  driverSha256: hash(fileURLToPath(import.meta.url)),
  scope:
    'Real packaged owner console, actual MCP/delete helper, scripted console input; no human-authentication or provider-model claim.',
  cases: [],
};
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
function ownFixtureMarkers(profile) {
  // Elevated creators may assign BUILTIN\\Administrators ownership. Normalize
  // only the five fresh disposable anchors to the actual executing SID.
  const script = `$ErrorActionPreference='Stop'; $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User; $before=0; $after=0; foreach($name in @('appdata','localappdata','userprofile','home','temp')) { $file=Join-Path (Join-Path $env:AEGIS_QA_PROFILE $name) '.aegis-owner-profile-anchor'; $item=Get-Item -LiteralPath $file -Force; if($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Ordinary fresh anchor required'}; $acl=Get-Acl -LiteralPath $file; if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -eq $sid.Value){$before++}else{$acl.SetOwner($sid); Set-Acl -LiteralPath $file -AclObject $acl}; if((Get-Acl -LiteralPath $file).GetOwner([Security.Principal.SecurityIdentifier]).Value -eq $sid.Value){$after++} }; if($after -ne 5){throw 'Fixture anchor ownership not established'}; @{alreadyOwned=$before;ownedAfter=$after} | ConvertTo-Json -Compress`;
  return JSON.parse(
    execFileSync(
      path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64'),
      ],
      {
        env: {
          ...process.env,
          PSModulePath: path.join(
            process.env.SystemRoot,
            'System32/WindowsPowerShell/v1.0/Modules',
          ),
          AEGIS_QA_PROFILE: profile,
        },
        encoding: 'utf8',
        timeout: 10000,
        windowsHide: true,
        maxBuffer: 4096,
      },
    ),
  );
}
function remainingOwnedProcesses() {
  const command =
    '$ErrorActionPreference="Stop"; $root=$env:AEGIS_QA_PACKAGE_ROOT; $helper=$env:AEGIS_QA_HELPER; @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -and ($_.ExecutablePath.StartsWith($root,[StringComparison]::OrdinalIgnoreCase) -or $_.ExecutablePath -ieq $helper) } | Select-Object -ExpandProperty ProcessId) | ConvertTo-Json -Compress';
  const result = execFileSync(
    path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(command, 'utf16le').toString('base64'),
    ],
    {
      env: {
        ...process.env,
        PSModulePath: path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/Modules'),
        AEGIS_QA_PACKAGE_ROOT: path.dirname(exe) + path.sep,
        AEGIS_QA_HELPER: helper,
      },
      encoding: 'utf8',
      timeout: 5000,
      windowsHide: true,
      maxBuffer: 4096,
    },
  ).trim();
  return result ? [].concat(JSON.parse(result)) : [];
}
async function until(test, timeout, label) {
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) {
    const result = test();
    if (result) return result;
    await pause(25);
  }
  throw Error('Timed out: ' + label);
}
function start(file, args, cwd) {
  const env = { ...process.env };
  for (const name of Object.keys(env))
    if (/^(NODE_|ELECTRON_|DOTNET_STARTUP|COREHOST_|COR_|COMPLUS_)/i.test(name)) delete env[name];
  const child = spawn(file, args, {
    cwd,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let bytes = 0;
  const logs = [];
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (part) => {
      bytes += part.length;
      if (bytes <= 65536) logs.push(part);
      else child.kill();
    });
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) =>
      resolve({ code, signal, bytes, log: Buffer.concat(logs).toString('utf8') }),
    );
  });
  return { child, done };
}
async function connect(endpoint) {
  const descriptor = read(endpoint);
  assert(descriptor.schemaVersion === 1 && /^[a-f0-9]{64}$/.test(descriptor.token));
  const socket = net.createConnection({ host: '127.0.0.1', port: descriptor.port });
  const pending = new Map();
  let buffer = '',
    total = 0,
    closed = false;
  const closedResult = new Promise((resolve) =>
    socket.once('close', () => {
      closed = true;
      for (const request of pending.values()) request.reject(Error('MCP closed'));
      pending.clear();
      resolve();
    }),
  );
  socket.on('error', () => {});
  socket.on('data', (part) => {
    total += part.length;
    if (total > 524288) return socket.destroy();
    buffer += part.toString('utf8');
    for (;;) {
      const end = buffer.indexOf('\n');
      if (end < 0) break;
      let message;
      try {
        message = JSON.parse(buffer.slice(0, end));
      } catch {
        socket.destroy();
        return;
      }
      buffer = buffer.slice(end + 1);
      const request = pending.get(message.id);
      if (request) {
        pending.delete(message.id);
        request.resolve(message);
      }
    }
  });
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  socket.write(descriptor.token + '\n');
  let id = 0;
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      assert(!closed);
      const n = ++id;
      pending.set(n, { resolve, reject });
      socket.write(JSON.stringify({ jsonrpc: '2.0', id: n, method, params }) + '\n');
    });
  assert(
    (
      await request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'owned-native-qualification', version: '1' },
      })
    ).result,
  );
  socket.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const tools = await request('tools/list', {});
  assert(tools.result.tools.some((t) => t.name === 'aegis_delete_selected_file'));
  return { socket, request, closedResult };
}
try {
  for (const scenario of ['approve', 'reject', 'policy-change', 'cancel', 'interrupt']) {
    const root = path.join(output, scenario);
    fs.mkdirSync(root);
    const target = path.join(root, 'owned-target.txt');
    fs.writeFileSync(target, 'Disposable selected-delete qualification fixture.');
    const before = hash(target);
    const policy = path.join(root, 'policy.json'),
      request = path.join(root, 'request.json');
    const endpoint = path.join(root, 'endpoint.json'),
      profile = path.join(root, 'profile');
    fs.mkdirSync(profile);
    for (const name of ['appdata', 'localappdata', 'userprofile', 'home', 'temp']) {
      fs.mkdirSync(path.join(profile, name));
      fs.writeFileSync(
        path.join(profile, name, '.aegis-owner-profile-anchor'),
        'Owned fixture anchor',
      );
    }
    const fixtureOwnership = ownFixtureMarkers(profile);
    save(path.join(root, 'fixture-ownership.json'), fixtureOwnership);
    const operation = { kind: 'delete-file', path: target };
    save(request, { schemaVersion: 1, operation });
    save(policy, {
      schemaVersion: 1,
      defaultDecision: 'deny',
      rules: [{ operation, decision: 'allow' }],
    });
    save(path.join(root, 'plan.json'), {
      launcher: path.join(path.dirname(exe), 'resources/sidecar/aegis-owner-console.exe'),
      profile,
      policy,
      request,
      endpoint,
    });
    const owned = start(helper, ['outer', root], root);
    const timer = setTimeout(() => owned.child.kill(), 50000);
    let client;
    try {
      await until(() => fs.existsSync(endpoint), 20000, 'owner endpoint');
      client = await connect(endpoint);
      const call = client.request('tools/call', {
        name: 'aegis_delete_selected_file',
        arguments: {},
      });
      // Observe a deliberately cancelled promise without an unhandled rejection.
      const outcome = call.then(
        (value) => {
          save(path.join(root, 'call.json'), value);
          return { value };
        },
        () => ({ closed: true }),
      );
      await Promise.race([
        until(() => fs.existsSync(path.join(root, 'review.json')), 10000, 'actual console preview'),
        outcome.then(() => {
          throw Error('MCP settled before an owner console preview; inspect call.json');
        }),
      ]);
      if (scenario === 'policy-change') fs.appendFileSync(policy, '\n');
      if (scenario === 'cancel') client.socket.destroy();
      else
        fs.writeFileSync(
          path.join(root, 'control.txt'),
          scenario === 'interrupt' ? 'interrupt' : scenario === 'reject' ? 'reject' : 'approve',
        );
      const result = await Promise.race([
        outcome,
        pause(15000).then(() => {
          throw Error('MCP outcome timeout');
        }),
      ]);
      if (!client.socket.destroyed) client.socket.end();
      const settled = await owned.done;
      save(path.join(root, 'driver.json'), settled);
      assert.equal(settled.code, 0, 'Console observation must finish without forced termination');
      const observation = read(path.join(root, 'console.json'));
      assert.equal(observation.forced, false);
      assert.equal(observation.reviewObserved, true);
      await until(
        () => remainingOwnedProcesses().length === 0,
        5000,
        'owned package process cleanup',
      );
      const exists = fs.existsSync(target);
      if (scenario === 'approve') {
        assert.equal(result.value?.result?.isError, false);
        assert.equal(exists, false, 'Independent filesystem absence is required');
      } else {
        assert.equal(exists, true);
        assert.equal(hash(target), before, 'Refused/cancelled target bytes must remain');
        if (scenario === 'reject' || scenario === 'policy-change')
          assert.equal(result.value?.result?.isError, true);
      }
      receipt.cases.push({
        scenario,
        status: 'PASS',
        actualConsole: true,
        targetAbsent: !exists,
        noOwnedProcesses: true,
        fixtureOwnership,
        ...observation,
      });
      save(path.join(output, 'receipt.json'), receipt);
      console.log(scenario + ': PASS');
    } finally {
      clearTimeout(timer);
      client?.socket.destroy();
      if (owned.child.exitCode === null) owned.child.kill();
    }
  }
  receipt.status = 'PASS';
} catch (error) {
  receipt.error = String(error.stack || error);
  process.exitCode = 1;
} finally {
  save(path.join(output, 'receipt.json'), receipt);
  console.log(JSON.stringify({ status: receipt.status, cases: receipt.cases.length, output }));
}
