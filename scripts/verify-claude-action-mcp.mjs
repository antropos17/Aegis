/** Opt-in Windows verification: real Claude MCP routing, local synthetic model replies. */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { options, treeBytes, removeOwned, createRunner } from './claude-hook-runtime.mjs';
import { replyWithSelectedTool } from './claude-action-mcp-fixture.mjs';
import { verifyReviewRoute } from './claude-mcp-review-fixture.mjs';
import { verifySelectedRoute } from './claude-single-provider-fixture.mjs';
import { replyWithCatalogTools } from './claude-catalog-model-fixture.mjs';
import { verifyCatalogRoute } from './claude-catalog-provider-fixture.mjs';
import { replyWithStatusTools } from './claude-status-model-fixture.mjs';
import { verifyStatusRoute } from './claude-status-provider-fixture.mjs';
import { prepareObservationReply } from './claude-observation-provider-fixture.mjs';
import { prepareReviewObservationReply } from './claude-review-observation-fixture.mjs';
import { prepareCatalogReviewObservationReply } from './claude-catalog-review-observation.mjs';
import {
  verifyCancellationRoute,
  replyWithCancellationTool,
} from './claude-cancellation-provider-fixture.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
const usage =
  'Windows only: node scripts/verify-claude-action-mcp.mjs [--cancellation | --catalog-cancellation | --review | --review-observation | --catalog-review-observation | --catalog | --catalog-review | --status | --catalog-status | --observation | --catalog-observation] --claude <absolute claude.exe> --bash <absolute bash.exe> --scratch <existing spacious directory>\nExplicitly configures disposable local MCP servers; uses a dummy credential and synthetic loopback API. Status modes query current-connection counters before and after allow/deny/ask actions. Observation modes additionally require live snapshots, owner-exit loss and descriptor cleanup. Cancellation modes use stream-json interrupt after real marker growth and require held-child termination, live cancellation counters and cleanup. Review modes require a live terminal for confirmation and refusal. Review observation also waits for pendingObserved before an answer and records pending disconnect. No OS firewall isolation; managed policy still applies. Stdout contains fixed readiness JSON lines and a final redacted receipt. No saved user settings are changed.';

async function main(args) {
  if (args.length === 1 && args[0] === '--help') {
    console.log(usage);
    return;
  }
  let selected;
  const cancellation = ['--cancellation', '--catalog-cancellation'].includes(args[0]);
  const reviewObservation = ['--review-observation', '--catalog-review-observation'].includes(
    args[0],
  );
  const observation = ['--observation', '--catalog-observation'].includes(args[0]);
  const status = observation || ['--status', '--catalog-status'].includes(args[0]);
  const catalog = [
    '--catalog',
    '--catalog-review',
    '--catalog-status',
    '--catalog-observation',
    '--catalog-review-observation',
    '--catalog-cancellation',
  ].includes(args[0]);
  const review = reviewObservation || ['--review', '--catalog-review'].includes(args[0]);
  try {
    selected = options(review || catalog || status || cancellation ? args.slice(1) : args);
    if (review && (!process.stdin.isTTY || !process.stderr.isTTY)) throw Error('terminal');
  } catch {
    console.log(JSON.stringify({ error: 'invalid-options-or-insufficient-space', usage }));
    process.exitCode = 1;
    return;
  }
  const owned = fs.realpathSync(fs.mkdtempSync(path.join(selected.scratch, 'aegis-mcp-owned-')));
  const receipt = {
    checkedAt: new Date().toISOString(),
    mode: status
      ? catalog
        ? 'claude-catalog-status-synthetic-api'
        : 'claude-selected-status-synthetic-api'
      : catalog
        ? review
          ? 'claude-catalog-review-synthetic-api'
          : 'claude-catalog-stdio-synthetic-api'
        : review
          ? 'claude-mcp-terminal-review-synthetic-api'
          : 'claude-selected-action-mcp-synthetic-api',
    localHttpRequests: 0,
    rejectedProxyRequests: 0,
    scenarios: [],
    cleanup: false,
    networkBoundary: 'loopback API and rejecting proxy; no OS firewall isolation',
    liveObservation: observation || reviewObservation || cancellation,
  };
  if (cancellation)
    receipt.mode = catalog
      ? 'claude-catalog-cancellation-synthetic-api'
      : 'claude-selected-cancellation-synthetic-api';
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
      req.on('end', async () => {
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
        if (cancellation) {
          await replyWithCancellationTool(res, input, current);
          return;
        }
        const ready = reviewObservation
          ? catalog
            ? await prepareCatalogReviewObservationReply(current)
            : await prepareReviewObservationReply(current)
          : !observation || (await prepareObservationReply(current));
        if (scenario !== current || res.destroyed) return;
        if (!ready) {
          res.writeHead(503);
          res.end();
          return;
        }
        if (status) replyWithStatusTools(res, input, current);
        else if (catalog) replyWithCatalogTools(res, input, current);
        else replyWithSelectedTool(res, input, current);
      });
    });
    server.on('connect', (_req, socket) => {
      receipt.rejectedProxyRequests++;
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    });
    server.on('connection', (socket) => {
      const deadline = setTimeout(
        () => socket.destroy(),
        observation || reviewObservation || cancellation ? 10000 : 3000,
      );
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
    if (cancellation) {
      await verifyCancellationRoute({
        owned,
        env,
        receipt,
        action,
        run,
        configPath,
        catalog,
        setScenario: (current) => {
          scenario = current;
        },
      });
      return;
    }
    if (status) {
      await verifyStatusRoute({
        owned,
        env,
        run,
        receipt,
        action,
        sentinel,
        policyPath,
        requestPath,
        configPath,
        catalog,
        observation,
        setScenario: (current) => {
          scenario = current;
        },
      });
      return;
    }
    if (catalog) {
      await verifyCatalogRoute({
        owned,
        repo,
        env,
        run,
        receipt,
        action,
        configPath,
        review,
        reviewObservation,
        setScenario: (current) => {
          scenario = current;
        },
      });
      return;
    }
    if (review) {
      await verifyReviewRoute({
        reviewObservation,
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
    await verifySelectedRoute({
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
        // Windows may briefly retain an empty fixture cwd after provider exit.
        // Retry the same owned boundary for at most three seconds; never force it.
        for (let attempt = 0; attempt < 30 && fs.existsSync(owned); attempt++) {
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
