/**
 * @file process-utils.js
 * @module main/process-utils
 * @description Parent-chain resolution via PowerShell and editor host app
 *   annotation for detected AI agent processes.
 * @requires child_process
 * @author AEGIS Contributors
 * @license MIT
 * @version 0.2.0
 */
'use strict';

const { execFile } = require('child_process');

const parentChainCache = new Map();
const PARENT_CHAIN_TTL = 60000;

/**
 * Resolve parent process chains for a list of PIDs via a single PowerShell call.
 * @param {number[]} pids
 * @returns {Promise<Map<number, string[]>>} pid to parent-name chain
 * @since v0.1.0
 */
function getParentChains(pids) {
  return new Promise((resolve) => {
    if (pids.length === 0) { resolve(new Map()); return; }
    const now = Date.now();
    const needLookup = pids.filter(pid => {
      const cached = parentChainCache.get(pid);
      return !cached || now - cached.timestamp > PARENT_CHAIN_TTL;
    });
    if (needLookup.length === 0) {
      const result = new Map();
      for (const pid of pids) {
        const cached = parentChainCache.get(pid);
        if (cached) result.set(pid, cached.chain);
      }
      resolve(result);
      return;
    }
    const psScript = [
      '$ErrorActionPreference="SilentlyContinue"',
      '$procs=@{}',
      'Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name|ForEach-Object{$procs[[int]$_.ProcessId]=@{n=$_.Name;p=[int]$_.ParentProcessId}}',
      '$r=@{}',
      `$pids=@(${needLookup.join(',')})`,
      'foreach($pid in $pids){',
      '  $chain=@()',
      '  $cur=$pid',
      '  $seen=@{}',
      '  for($i=0;$i -lt 6;$i++){',
      '    if(-not $procs.ContainsKey($cur)){break}',
      '    $pp=$procs[$cur].p',
      '    if($pp -le 0 -or $pp -eq $cur -or $seen.ContainsKey($pp)){break}',
      '    $seen[$pp]=$true',
      '    if($procs.ContainsKey($pp)){$chain+=$procs[$pp].n}else{break}',
      '    $cur=$pp',
      '  }',
      '  $r["$pid"]=$chain',
      '}',
      '$r|ConvertTo-Json -Compress',
    ].join('\n');
    execFile('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command', psScript,
    ], { timeout: 8000 }, (err, stdout) => {
      const result = new Map();
      for (const pid of pids) {
        const cached = parentChainCache.get(pid);
        if (cached) result.set(pid, cached.chain);
      }
      if (!err && stdout.trim()) {
        try {
          const parsed = JSON.parse(stdout.trim());
          for (const pid of needLookup) {
            let chain = parsed[String(pid)];
            if (typeof chain === 'string') chain = [chain];
            if (!Array.isArray(chain)) chain = [];
            parentChainCache.set(pid, { chain, timestamp: now });
            result.set(pid, chain);
          }
        } catch (_) {}
      }
      resolve(result);
    });
  });
}

/**
 * Attach parent-chain arrays to each agent object.
 * @param {Array} agents
 * @returns {Promise<void>}
 * @since v0.1.0
 */
async function enrichWithParentChains(agents) {
  if (agents.length === 0) return;
  const pids = agents.map(a => a.pid);
  const chains = await getParentChains(pids);
  for (const a of agents) {
    a.parentChain = chains.get(a.pid) || [];
  }
}

/** Map editor host exe names to human-readable labels */
const EDITOR_LABELS = {
  'code.exe': 'VS Code',
  'code': 'VS Code',
  'code - insiders.exe': 'VS Code Insiders',
  'idea64.exe': 'IntelliJ IDEA',
  'idea': 'IntelliJ IDEA',
  'webstorm64.exe': 'WebStorm',
  'webstorm': 'WebStorm',
  'pycharm64.exe': 'PyCharm',
  'pycharm': 'PyCharm',
  'goland64.exe': 'GoLand',
  'goland': 'GoLand',
  'rider64.exe': 'Rider',
  'rider': 'Rider',
  'phpstorm64.exe': 'PhpStorm',
  'phpstorm': 'PhpStorm',
  'rubymine64.exe': 'RubyMine',
  'rubymine': 'RubyMine',
  'clion64.exe': 'CLion',
  'clion': 'CLion',
  'datagrip64.exe': 'DataGrip',
  'datagrip': 'DataGrip',
};

/**
 * Annotate agents whose parentChain includes an editor host.
 * Sets displayLabel = "AgentName (via EditorName)" and parentEditor field.
 * @param {Array} agents
 * @returns {void}
 * @since v0.2.0
 */
function annotateHostApps(agents) {
  for (const a of agents) {
    if (!a.parentChain || a.parentChain.length === 0) continue;
    for (const p of a.parentChain) {
      const label = EDITOR_LABELS[p.toLowerCase()];
      if (label) {
        a.parentEditor = label;
        a.displayLabel = `${a.agent} (via ${label})`;
        break;
      }
    }
  }
}

module.exports = { getParentChains, enrichWithParentChains, annotateHostApps };
