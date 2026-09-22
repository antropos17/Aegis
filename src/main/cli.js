/**
 * @file cli.js
 * @description CLI interface for process scans and static project inventories.
 *   Returns null when no CLI flag matched (GUI mode).
 * @since v0.4.0
 */
'use strict';

const path = require('path');
const fs = require('fs');

const USAGE = `AEGIS — Independent AI Oversight Layer

Usage:  aegis [options]

Options:
  --mcp-gateway-http <endpoint.json> <manifest.json>  Gate one explicit loopback HTTP MCP session
  --mcp-gateway-stdio <policy.json> <request.json> <manifest.json>  Gate one selected MCP server with exact one-use tool grants
  --action-mcp-config-json <mode> <paths...> [--observe <new-endpoint>]  Export MCP configuration; observation for selected/catalog owners
    Modes: selected <policy> <request>, catalog <manifest>, relay <endpoint>; no installation or validation of files
  --action-mcp-catalog-stdio <catalog.json>  Serve up to eight operator-selected actions through MCP
  --action-mcp-catalog-review <catalog.json> <new-endpoint.json>  Confirm catalog MCP actions in this terminal
  --action-route-check-json <route> <policy.json> <request.json>  Check a selected route without execution
    Routes: direct, terminal, mcp-stdio, mcp-review (this check grants no permission)
  --action-catalog-check-json <route> <catalog.json>  Check all selected catalog actions without execution
    Routes: mcp-stdio, mcp-review (this check grants no permission)
  --action-mcp-review <policy.json> <request.json> <new-endpoint.json>  Confirm MCP actions in this terminal
  --action-mcp-connect <endpoint.json>  Connect an MCP client to an operator review terminal
  --action-mcp-stdio <policy.json> <request.json>  Serve one selected action through finite MCP stdio
    MCP stdio/review routes accept: --observe <new-private-endpoint.json> (read-only desktop observation)
  --action-exec-confirm <policy.json> <request.json>  Review exact action in a terminal and confirm one launch
  --action-exec-json <policy.json> <request.json>  Run one explicit executable request under local policy
  --action-policy-hook <policy.json>  Experimental Claude PreToolUse Bash decision hook
  --handoff-listen-json claude-code <port> <seconds>  Observe live hooks on loopback (opt-in)
  --handoff-send  Forward one hook from stdin using AEGIS_HANDOFF_PORT/TOKEN
  --handoff-import-json claude-code <events.jsonl>  Import unverified subagent lifecycle metadata
  --static-import-json <adapter> <directory> <format> <report> [--baseline <prior-scan>]
    Formats: cisco-skill-json, cisco-skill-sarif, cisco-mcp-json (explicit offline inputs)
  --static-scan-json <adapter> <directory>  Review literal commands and agent/package settings
    Static adapter: package (whole directory), project, or any profile below
  --inventory-json <directory>  Inventory project components without executing them
  --inventory-profile-json <profile> <directory>  Inventory one explicit profile directory
    Profiles: user-home, codex-user, claude-user, cursor-user, vscode-user,
              claude-managed, codex-managed
  --inventory-snapshot-json <adapter> <directory> <new-file>  Save an unreviewed snapshot
  --inventory-accept-json <snapshot> <digest> <directory> <new-file>  Accept reviewed unchanged content
  --inventory-diff-json <snapshot> <adapter> <directory>  Compare a fresh capture
    Snapshot adapter: project or any profile above; optional --tools-file <tools-list.json>
  --scan-json   Run a single scan and output JSON to stdout
  --version     Print version and exit
  --help        Show this help message`.trim();

let _scanFn = null;
let _writeFn = null;

/** @internal For test injection */
function _setDepsForTest(overrides) {
  if (overrides.scanFn) _scanFn = overrides.scanFn;
  if (overrides.writeFn) _writeFn = overrides.writeFn;
}
/** @internal Reset to real deps */
function _resetForTest() {
  _scanFn = null;
  _writeFn = null;
}

function write(str) {
  if (_writeFn) return _writeFn(str);
  process.stdout.write(str + '\n');
}

function getVersion() {
  const pkgPath = path.join(__dirname, '..', '..', 'package.json');
  return JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version;
}

/** Run a single process scan + LLM detection. @returns {Promise<Object>} */
async function runScan() {
  if (_scanFn) return _scanFn();
  const scanner = require('./process-scanner');
  const procUtil = require('./process-utils');
  const { detectOllamaModels, detectLMStudioModels } = require('./llm-runtime-detector');
  scanner.init({ trackSeenAgent: () => {} });
  const result = await scanner.scanProcesses();
  await procUtil.enrichWithParentChains(result.agents);
  procUtil.annotateHostApps(result.agents);
  const [ollama, lmstudio] = await Promise.all([detectOllamaModels(), detectLMStudioModels()]);
  return {
    timestamp: new Date().toISOString(),
    agents: result.agents,
    localModels: { ollama, lmstudio },
  };
}

/**
 * Parse argv and handle CLI flags. Returns null if no CLI flag matched.
 * @param {string[]} [argv] @returns {Promise<null|number>} @since v0.4.0
 */
async function handleCLI(argv) {
  const args = argv || process.argv.slice(2);
  if (args.length === 0) return null;
  const flag = args[0];
  if (['--mcp-gateway-stdio', '--mcp-gateway-http'].includes(flag))
    return require('./mcp-gateway-cli').handleMcpGatewayCLI(args);
  if (
    [
      '--action-mcp-stdio',
      '--action-mcp-catalog-stdio',
      '--action-mcp-review',
      '--action-mcp-catalog-review',
    ].includes(flag) &&
    args.includes('--observe')
  ) {
    const review = flag.endsWith('-review');
    const run = review
      ? require('./action-mcp-review').handleActionMcpReview
      : require('./action-mcp-stdio').handleActionMcpStdio;
    return require('./action-observation-server').runObservedMcp(
      args,
      run,
      review ? 'mcp-review' : 'mcp-stdio',
    );
  }
  if (flag === '--action-mcp-config-json')
    return require('./action-mcp-config').handleActionMcpConfigCLI(args, write);
  if (flag === '--action-catalog-check-json')
    return require('./action-catalog-check').handleActionCatalogCheckCLI(args, write);
  if (flag === '--action-route-check-json')
    return require('./action-route-check').handleActionRouteCheckCLI(args, write);
  if (flag === '--action-mcp-review' || flag === '--action-mcp-catalog-review')
    return require('./action-mcp-review').handleActionMcpReview(args);
  if (flag === '--action-mcp-connect')
    return require('./action-mcp-connect').handleActionMcpConnect(args);
  if (flag === '--action-mcp-stdio' || flag === '--action-mcp-catalog-stdio')
    return require('./action-mcp-stdio').handleActionMcpStdio(args);
  if (flag === '--action-exec-json' || flag === '--action-exec-confirm')
    return require('./action-execution-cli').handleActionExecutionCLI(args, write);
  if (flag === '--action-policy-hook')
    return require('./action-policy-hook').handleActionPolicyHook(args, write);
  if (flag === '--handoff-listen-json' || flag === '--handoff-send')
    return require('./handoff-live-cli').handleHandoffLiveCLI(args, write);
  if (flag === '--handoff-import-json') {
    if (args.length !== 3 || args.slice(1).some((arg) => !arg || arg.startsWith('--'))) {
      write(JSON.stringify({ error: 'expected-handoff-import-arguments' }));
      return 1;
    }
    if (args[1] !== 'claude-code') {
      write(JSON.stringify({ error: 'handoff-adapter-unsupported' }));
      return 1;
    }
    try {
      const report = await require('./handoff-import').importHandoffEvents(args[1], args[2]);
      write(JSON.stringify(report, null, 2));
      return report.inputAvailable ? (report.complete ? 0 : 2) : 1;
    } catch (_) {
      write(JSON.stringify({ error: 'handoff-import-unavailable' }));
      return 1;
    }
  }
  if (flag === '--static-import-json') {
    return require('./static-import-cli').handleStaticImportCLI(args, write);
  }
  if (flag === '--static-scan-json') {
    return require('./static-analysis-cli').handleStaticAnalysisCLI(args, write);
  }
  if (require('./inventory-snapshot-cli').FLAGS.includes(flag)) {
    return require('./inventory-snapshot-cli').handleSnapshotCLI(args, write);
  }
  if (flag === '--inventory-profile-json') {
    if (args.length !== 3 || args.slice(1).some((arg) => !arg || arg.startsWith('--'))) {
      write(JSON.stringify({ error: 'expected-profile-and-directory' }));
      return 1;
    }
    try {
      const { inventoryProfile } = require('./agent-inventory');
      const data = await inventoryProfile(args[1], args[2]);
      write(JSON.stringify(data, null, 2));
      return data.complete ? 0 : 2;
    } catch (error) {
      write(
        JSON.stringify({
          error:
            error.message === 'unsupported-profile'
              ? 'unsupported-profile'
              : 'inventory-unavailable',
        }),
      );
      return 1;
    }
  }
  if (flag === '--inventory-json') {
    if (args.length !== 2 || !args[1] || args[1].startsWith('--')) {
      write(JSON.stringify({ error: 'expected-project-directory' }));
      return 1;
    }
    try {
      const { inventoryProject } = require('./agent-inventory');
      const data = await inventoryProject(args[1]);
      write(JSON.stringify(data, null, 2));
      return data.complete ? 0 : 2;
    } catch (_) {
      write(JSON.stringify({ error: 'inventory-unavailable' }));
      return 1;
    }
  }
  if (flag === '--version') {
    write(getVersion());
    return 0;
  }
  if (flag === '--help') {
    write(USAGE);
    return 0;
  }
  if (flag === '--scan-json') {
    const data = await runScan();
    write(JSON.stringify(data, null, 2));
    return 0;
  }
  write(`Unknown option: ${flag}\n`);
  write(USAGE);
  return 1;
}

module.exports = { handleCLI, _setDepsForTest, _resetForTest };
