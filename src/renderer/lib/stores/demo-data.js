/** @file Scenario engine for browser-only demo mode. Cycles through 4 threat phases. */
import { DEMO_AGENTS_POOL, DEMO_FILE_POOL, DEMO_DOMAIN_POOL, SCENARIOS } from './demo-pools.js';

/** @param {number} min @param {number} max @returns {number} */
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** @param {Array} arr @returns {any} */
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ═══ DI hooks for testing ═══
let _deps = { randInt, pick };

/** @param {Partial<typeof _deps>} overrides */
export function _setDepsForTest(overrides) {
  _deps = { ..._deps, ...overrides };
}
export function _resetDeps() {
  _deps = { randInt, pick };
}

// ═══ Exported builders ═══

/** @param {{activeAgents: Array, totalFiles: number, totalSensitive: number, monitoringStarted: number}} ctx */
export function buildStats({ activeAgents, totalFiles, totalSensitive, monitoringStarted }) {
  return {
    totalFiles,
    totalSensitive,
    aiSensitive: Math.round(totalSensitive * 0.85),
    uptimeMs: Date.now() - monitoringStarted,
    monitoringStarted,
    peakAgents: 5,
    currentAgents: activeAgents.length,
    aiAgentCount: activeAgents.filter((a) => a.category === 'ai').length,
    otherAgentCount: activeAgents.filter((a) => a.category !== 'ai').length,
    uniqueAgents: activeAgents.map((a) => a.agent),
  };
}

/** @param {{activeAgents: Array, scenario: {name: string}}} ctx @returns {Record<string, number>} */
export function buildAnomalies({ activeAgents, scenario }) {
  const base = { calm: 8, elevated: 35, critical: 68, reset: 4 }[scenario.name];
  const result = {};
  activeAgents.forEach((a, i) => {
    result[a.agent] = Math.min(100, base + _deps.randInt(-8, 8) + i * 4);
  });
  return result;
}

// ═══ Main engine ═══

/** Starts demo mode scenario engine. Populates stores with simulated data. @returns {() => void} cleanup */
export function startDemoMode({ agents, events, stats, network, anomalies, resourceUsage }) {
  const intervals = [];
  let scenarioIndex = 0;
  let totalFiles = 142;
  let totalSensitive = 11;
  const monitoringStarted = Date.now() - 1000 * 60 * 14;

  function currentScenario() {
    return SCENARIOS[scenarioIndex];
  }

  function activeAgents() {
    return DEMO_AGENTS_POOL.slice(0, currentScenario().agentCount);
  }

  // Seed initial state immediately
  agents.set(activeAgents());
  stats.set(
    buildStats({ activeAgents: activeAgents(), totalFiles, totalSensitive, monitoringStarted }),
  );
  anomalies.set(buildAnomalies({ activeAgents: activeAgents(), scenario: currentScenario() }));
  resourceUsage.set({ memMB: 148, heapMB: 102, cpuUser: 31200, cpuSystem: 8400 });

  // Scenario ticker — advances phase every scenario.duration ms
  function advanceScenario() {
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

  // File event emitter — every 2-4s
  intervals.push(
    setInterval(
      () => {
        const scenario = currentScenario();
        const active = activeAgents();
        const isSensitive = Math.random() < scenario.sensitiveWeight;
        const pool = isSensitive
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
            parentEditor: agent.parentEditor,
            cwd: agent.cwd,
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
        const domainPool = useFlagged
          ? DEMO_DOMAIN_POOL.filter((d) => d.flagged)
          : DEMO_DOMAIN_POOL.filter((d) => !d.flagged);
        const conn = _deps.pick(domainPool.length ? domainPool : DEMO_DOMAIN_POOL);
        const agent = _deps.pick(active);

        network.update((arr) => [
          ...arr.slice(-499),
          {
            agent: agent.agent,
            pid: agent.pid,
            parentEditor: agent.parentEditor,
            cwd: agent.cwd,
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
        buildStats({ activeAgents: activeAgents(), totalFiles, totalSensitive, monitoringStarted }),
      );
    }, 10000),
  );

  // Anomaly scores — every 15s
  intervals.push(
    setInterval(() => {
      anomalies.set(buildAnomalies({ activeAgents: activeAgents(), scenario: currentScenario() }));
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

  return () => {
    clearTimeout(scenarioTimer);
    intervals.forEach(clearInterval);
  };
}
