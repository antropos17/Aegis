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

// ═══ Provenance marker ═══

/**
 * Key stamped onto every payload this engine writes into a store.
 *
 * The renderer previously told demo from real only by `isDemoMode` (stores/ipc.ts) —
 * a build-time constant sitting BESIDE the data, never on it. A fabricated agent
 * record and a scanned one were byte-identical in shape, so no consumer and no test
 * could establish provenance from a payload alone. This key closes that: the claim
 * "this is simulated" now travels with the value it describes.
 *
 * Not stamped on the anomalies payload — that store is a bare `Record<agentName,
 * number>` (see ipc.ts `anomalies`), so a marker key would be indistinguishable from
 * an agent literally named `_demo`. Anomalies are only ever written alongside a
 * marked `stats` object, which is what {@link isDemoPayload} is read from instead.
 */
export const DEMO_MARK = '_demo';

/**
 * True when a payload carries the demo provenance marker.
 *
 * Deliberately strict on `=== true`: a payload that merely HAS the key (a truthy
 * string, a stray `0`) is not a claim this engine made, and treating it as one would
 * let unrelated data raise the demo indicator.
 * @param {unknown} payload - Any store value: an agent record, a file event, a
 *   network connection, or the stats object.
 * @returns {boolean}
 */
export function isDemoPayload(payload) {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    /** @type {Record<string, unknown>} */ (payload)[DEMO_MARK] === true
  );
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
    [DEMO_MARK]: true,
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

  // Copy, never hand out the pool objects: the marker must not be written onto the
  // module-level constants, which the tests and every scenario tick share.
  function activeAgents() {
    return DEMO_AGENTS_POOL.slice(0, currentScenario().agentCount).map((a) => ({
      ...a,
      [DEMO_MARK]: true,
    }));
  }

  // Seed initial state — stagger across frames to avoid reactivity cascade
  const raf =
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

  // Delay data emitters so UI renders first
  const emitterDelay = setTimeout(() => {
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
              [DEMO_MARK]: true,
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
              [DEMO_MARK]: true,
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
