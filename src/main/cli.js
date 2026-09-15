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
  --inventory-json <directory>  Inventory project components without executing them
  --inventory-profile-json <profile> <directory>  Inventory one explicit profile directory
    Profiles: user-home, codex-user, claude-user, cursor-user, vscode-user,
              claude-managed, codex-managed
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
