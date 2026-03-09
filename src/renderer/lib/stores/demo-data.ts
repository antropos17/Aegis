/** @file Scenario engine for browser-only demo mode. Cycles through 4 threat phases. */
import type { Writable } from 'svelte/store';
import { DEMO_AGENTS_POOL, DEMO_FILE_POOL, DEMO_DOMAIN_POOL, SCENARIOS } from './demo-pools.js';
import type {
  DemoAgent,
  DemoFileTemplate,
  DemoDomainTemplate,
  DemoScenario,
} from './demo-pools.js';

/** Stats object produced by buildStats.
 *  Index signature allows assignment to Record<string, unknown> stores. */
export interface DemoStats {
  readonly [key: string]: unknown;
  readonly totalFiles: number;
  readonly totalSensitive: number;
  readonly aiSensitive: number;
  readonly uptimeMs: number;
  readonly monitoringStarted: number;
  readonly peakAgents: number;
  readonly currentAgents: number;
  readonly aiAgentCount: number;
  readonly otherAgentCount: number;
  readonly uniqueAgents: readonly string[];
}

/** Resource usage snapshot */
export interface DemoResourceUsage {
  readonly memMB: number;
  readonly heapMB: number;
  readonly cpuUser: number;
  readonly cpuSystem: number;
}

/** File event emitted by the demo engine */
export interface DemoFileEvent {
  readonly agent: string;
  readonly pid: number;
  readonly parentEditor: string | null;
  readonly cwd: string | null;
  readonly file: string;
  readonly sensitive: boolean;
  readonly selfAccess: boolean;
  readonly reason: string;
  readonly action: string;
  readonly timestamp: number;
  readonly category: string;
}

/** Network event emitted by the demo engine */
export interface DemoNetworkEvent {
  readonly agent: string;
  readonly pid: number;
  readonly parentEditor: string | null;
  readonly cwd: string | null;
  readonly category: string;
  readonly remoteIp: string;
  readonly remotePort: number;
  readonly domain: string;
  readonly state: string;
  readonly flagged: boolean;
}

/** Minimal writable — only needs set/update, avoids generic variance issues */
interface Settable<T> {
  set(value: T): void;
  update(updater: (value: T) => T): void;
}

/** Store bag passed to startDemoMode.
 *  Uses Settable to avoid Writable generic variance conflicts with ipc.ts stores. */
export interface DemoStores {
  readonly agents: Settable<DemoAgent[]>;
  readonly events: Settable<DemoFileEvent[]>;
  readonly stats: Settable<Record<string, unknown>>;
  readonly network: Settable<DemoNetworkEvent[]>;
  readonly anomalies: Settable<Record<string, number>>;
  readonly resourceUsage: Settable<Record<string, unknown>>;
}

/** Context for buildStats */
interface BuildStatsCtx {
  readonly activeAgents: ReadonlyArray<Pick<DemoAgent, 'agent' | 'category'>>;
  readonly totalFiles: number;
  readonly totalSensitive: number;
  readonly monitoringStarted: number;
}

/** Context for buildAnomalies */
interface BuildAnomaliesCtx {
  readonly activeAgents: ReadonlyArray<Pick<DemoAgent, 'agent'>>;
  readonly scenario: Pick<DemoScenario, 'name'>;
}

/** DI dependency bag shape */
interface DemoDeps {
  randInt: (min: number, max: number) => number;
  pick: <T>(arr: readonly T[]) => T;
}

/** @param min inclusive lower bound @param max inclusive upper bound */
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** @param arr non-empty array */
function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ═══ DI hooks for testing ═══
let _deps: DemoDeps = { randInt, pick };

/** Replace dependency functions for testing */
export function _setDepsForTest(overrides: Partial<DemoDeps>): void {
  _deps = { ..._deps, ...overrides };
}

/** Reset dependencies to originals */
export function _resetDeps(): void {
  _deps = { randInt, pick };
}

// ═══ Exported builders ═══

/** Build a stats snapshot from current demo state */
export function buildStats({
  activeAgents,
  totalFiles,
  totalSensitive,
  monitoringStarted,
}: BuildStatsCtx): DemoStats {
  return {
    totalFiles,
    totalSensitive,
    aiSensitive: Math.round(totalSensitive * 0.85),
    uptimeMs: Date.now() - monitoringStarted,
    monitoringStarted,
    peakAgents: 12,
    currentAgents: activeAgents.length,
    aiAgentCount: activeAgents.filter((a) => a.category === 'ai').length,
    otherAgentCount: activeAgents.filter((a) => a.category !== 'ai').length,
    uniqueAgents: activeAgents.map((a) => a.agent),
  };
}

/** Anomaly base scores per scenario phase */
const ANOMALY_BASE: Record<DemoScenario['name'], number> = {
  calm: 8,
  elevated: 35,
  critical: 68,
  reset: 4,
};

/** Build anomaly score map from current demo state */
export function buildAnomalies({
  activeAgents,
  scenario,
}: BuildAnomaliesCtx): Record<string, number> {
  const base = ANOMALY_BASE[scenario.name];
  const result: Record<string, number> = {};
  activeAgents.forEach((a, i) => {
    result[a.agent] = Math.min(100, base + _deps.randInt(-8, 8) + i * 4);
  });
  return result;
}

// ═══ Main engine ═══

/** Starts demo mode scenario engine. Populates stores with simulated data. @returns cleanup function */
export function startDemoMode({
  agents,
  events,
  stats,
  network,
  anomalies,
  resourceUsage,
}: DemoStores): () => void {
  const intervals: ReturnType<typeof setInterval>[] = [];
  let scenarioIndex = 0;
  let totalFiles = 142;
  let totalSensitive = 11;
  const monitoringStarted = Date.now() - 1000 * 60 * 14;

  function currentScenario(): DemoScenario {
    return SCENARIOS[scenarioIndex];
  }

  function activeAgents(): DemoAgent[] {
    return DEMO_AGENTS_POOL.slice(0, currentScenario().agentCount) as DemoAgent[];
  }

  // Seed initial state — stagger across frames to avoid reactivity cascade
  const raf: (fn: () => void) => void =
    typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn) => setTimeout(fn, 0);
  agents.set(activeAgents());
  raf(() => {
    stats.set(
      buildStats({ activeAgents: activeAgents(), totalFiles, totalSensitive, monitoringStarted }),
    );
    resourceUsage.set({ memMB: 148, heapMB: 102, cpuUser: 31200, cpuSystem: 8400 });
    raf(() => {
      anomalies.set(buildAnomalies({ activeAgents: activeAgents(), scenario: currentScenario() }));
    });
  });

  // Scenario ticker — advances phase every scenario.duration ms
  function advanceScenario(): void {
    scenarioIndex = (scenarioIndex + 1) % SCENARIOS.length;
    agents.set(activeAgents());
    if (currentScenario().name === 'reset') {
      totalFiles = 142;
      totalSensitive = 11;
    }
    stats.set(
      buildStats({ activeAgents: activeAgents(), totalFiles, totalSensitive, monitoringStarted }),
    );
    anomalies.set(buildAnomalies({ activeAgents: activeAgents(), scenario: currentScenario() }));
  }
  let scenarioTimer = setTimeout(function tick() {
    advanceScenario();
    scenarioTimer = setTimeout(tick, currentScenario().duration);
  }, currentScenario().duration);

  // Delay data emitters so UI renders first
  const emitterDelay = setTimeout(() => {
    // File event emitter — every 2-4s
    intervals.push(
      setInterval(
        () => {
          const scenario = currentScenario();
          const active = activeAgents();
          const isSensitive = Math.random() < scenario.sensitiveWeight;
          const pool: readonly DemoFileTemplate[] = isSensitive
            ? DEMO_FILE_POOL.filter((f) => f.sensitive)
            : DEMO_FILE_POOL.filter((f) => !f.sensitive);
          const template = _deps.pick(pool.length ? pool : DEMO_FILE_POOL);
          const agent = _deps.pick(active);

          totalFiles++;
          if (template.sensitive) totalSensitive++;

          events.update((arr) => [
            ...arr.slice(-499),
            {
              agent: agent.agent,
              pid: agent.pid,
              parentEditor: agent.parentEditor ?? null,
              cwd: agent.cwd ?? null,
              file: template.file,
              sensitive: template.sensitive,
              selfAccess: template.selfAccess,
              reason: template.reason,
              action: template.action,
              timestamp: Date.now(),
              category: agent.category,
            },
          ]);
        },
        _deps.randInt(2000, 4000),
      ),
    );

    // Network update emitter — every 5-8s
    intervals.push(
      setInterval(
        () => {
          const scenario = currentScenario();
          const active = activeAgents();
          const useFlagged = scenario.name === 'critical' && Math.random() < 0.4;
          const domainPool: readonly DemoDomainTemplate[] = useFlagged
            ? DEMO_DOMAIN_POOL.filter((d) => d.flagged)
            : DEMO_DOMAIN_POOL.filter((d) => !d.flagged);
          const conn = _deps.pick(domainPool.length ? domainPool : DEMO_DOMAIN_POOL);
          const agent = _deps.pick(active);

          network.update((arr) => [
            ...arr.slice(-499),
            {
              agent: agent.agent,
              pid: agent.pid,
              parentEditor: agent.parentEditor ?? null,
              cwd: agent.cwd ?? null,
              category: agent.category,
              remoteIp: conn.remoteIp,
              remotePort: conn.remotePort,
              domain: conn.domain,
              state: conn.state,
              flagged: conn.flagged,
            },
          ]);
        },
        _deps.randInt(5000, 8000),
      ),
    );

    // Stats update — every 10s
    intervals.push(
      setInterval(() => {
        stats.set(
          buildStats({
            activeAgents: activeAgents(),
            totalFiles,
            totalSensitive,
            monitoringStarted,
          }),
        );
      }, 10000),
    );

    // Anomaly scores — every 15s
    intervals.push(
      setInterval(() => {
        anomalies.set(
          buildAnomalies({ activeAgents: activeAgents(), scenario: currentScenario() }),
        );
      }, 15000),
    );

    // Resource usage — every 5s
    intervals.push(
      setInterval(() => {
        resourceUsage.set({
          memMB: _deps.randInt(120, 180),
          heapMB: _deps.randInt(80, 130),
          cpuUser: _deps.randInt(18000, 52000),
          cpuSystem: _deps.randInt(4000, 14000),
        });
      }, 5000),
    );
  }, 2000);

  return () => {
    clearTimeout(scenarioTimer);
    clearTimeout(emitterDelay);
    intervals.forEach(clearInterval);
  };
}
