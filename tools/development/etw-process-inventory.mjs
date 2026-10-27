import path from 'node:path';
import { spawn } from 'node:child_process';

export const INVENTORY_TOTAL_MS = 30000;
const CLOSE_RESERVE_MS = 2000;
const OUTPUT_BYTES = 65536;
const pid = (value) => Number.isSafeInteger(value) && value > 0 && value <= 0xffffffff;
const unique = (values) => [...new Set(values)].sort((a, b) => a - b);
const refuse = (code, closed = false) => {
  const error = new Error('Owned process inventory refused: ' + code);
  error.inventoryDiagnostic = { commandKind: 'owned-process-snapshot', code, childClosed: closed };
  return error;
};
function seeds(value) {
  if (
    !pid(value.rootPid) ||
    !Array.isArray(value.metricPids) ||
    value.metricPids.length > 100 ||
    !value.metricPids.every(pid) ||
    !Array.isArray(value.nativeIds) ||
    value.nativeIds.length > 4 ||
    !value.nativeIds.every(pid) ||
    !Array.isArray(value.originalPids) ||
    value.originalPids.length !== 5 ||
    new Set(value.originalPids).size !== 5 ||
    !value.originalPids.every(pid) ||
    !value.originalPids.includes(value.rootPid) ||
    !pid(value.custodianPid) ||
    value.originalPids.includes(value.custodianPid) ||
    !value.nativeIds.every((id) => id !== value.rootPid && value.originalPids.includes(id))
  )
    throw refuse('seed-shape');
  return value;
}

/** Reproduce the existing app-child and four-level helper graph from one snapshot.
 * No PID observation grants termination authority. @param {object[]} rows Fixed metadata rows.
 * @param {object} input Actual main, Electron metrics and authenticated native cohort.
 * @returns {object} Owned PID sets plus the exact permitted row projection. @since v0.20.1
 */
export function projectOwnedProcessInventory(rows, input) {
  seeds(input);
  if (
    !Array.isArray(rows) ||
    rows.length > 8192 ||
    rows.some(
      (row) =>
        !row ||
        Object.keys(row).length !== 3 ||
        !Object.hasOwn(row, 'pid') ||
        !Object.hasOwn(row, 'parentPid') ||
        !Object.hasOwn(row, 'native') ||
        !pid(row.pid) ||
        !Number.isSafeInteger(row.parentPid) ||
        row.parentPid < 0 ||
        row.parentPid > 0xffffffff ||
        typeof row.native !== 'boolean',
    ) ||
    new Set(rows.map((row) => row.pid)).size !== rows.length
  )
    throw refuse('snapshot-shape');
  const own = unique([
    input.rootPid,
    ...input.metricPids,
    ...rows.filter((row) => row.parentPid === input.rootPid).map((row) => row.pid),
  ]);
  const selected = new Set([...own, ...input.nativeIds]);
  const helpers = new Set(input.nativeIds);
  let parents = new Set(selected);
  for (let depth = 0; depth < 4 && parents.size; depth++) {
    const children = rows.filter((row) => parents.has(row.parentPid));
    for (const child of children) {
      selected.add(child.pid);
      if (child.native) helpers.add(child.pid);
    }
    parents = new Set(children.map((row) => row.pid));
  }
  if (unique([...own, ...helpers, ...input.originalPids, input.custodianPid]).length > 100)
    throw refuse('owned-pid-budget');
  return { own, helpers: unique([...helpers]), selectedPids: unique([...selected]) };
}

/** Build one fixed metadata query. Unrelated names/commands never leave the child.
 * @param {object} input Validated PID seeds. @returns {string} Inline PowerShell. @since v0.20.1
 */
export function inventoryPowerShell(input) {
  seeds(input);
  const array = (values) => '@(' + unique(values).join(',') + ')';
  return `$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue'
$rootPid=[uint32]${input.rootPid};$metrics=${array(input.metricPids)};$native=${array(input.nativeIds)}
$all=@(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,Name -OperationTimeoutSec 20)
if($all.Count -gt 8192){throw 'snapshot-budget'}
$own=[Collections.Generic.HashSet[uint32]]::new();[void]$own.Add($rootPid)
foreach($itemPid in $metrics){[void]$own.Add([uint32]$itemPid)}
foreach($row in $all){if($row.ParentProcessId -eq $rootPid){[void]$own.Add([uint32]$row.ProcessId)}}
$selected=[Collections.Generic.HashSet[uint32]]::new();foreach($itemPid in $own){[void]$selected.Add($itemPid)}
foreach($itemPid in $native){[void]$selected.Add([uint32]$itemPid)}
$parents=[Collections.Generic.HashSet[uint32]]::new();foreach($itemPid in $selected){[void]$parents.Add($itemPid)}
for($depth=0;$depth -lt 4 -and $parents.Count;$depth++){
  $next=[Collections.Generic.HashSet[uint32]]::new()
  foreach($row in $all){if($parents.Contains([uint32]$row.ParentProcessId)){[void]$selected.Add([uint32]$row.ProcessId);[void]$next.Add([uint32]$row.ProcessId)}}
  $parents=$next
}
$rows=@(foreach($row in $all){if($selected.Contains([uint32]$row.ProcessId)){[pscustomobject]@{pid=[long]$row.ProcessId;parentPid=[long]$row.ParentProcessId;native=($row.Name -ieq 'EtwFile.exe')}}})
if($rows.Count -gt 100){throw 'owned-projection-budget'}
[pscustomobject]@{schema=1;rootPid=[long]$rootPid;rows=$rows}|ConvertTo-Json -Depth 4 -Compress
`;
}

/** Take one async inventory within 30 seconds total, including original-child closure.
 * Two seconds are reserved for closure; timeout/denial/output failure stays unknown.
 * @param {object} options Actual app/custody/environment and optional controlled child seam.
 * @returns {Promise<object>} Strict observed PID sets; never a failure-as-empty fallback.
 * @since v0.20.1
 */
export async function captureDurableProcessInventory({
  app,
  rootPid,
  nativeIds,
  originalPids,
  custodianPid,
  env,
  spawnProcess = spawn,
}) {
  const deadline = Date.now() + INVENTORY_TOTAL_MS;
  let metricsTimer;
  let metricPids;
  try {
    metricPids = await Promise.race([
      app.evaluate(({ app: actual }) => actual.getAppMetrics().map((row) => row.pid)),
      new Promise((_, reject) => {
        metricsTimer = setTimeout(
          () => reject(refuse('metrics-timeout')),
          INVENTORY_TOTAL_MS - CLOSE_RESERVE_MS,
        );
      }),
    ]);
  } catch (error) {
    throw error.inventoryDiagnostic ? error : refuse('metrics-refused');
  } finally {
    clearTimeout(metricsTimer);
  }
  const input = seeds({ rootPid, metricPids, nativeIds, originalPids, custodianPid });
  const systemRoot = env.SystemRoot ?? env.SYSTEMROOT ?? env.WINDIR;
  if (
    typeof systemRoot !== 'string' ||
    !path.win32.isAbsolute(systemRoot) ||
    typeof env.TEMP !== 'string' ||
    !(path.isAbsolute(env.TEMP) || path.win32.isAbsolute(env.TEMP))
  )
    throw refuse('environment-shape');
  const available = deadline - Date.now();
  if (available <= CLOSE_RESERVE_MS) throw refuse('metrics-timeout');
  const script = inventoryPowerShell(input);
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const environment = { ...env };
  for (const key of Object.keys(environment))
    if (key.toLowerCase() === 'psmodulepath') delete environment[key];
  environment.PSModulePath = path.win32.join(systemRoot, 'System32/WindowsPowerShell/v1.0/Modules');
  return new Promise((resolve, reject) => {
    let child,
      settled = false,
      failure = null,
      stdoutBytes = 0;
    const chunks = [];
    let queryTimer, totalTimer;
    const finish = (code, signal, closed) => {
      if (settled) return;
      settled = true;
      clearTimeout(queryTimer);
      clearTimeout(totalTimer);
      if (failure || !closed || code !== 0 || signal) {
        reject(refuse(failure ?? 'exit-refused', closed));
        return;
      }
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
        const value = JSON.parse(text.replace(/^\uFEFF/, '').trim());
        if (
          !value ||
          Object.keys(value).length !== 3 ||
          value.schema !== 1 ||
          value.rootPid !== rootPid ||
          !Array.isArray(value.rows) ||
          value.rows.length > 100
        )
          throw refuse('projection-shape', true);
        const projected = projectOwnedProcessInventory(value.rows, input);
        if (
          !value.rows.some((row) => row.pid === rootPid) ||
          value.rows.some((row) => !projected.selectedPids.includes(row.pid))
        )
          throw refuse('foreign-projection', true);
        resolve({ own: projected.own, helpers: projected.helpers });
      } catch (error) {
        reject(refuse(error.inventoryDiagnostic?.code ?? 'projection-shape', true));
      }
    };
    const stop = (code) => {
      if (settled || failure) return;
      failure = code;
      try {
        child?.kill();
      } catch {
        /* Original child only; failure remains unknown. */
      }
    };
    try {
      child = spawnProcess(
        path.win32.join(systemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
        ['-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-EncodedCommand', encoded],
        {
          env: environment,
          cwd: env.TEMP,
          windowsHide: true,
          shell: false,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      child.stdout.on('data', (chunk) => {
        if (settled || failure) return;
        const bytes = Buffer.from(chunk);
        stdoutBytes += bytes.length;
        if (stdoutBytes > OUTPUT_BYTES) {
          stop('output-budget');
          return;
        }
        chunks.push(bytes);
      });
      child.stderr.on('data', (chunk) => {
        if (chunk.length) stop('stderr-output');
      });
      child.once('error', () => {
        stop('spawn-refused');
      });
      child.once('close', (code, signal) => finish(code, signal, true));
      queryTimer = setTimeout(() => stop('timeout'), available - CLOSE_RESERVE_MS);
      totalTimer = setTimeout(() => {
        stop('timeout');
        child.stdout.destroy();
        child.stderr.destroy();
        child.unref();
        finish(null, null, false);
      }, available);
    } catch {
      failure = 'spawn-refused';
      finish(null, null, false);
    }
  });
}
