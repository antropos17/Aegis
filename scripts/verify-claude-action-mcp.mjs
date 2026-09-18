/** Opt-in Windows verification: real Claude MCP routing, local synthetic model replies. */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { options, treeBytes, removeOwned, createRunner } from './claude-hook-runtime.mjs';
import { replyWithSelectedTool } from './claude-action-mcp-fixture.mjs';
import { verifyReviewRoute } from './claude-mcp-review-fixture.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
const tool = 'mcp__aegis__aegis_execute_selected';
const usage =
  'Windows only: node scripts/verify-claude-action-mcp.mjs [--review] --claude <absolute claude.exe> --bash <absolute bash.exe> --scratch <existing spacious directory>\nExplicitly configures a disposable local MCP server; uses a dummy credential and synthetic loopback API. --review requires a live terminal for confirmation and refusal. No OS firewall isolation; managed policy still applies. Stdout contains fixed readiness JSON lines and a final redacted receipt. No saved user settings are changed.';

async function main(args) {
  if (args.length === 1 && args[0] === '--help') {
    console.log(usage);
    return;
  }
  let selected;
  const review = args[0] === '--review';
  try {
    selected = options(review ? args.slice(1) : args);
    if (review && (!process.stdin.isTTY || !process.stderr.isTTY)) throw Error('terminal');
  } catch {
    console.log(JSON.stringify({ error: 'invalid-options-or-insufficient-space', usage }));
    process.exitCode = 1;
    return;
  }
  const owned = fs.realpathSync(fs.mkdtempSync(path.join(selected.scratch, 'aegis-mcp-owned-')));
  const receipt = {
    checkedAt: new Date().toISOString(),
    mode: review
      ? 'claude-mcp-terminal-review-synthetic-api'
      : 'claude-selected-action-mcp-synthetic-api',
    localHttpRequests: 0,
    rejectedProxyRequests: 0,
    scenarios: [],
    cleanup: false,
    networkBoundary: 'loopback API and rejecting proxy; no OS firewall isolation',
  };
  let scenario;
  let server;
  try {
    for (const name of ['config', 'temp', 'work', 'profile']) fs.mkdirSync(path.join(owned, name));
    server = http.createServer({ maxHeaderSize: 8192 }, (req, res) => {
      receipt.localHttpRequests++;
      if (
        !scenario ||
        req.method !== 'POST' ||
        !/^\/v1\/messages(?:\?|$)/.test(req.url) ||
        scenario.requests >= 6 ||
        receipt.localHttpRequests > 24
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
        replyWithSelectedTool(res, input, current);
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
      ENABLE_TOOL_SEARCH: 'false',
      IS_DEMO: '1',
      CI: '1',
    };
    const run = createRunner({ selected, owned, env, system32, receipt });
    const version = await run(['--version']);
    receipt.version = /^\d+\.\d+\.\d+/.exec(version.stdout)?.[0] || 'unknown';
    const sentinel = path.join(owned, 'PRIVATE_SENTINEL');
    const policyPath = path.join(owned, 'policy.json');
    const requestPath = path.join(owned, 'request.json');
    const configPath = path.join(owned, 'mcp.json');
    const action = {
      executable: process.execPath,
      cwd: path.join(owned, 'work'),
      args: [
        '-e',
        `require('node:fs').writeFileSync(${JSON.stringify(sentinel)},'PRIVATE_BODY');console.log('PRIVATE_OUTPUT');console.error('PRIVATE_ERROR');`,
      ],
      env: {
        SYSTEMROOT: windows,
        WINDIR: windows,
        TEMP: path.join(owned, 'temp'),
        TMP: path.join(owned, 'temp'),
      },
    };
    fs.writeFileSync(requestPath, JSON.stringify({ schemaVersion: 1, action }));
    if (review) {
      await verifyReviewRoute({
        owned,
        repo,
        env,
        run,
        receipt,
        action,
        sentinel,
        policyPath,
        requestPath,
        configPath,
        setScenario: (current) => {
          scenario = current;
        },
      });
      return;
    }
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: {
          aegis: {
            type: 'stdio',
            command: process.execPath,
            args: [
              path.join(repo, 'src/main/main.js'),
              '--action-mcp-stdio',
              policyPath,
              requestPath,
            ],
            env,
          },
        },
      }),
    );
    for (const decision of ['allow', 'deny', 'ask']) {
      if (fs.existsSync(sentinel)) fs.unlinkSync(sentinel);
      fs.writeFileSync(
        policyPath,
        JSON.stringify({
          schemaVersion: 2,
          defaultDecision: 'deny',
          rules: [{ action, decision }],
        }),
      );
      scenario = {
        decision,
        requests: 0,
        toolDiscovered: false,
        toolResultSeen: false,
        privacyPass: false,
      };
      const result = await run([
        '-p',
        'Use the configured selected-action tool once.',
        '--setting-sources',
        '',
        '--strict-mcp-config',
        '--mcp-config',
        configPath,
        '--no-chrome',
        '--no-session-persistence',
        '--permission-mode',
        'dontAsk',
        '--tools',
        '',
        '--allowedTools',
        tool,
        '--model',
        'claude-sonnet-4-6',
        '--output-format',
        'json',
      ]);
      const report = scenario.report;
      const hasSentinel = fs.existsSync(sentinel);
      const pass =
        result.code === 0 &&
        !result.timedOut &&
        !result.exceeded &&
        scenario.toolDiscovered &&
        scenario.toolResultSeen &&
        scenario.privacyPass &&
        report?.decision === decision &&
        (decision === 'allow'
          ? hasSentinel &&
            report.execution.state === 'exited' &&
            report.execution.exitCode === 0 &&
            report.execution.outputComplete === true &&
            !scenario.resultIsError
          : !hasSentinel && report.execution.state === 'not-started' && scenario.resultIsError);
      receipt.scenarios.push({
        ...scenario,
        sentinel: hasSentinel,
        exitCode: result.code,
        timedOut: !!result.timedOut,
        exceeded: !!result.exceeded,
        pass: !!pass,
      });
      scenario = null;
      if (result.code !== 0 || result.timedOut || result.exceeded) break;
    }
    receipt.pass =
      receipt.scenarios.length === 3 &&
      receipt.scenarios.every((item) => item.pass) &&
      receipt.rejectedProxyRequests === 0;
  } catch {
    receipt.pass = false;
    receipt.error = 'verification-failed';
  } finally {
    if (server?.listening) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
    try {
      receipt.scratchBytesBeforeCleanup = treeBytes(owned);
      if (!receipt.unreapedProcess)
        for (let attempt = 0; attempt < 10 && fs.existsSync(owned); attempt++) {
          if (attempt) await new Promise((resolve) => setTimeout(resolve, 100));
          removeOwned(owned, owned);
        }
      receipt.cleanup = !fs.existsSync(owned);
    } catch {
      receipt.cleanup = false;
      receipt.error = 'cleanup-incomplete';
    }
    receipt.retention = receipt.cleanup
      ? 'Owned scratch removed; preserve stdout receipt separately.'
      : 'Owned scratch retained; inspect process state before cleanup.';
    if (!receipt.cleanup) receipt.pass = false;
    console.log(JSON.stringify(receipt));
    process.exitCode = receipt.pass ? 0 : 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main(process.argv.slice(2)).catch(() => {
    console.log('{"error":"verification-failed"}');
    process.exitCode = 1;
  });
