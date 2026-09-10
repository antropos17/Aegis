import { buildInstanceKey } from '../../../src/shared/instance-key.js';
import database from '../../../src/shared/agent-database.json';
import type { Host, RecordData } from '../runtime/host';

/** Isolated fixture bridge; never calls the real preload.
 * @returns Simulated capabilities @since 0.14.1
 */
export function createPreviewHost(): Host {
  const listeners = new Map<string, (value: unknown) => void>();
  const started = Date.now();
  const agents = ['Claude Code', 'Codex', 'Cursor', 'Ollama'].map((name, index) => ({
    agent: name,
    process: `${name.toLowerCase().replaceAll(' ', '-')}.exe`,
    pid: 10000 + index,
    instanceId: `demo:observatory:${index}`,
    instanceIdSource: 'os',
    status: 'running',
    category: 'cli-tool',
    cwd: `X:/Preview/project-${index + 1}`,
    projectName: `project-${index + 1}`,
  }));
  const events = Array.from({ length: 48 }, (_, index) => ({
    agent: agents[index % 4].agent,
    pid: agents[index % 4].pid,
    instanceId: agents[index % 4].instanceId,
    file: `X:/Preview/project-${(index % 4) + 1}/${index % 5 ? 'src/main.ts' : '.env'}`,
    action: 'modified',
    source: 'chokidar-write',
    timestamp: started - index * 5000,
    sensitive: index % 5 === 0,
    reason: index % 5 === 0 ? 'Sensitive configuration' : 'Project file',
    attribution: { status: 'inferred', evidence: ['cwd-containment'] },
  }));
  const network = agents.map((a, i) => ({
    agent: a.agent,
    pid: a.pid,
    instanceId: a.instanceId,
    domain: `service-${i}.example.test`,
    remoteIp: `192.0.2.${i + 1}`,
    remotePort: 443,
    state: 'Established',
    verdict: 'unknown',
    attribution: { status: 'confirmed', evidence: ['os-tcp-owner-pid'] },
  }));
  let settings: RecordData = {
    darkMode: true,
    uiScale: 1,
    scanIntervalSec: 10,
    notificationsEnabled: true,
    ignoreCommonBuildDirs: true,
    customSensitivePatterns: [],
    ignoredDirectories: [],
  };
  let permissions: RecordData = {};
  let custom: RecordData[] = [];
  let timer: ReturnType<typeof setInterval> | undefined;
  const stats = () => ({
    totalFiles: events.length,
    aiSensitive: events.filter((e) => e.sensitive).length,
    currentAgents: agents.length,
    appHealth: {
      state: 'HEALTHY',
      populationState: 'HEALTHY',
      populationReliable: true,
      identityDegraded: false,
      sensors: { byId: { preview: { state: 'SIMULATED', message: 'No real sensors connected' } } },
    },
    observationGap: { state: 'NONE' },
  });
  const emit = () => {
    listeners.get('onScanBatch')?.({
      agents,
      stats: stats(),
      resourceUsage: { memMB: 142, heapMB: 68, cpuUser: 10000, cpuSystem: 5000 },
      anomalyScoresByInstance: { 'demo:observatory:0': 52 },
    });
    listeners.get('onAgentResourceUsage')?.(
      agents.map((a, i) => ({
        instanceId: a.instanceId,
        pid: a.pid,
        cpu: Math.round((Math.sin((Date.now() - started) / 4000 + i) + 1.5) * 30) / 10,
        memMb: 160 + i * 140,
        gpu: null,
      })),
    );
    listeners.get('onTokenCosts')?.(
      agents.slice(0, 2).map((a) => ({
        instanceId: a.instanceId,
        pid: a.pid,
        totalTokens: 4800,
        costUsd: 0.12,
        estimated: true,
      })),
    );
  };
  const unavailable = async () => ({
    success: false,
    error: 'Preview only: no OS, persistent export or provider action was performed',
  });
  const host: Record<string, (...args: unknown[]) => unknown> = {
    getStats: async () => stats(),
    getResourceUsage: async () => ({ memMB: 142, heapMB: 68 }),
    getFalsePositives: async () => [],
    getAppVersion: async () => 'Preview',
    getSettings: async () => structuredClone(settings),
    saveSettings: async (value, options = {}) => {
      if (
        !options ||
        typeof options !== 'object' ||
        Array.isArray(options) ||
        Reflect.ownKeys(options).some(
          (key) =>
            !['patch', 'clearAnthropicApiKey'].includes(String(key)) ||
            typeof Reflect.get(options, key) !== 'boolean',
        )
      )
        return { success: false, error: 'Invalid settings save options' };
      const safe = structuredClone(value as RecordData);
      delete safe.anthropicApiKey;
      settings = { ...((options as RecordData).patch ? settings : {}), ...safe };
      return { success: true };
    },
    getAgentDatabase: async () => database,
    getCustomAgents: async () => custom,
    saveCustomAgents: async (value) => {
      custom = value as RecordData[];
      return { success: true };
    },
    getAllPermissions: async () => ({ permissions, instancePermissions: {} }),
    saveAgentPermissions: async (value) => {
      permissions = value as RecordData;
      return { success: true };
    },
    saveInstancePermissions: async (value) => {
      const data = value as {
        agentName: string;
        parentEditor?: string | null;
        cwd?: string | null;
        permissions: RecordData;
      };
      const key = buildInstanceKey(data.agentName, data.parentEditor, data.cwd);
      permissions = { ...permissions, [key]: structuredClone(data.permissions) };
      return { success: true };
    },
    resetPermissionsToDefaults: async () => {
      permissions = {};
      return { permissions: {} };
    },
    getRules: async () => [
      {
        id: 'preview-rule',
        name: 'Simulated credential observation',
        category: 'sensitive',
        risk: 'high',
        enabled: true,
      },
    ],
    reloadRules: async () => ({ success: true }),
    getAuditStats: async () => ({
      totalEntries: 0,
      persistedEntries: 0,
      droppedEntries: 0,
      bufferDepth: 0,
    }),
    getAuditEntriesBefore: async () => [],
    getUpdateStatus: async () => ({
      status: 'unsupported',
      notes: 'Preview does not update the desktop app',
    }),
    blocklistList: async () => [],
  };
  for (const name of [
    'exportLog',
    'exportCsv',
    'generateReport',
    'exportZip',
    'exportFullAudit',
    'openAuditLogDir',
    'exportAgentDatabase',
    'importAgentDatabase',
    'analyzeSession',
    'analyzeAgent',
    'openThreatReport',
    'killProcess',
    'suspendProcess',
    'resumeProcess',
    'blocklistAdd',
    'blocklistRemove',
    'addFalsePositive',
    'revealInExplorer',
    'openExternalUrl',
    'testNotification',
    'importConfig',
    'exportConfig',
    'checkForUpdates',
    'downloadUpdate',
    'installUpdate',
  ])
    host[name] = unavailable;
  for (const name of [
    'onScanBatch',
    'onStatsUpdate',
    'onFileAccess',
    'onNetworkUpdate',
    'onScanStatus',
    'onAgentResourceUsage',
    'onTokenCosts',
    'onToggleTheme',
    'onRulesReloaded',
    'onUpdateStatus',
  ])
    host[name] = (callback) => {
      listeners.set(name, callback as (value: unknown) => void);
      if (name === 'onScanBatch') {
        queueMicrotask(emit);
        timer = setInterval(emit, 2500);
      }
      if (name === 'onFileAccess') queueMicrotask(() => listeners.get(name)?.(events));
      if (name === 'onNetworkUpdate') queueMicrotask(() => listeners.get(name)?.(network));
      return () => {
        listeners.delete(name);
        if (name === 'onScanBatch') clearInterval(timer);
      };
    };
  return host as Host;
}
