/** Opt-in Windows provider smoke. Uses synthetic loopback API responses, never a real model. */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

import { quote, toolInput, sendReply } from './claude-hook-fixture.mjs';
import { options, treeBytes, removeOwned, createRunner } from './claude-hook-runtime.mjs';
import { startPolicySessionFixture } from './claude-policy-session-fixture.mjs';

const require = createRequire(import.meta.url);
const repo = fileURLToPath(new URL('../', import.meta.url));
const usage =
  'Windows only: node scripts/verify-claude-hooks.mjs --claude <absolute claude.exe> --bash <absolute bash.exe> --scratch <existing spacious directory>\nUses isolated settings and synthetic local API replies. No OS firewall isolation. Managed machine policy still applies. Scratch is removed; stdout is a redacted receipt. Not a CI check.';
async function main(args) {
  if (args.length === 1 && args[0] === '--help') {
    console.log(usage);
    return;
  }
  let selected;
  try {
    selected = options(args);
  } catch {
    console.log(JSON.stringify({ error: 'invalid-options-or-insufficient-space', usage }));
    process.exitCode = 1;
    return;
  }
  const owned = fs.realpathSync(
    fs.mkdtempSync(path.join(selected.scratch, 'aegis-provider-owned-')),
  );
  const receipt = {
    checkedAt: new Date().toISOString(),
    mode: 'claude-hooks-synthetic-api',
    localHttpRequests: 0,
    rejectedProxyRequests: 0,
    initOnly: false,
    scenarios: [],
    cleanup: false,
    networkBoundary: 'loopback API and rejecting proxy; no OS firewall isolation',
  };
  let scenario = null;
  let collector;
  let server;
  let policyFixture;
  try {
    for (const folder of ['config', 'temp', 'work', 'profile'])
      fs.mkdirSync(path.join(owned, folder));
    server = http.createServer({ maxHeaderSize: 8192 }, (req, res) => {
      receipt.localHttpRequests++;
      if (
        !scenario ||
        req.method !== 'POST' ||
        !/^\/v1\/messages(?:\?|$)/.test(req.url) ||
        scenario.requests >= 8
      ) {
        receipt.rejectedProxyRequests++;
        req.resume();
        res.writeHead(503);
        res.end();
        return;
      }
      const current = scenario;
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (Buffer.byteLength(body) > 1048576) req.destroy();
      });
      req.on('error', () => {});
      req.on('end', () => {
        let input;
        try {
          input = JSON.parse(body);
        } catch {
          res.writeHead(400);
          res.end();
          return;
        }
        if (scenario !== current) {
          res.writeHead(503);
          res.end();
          return;
        }
        current.requests++;
        sendReply(res, input, current);
      });
    });
    server.on('connect', (_req, socket) => {
      receipt.rejectedProxyRequests++;
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    });
    server.on('connection', (socket) => {
      const deadline = setTimeout(() => socket.destroy(), 3000);
      socket.on('close', () => clearTimeout(deadline));
    });
    server.maxConnections = 8;
    server.requestTimeout = 2000;
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const endpoint = `http://127.0.0.1:${server.address().port}`;
    const marker = path.join(owned, 'marker.jsonl');
    const script = path.join(owned, 'hook.cjs');
    fs.writeFileSync(
      script,
      `const fs=require('node:fs');let s='';process.stdin.on('data',b=>{s+=b;if(s.length>65536)process.exit(1)});process.stdin.on('end',()=>{try{const p=JSON.parse(s);const event=['Setup','SessionStart','PostToolUse','PreToolUse'].includes(p.hook_event_name)?p.hook_event_name:'unknown';fs.appendFileSync(${JSON.stringify(marker)},JSON.stringify({event})+'\\n');if(event==='PreToolUse')console.log(JSON.stringify({hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'allow',permissionDecisionReason:'Local synthetic smoke check'}}))}catch{process.exitCode=1}});setTimeout(()=>process.exit(1),3000).unref();`,
    );
    const command = `${quote(process.execPath)} ${quote(script)}`;
    const settings = path.join(owned, 'settings.json');
    const observe = (events) =>
      Object.fromEntries(
        events.map((event) => [event, [{ hooks: [{ type: 'command', command, timeout: 4 }] }]]),
      );
    fs.writeFileSync(settings, JSON.stringify({ hooks: observe(['Setup', 'SessionStart']) }));
    const windows = process.env.SystemRoot;
    if (!windows || !path.isAbsolute(windows)) throw Error('windows');
    const system32 = path.join(windows, 'System32');
    const env = {
      SystemRoot: windows,
      WINDIR: windows,
      COMSPEC: path.join(system32, 'cmd.exe'),
      PATHEXT: '.COM;.EXE;.BAT;.CMD',
      PATH: [
        path.dirname(process.execPath),
        path.dirname(selected.bash),
        path.resolve(path.dirname(selected.bash), '../cmd'),
        system32,
      ].join(';'),
      USERPROFILE: path.join(owned, 'profile'),
      APPDATA: path.join(owned, 'profile'),
      LOCALAPPDATA: path.join(owned, 'profile'),
      TEMP: path.join(owned, 'temp'),
      TMP: path.join(owned, 'temp'),
      CLAUDE_CONFIG_DIR: path.join(owned, 'config'),
      CLAUDE_CODE_GIT_BASH_PATH: selected.bash,
      ANTHROPIC_API_KEY: 'local-test-placeholder-not-a-credential',
      ANTHROPIC_BASE_URL: endpoint,
      HTTP_PROXY: endpoint,
      HTTPS_PROXY: endpoint,
      ALL_PROXY: endpoint,
      NO_PROXY: '127.0.0.1,localhost',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      DISABLE_AUTOUPDATER: '1',
      DISABLE_UPDATES: '1',
      DISABLE_TELEMETRY: '1',
      DISABLE_ERROR_REPORTING: '1',
      CLAUDE_CODE_ENABLE_TELEMETRY: '0',
      CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false',
      IS_DEMO: '1',
      CI: '1',
    };
    const run = createRunner({ selected, owned, env, system32, receipt });
    const common = [
      '--setting-sources',
      '',
      '--settings',
      settings,
      '--strict-mcp-config',
      '--mcp-config',
      '{"mcpServers":{}}',
      '--no-chrome',
    ];
    const readEvents = () =>
      fs.existsSync(marker)
        ? fs
            .readFileSync(marker, 'utf8')
            .trim()
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line).event)
            .filter((event) =>
              ['Setup', 'SessionStart', 'PreToolUse', 'PostToolUse'].includes(event),
            )
        : [];
    const version = await run(['--version']);
    receipt.version = /^\d+\.\d+\.\d+/.exec(version.stdout)?.[0] || 'unknown';
    const init = await run(['--init-only', ...common]);
    const initEvents = readEvents();
    receipt.initOnly =
      init.code === 0 &&
      !init.timedOut &&
      !init.exceeded &&
      initEvents.includes('Setup') &&
      initEvents.includes('SessionStart') &&
      receipt.localHttpRequests === 0;
    if (!receipt.initOnly) throw Error('init');
    const token = randomBytes(32).toString('hex');
    collector = await require('../src/main/handoff-live.js').startHandoffCollector({
      port: 0,
      token,
      durationMs: 120000,
    });
    env.AEGIS_HANDOFF_TOKEN = token;
    env.AEGIS_HANDOFF_PORT = String(collector.port);
    const prefix = `${quote(process.execPath)} ${quote(path.join(repo, 'src/main/main.js'))}`;
    for (const kind of [
      'baseline',
      'allow',
      'deny',
      'missing-hook',
      'agent',
      'linked-allow',
      'linked-deny',
    ]) {
      fs.writeFileSync(marker, '');
      scenario = { kind, requests: 0, sentinel: path.join(owned, 'sentinel') };
      if (fs.existsSync(scenario.sentinel)) fs.unlinkSync(scenario.sentinel);
      const policy = path.join(owned, 'policy.json');
      fs.writeFileSync(
        policy,
        JSON.stringify({
          schemaVersion: 1,
          cwd: fs.realpathSync(path.join(owned, 'work')),
          defaultDecision: 'deny',
          rules: ['agent', 'baseline', 'missing-hook'].includes(kind)
            ? []
            : [{ tool: 'Bash', input: toolInput(scenario), decision: kind.replace('linked-', '') }],
        }),
      );
      const hooks = observe(['SessionStart', 'PreToolUse', 'PostToolUse']);
      if (kind === 'baseline') delete hooks.PreToolUse;
      if (kind === 'missing-hook')
        hooks.PreToolUse = [
          {
            hooks: [
              {
                type: 'command',
                command: quote(path.join(owned, 'nonexistent-hook.exe')),
                timeout: 4,
              },
            ],
          },
        ];
      if (kind === 'allow' || kind === 'deny')
        hooks.PreToolUse = [
          {
            hooks: [
              {
                type: 'command',
                command: `${prefix} --action-policy-hook ${quote(policy)}`,
                timeout: 4,
              },
            ],
          },
        ];
      for (const event of ['SubagentStart', 'SubagentStop'])
        hooks[event] = [
          { hooks: [{ type: 'command', command: `${prefix} --handoff-send`, timeout: 5 }] },
        ];
      if (kind.startsWith('linked-')) {
        policyFixture = await startPolicySessionFixture({ policyPath: policy, env });
        for (const event of ['PreToolUse', 'PostToolUse', 'PostToolUseFailure'])
          hooks[event] = [
            { hooks: [{ type: 'command', command: policyFixture.command, timeout: 4 }] },
          ];
      }
      fs.writeFileSync(settings, JSON.stringify({ hooks }));
      const result = await run([
        '-p',
        'Local synthetic harness.',
        ...common,
        '--no-session-persistence',
        '--permission-mode',
        'dontAsk',
        ...(kind === 'agent' ? [] : ['--allowedTools', 'Bash']),
        '--tools',
        kind === 'agent' ? 'Agent' : 'Bash',
        '--model',
        'claude-sonnet-4-6',
        '--output-format',
        'json',
      ]);
      receipt.scenarios.push({
        kind,
        requests: scenario.requests,
        exitCode: result.code,
        timedOut: !!result.timedOut,
        exceeded: !!result.exceeded,
        hooks: readEvents(),
        sentinel: fs.existsSync(scenario.sentinel),
        ...(policyFixture ? { linkage: await policyFixture.close() } : {}),
      });
      policyFixture = null;
      scenario = null;
      if (result.code !== 0 || result.timedOut || result.exceeded) throw Error('scenario');
    }
    const report = await collector.close();
    collector = null;
    receipt.lifecycle = {
      events: report.events.map((event) => event.kind),
      accepted: report.receiver.accepted,
      rejected: report.receiver.rejected,
      lossDetected: report.receiver.lossDetected,
      activityCoverage: report.activityCoverage,
      control: report.control,
    };
    receipt.pass =
      receipt.scenarios[0].sentinel &&
      receipt.scenarios[1].sentinel &&
      !receipt.scenarios[2].sentinel &&
      receipt.scenarios[3].sentinel &&
      receipt.scenarios[5].sentinel &&
      !receipt.scenarios[6].sentinel &&
      receipt.scenarios[5].linkage.before.length === 1 &&
      receipt.scenarios[5].linkage.before[0].decision === 'allow' &&
      receipt.scenarios[5].linkage.after.length === 1 &&
      receipt.scenarios[5].linkage.after[0].status === 'linked' &&
      receipt.scenarios[5].linkage.after[0].sameActionRef &&
      receipt.scenarios[6].linkage.before.length === 1 &&
      receipt.scenarios[6].linkage.before[0].decision === 'deny' &&
      receipt.scenarios[6].linkage.after.length === 0 &&
      !receipt.scenarios[5].linkage.lossDetected &&
      !receipt.scenarios[6].linkage.lossDetected &&
      receipt.scenarios[5].linkage.transport.requests === 2 &&
      receipt.scenarios[6].linkage.transport.requests === 1 &&
      receipt.scenarios[5].linkage.transport.rejected === 0 &&
      receipt.scenarios[6].linkage.transport.rejected === 0 &&
      receipt.scenarios[0].hooks.includes('PostToolUse') &&
      receipt.scenarios[1].hooks.includes('PostToolUse') &&
      !receipt.scenarios[2].hooks.includes('PostToolUse') &&
      report.events.length === 2 &&
      report.events[0].kind === 'subagent-start' &&
      report.events[1].kind === 'subagent-stop' &&
      !report.receiver.lossDetected &&
      receipt.rejectedProxyRequests === 0;
  } catch {
    receipt.pass = false;
    receipt.error = 'verification-failed';
  } finally {
    if (policyFixture) await policyFixture.close();
    if (collector) await collector.close();
    if (server?.listening) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    try {
      receipt.scratchBytesBeforeCleanup = treeBytes(owned);
      if (!receipt.unreapedProcess) {
        for (let attempt = 0; attempt < 3 && fs.existsSync(owned); attempt++) {
          if (attempt) await new Promise((resolve) => setTimeout(resolve, 100));
          removeOwned(owned, owned);
        }
      }
      receipt.cleanup = !fs.existsSync(owned);
    } catch {
      receipt.cleanup = false;
      receipt.error = 'cleanup-incomplete';
    }
    receipt.retention = receipt.cleanup
      ? 'Owned scratch removed after run; preserve stdout receipt separately.'
      : 'Owned scratch remains; inspect process state before cleanup and preserve stdout receipt.';
    if (!receipt.cleanup) receipt.pass = false;
    console.log(JSON.stringify(receipt));
    process.exitCode = receipt.pass ? 0 : 1;
  }
}

// Importing this module never starts provider processes or creates scratch files.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(() => {
    console.log('{"error":"verification-failed"}');
    process.exitCode = 1;
  });
}
