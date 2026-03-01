/**
 * @file demo-data.js
 * @description Fake data generators and scenario engine for browser-only demo mode.
 *   Produces realistic agent activity that cycles through 4 threat scenarios.
 * @since v0.3.0
 */

const DEMO_AGENTS_POOL = [
  { agent: 'Claude Code', process: 'claude', pid: 3421, category: 'ai', parentEditor: null, cwd: '~/code/myapp', projectName: 'myapp' },
  { agent: 'GitHub Copilot', process: 'copilot-agent', pid: 4832, category: 'ai', parentEditor: 'Code', cwd: '~/code/myapp', projectName: 'myapp' },
  { agent: 'Cursor', process: 'Cursor Helper', pid: 2901, category: 'ai', parentEditor: null, cwd: '~/code/myapp', projectName: 'myapp' },
  { agent: 'GPT Pilot', process: 'gpt-pilot', pid: 7102, category: 'ai', parentEditor: null, cwd: '~/code/myapp', projectName: 'myapp' },
  { agent: 'Ollama', process: 'ollama', pid: 1544, category: 'local-llm-runtime', parentEditor: null, cwd: null, projectName: null, localModels: ['llama3', 'mistral', 'codellama'] },
];

const DEMO_FILE_POOL = [
  { file: '~/code/myapp/src/index.js', sensitive: false, selfAccess: false, reason: '', action: 'modified' },
  { file: '~/code/myapp/src/components/App.jsx', sensitive: false, selfAccess: false, reason: '', action: 'modified' },
  { file: '~/code/myapp/package.json', sensitive: false, selfAccess: false, reason: '', action: 'accessed' },
  { file: '~/code/myapp/README.md', sensitive: false, selfAccess: false, reason: '', action: 'modified' },
  { file: '~/code/myapp/.env.local', sensitive: true, selfAccess: false, reason: 'environment variables', action: 'accessed' },
  { file: '~/.claude/settings.json', sensitive: false, selfAccess: true, reason: 'AI agent config', action: 'accessed' },
  { file: '~/.config/gh/hosts.yml', sensitive: true, selfAccess: false, reason: 'GitHub token', action: 'accessed' },
  { file: '~/.ssh/id_rsa', sensitive: true, selfAccess: false, reason: 'SSH private key', action: 'accessed' },
  { file: '~/.ssh/id_rsa.pub', sensitive: true, selfAccess: false, reason: 'SSH public key', action: 'accessed' },
  { file: '~/.aws/credentials', sensitive: true, selfAccess: false, reason: 'AWS credentials', action: 'accessed' },
  { file: '~/code/myapp/src/api/auth.js', sensitive: false, selfAccess: false, reason: '', action: 'modified' },
  { file: '~/code/myapp/tests/unit.test.js', sensitive: false, selfAccess: false, reason: '', action: 'created' },
  { file: '~/.gitconfig', sensitive: false, selfAccess: false, reason: '', action: 'accessed' },
  { file: '~/code/myapp/src/utils/crypto.js', sensitive: false, selfAccess: false, reason: '', action: 'modified' },
  { file: '~/.npmrc', sensitive: true, selfAccess: false, reason: 'npm registry token', action: 'accessed' },
];

const DEMO_DOMAIN_POOL = [
  { domain: 'api.anthropic.com', remoteIp: '18.64.128.42', remotePort: 443, state: 'ESTABLISHED', flagged: false },
  { domain: 'github.copilot.ai', remoteIp: '140.82.121.3', remotePort: 443, state: 'ESTABLISHED', flagged: false },
  { domain: 'api.githubcopilot.com', remoteIp: '140.82.121.4', remotePort: 443, state: 'ESTABLISHED', flagged: false },
  { domain: 'cursor.sh', remoteIp: '76.76.21.9', remotePort: 443, state: 'ESTABLISHED', flagged: false },
  { domain: 'api2.cursor.sh', remoteIp: '76.76.21.10', remotePort: 443, state: 'ESTABLISHED', flagged: false },
  { domain: 'cdn.oaistatic.com', remoteIp: '104.18.10.55', remotePort: 443, state: 'ESTABLISHED', flagged: false },
  { domain: 'data-collector-unknown.io', remoteIp: '45.33.32.156', remotePort: 4444, state: 'ESTABLISHED', flagged: true },
  { domain: 'telemetry-exfil.net', remoteIp: '198.51.100.42', remotePort: 8080, state: 'ESTABLISHED', flagged: true },
];

/**
 * Scenario phases that cycle in order.
 * @type {Array<{name: string, duration: number, agentCount: number, sensitiveWeight: number}>}
 */
const SCENARIOS = [
  { name: 'calm',     duration: 25000, agentCount: 2, sensitiveWeight: 0.05 },
  { name: 'elevated', duration: 25000, agentCount: 4, sensitiveWeight: 0.25 },
  { name: 'critical', duration: 25000, agentCount: 5, sensitiveWeight: 0.55 },
  { name: 'reset',    duration: 5000,  agentCount: 1, sensitiveWeight: 0.0  },
];

/** @param {number} min @param {number} max @returns {number} */
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** @param {Array} arr @returns {any} */
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Starts the demo mode scenario engine, populating Svelte stores with
 * simulated agent activity. Returns a cleanup function.
 *
 * @param {object} stores
 * @param {import('svelte/store').Writable} stores.agents
 * @param {import('svelte/store').Writable} stores.events
 * @param {import('svelte/store').Writable} stores.stats
 * @param {import('svelte/store').Writable} stores.network
 * @param {import('svelte/store').Writable} stores.anomalies
 * @param {import('svelte/store').Writable} stores.resourceUsage
 * @returns {() => void} cleanup
 */
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

  function buildStats() {
    const active = activeAgents();
    return {
      totalFiles,
      totalSensitive,
      aiSensitive: Math.round(totalSensitive * 0.85),
      uptimeMs: Date.now() - monitoringStarted,
      monitoringStarted,
      peakAgents: 5,
      currentAgents: active.length,
      aiAgentCount: active.filter((a) => a.category === 'ai').length,
      otherAgentCount: active.filter((a) => a.category !== 'ai').length,
      uniqueAgents: active.map((a) => a.agent),
    };
  }

  function buildAnomalies() {
    const scenario = currentScenario();
    const base = { calm: 8, elevated: 35, critical: 68, reset: 4 }[scenario.name];
    const result = {};
    activeAgents().forEach((a, i) => {
      result[a.agent] = Math.min(100, base + randInt(-8, 8) + i * 4);
    });
    return result;
  }

  // Seed initial state immediately
  agents.set(activeAgents());
  stats.set(buildStats());
  anomalies.set(buildAnomalies());
  resourceUsage.set({ memMB: 148, heapMB: 102, cpuUser: 31200, cpuSystem: 8400 });

  // Scenario ticker — advances phase every scenario.duration ms
  function advanceScenario() {
    scenarioIndex = (scenarioIndex + 1) % SCENARIOS.length;
    agents.set(activeAgents());
    if (currentScenario().name === 'reset') {
      totalFiles = 142;
      totalSensitive = 11;
    }
    stats.set(buildStats());
    anomalies.set(buildAnomalies());
  }
  let scenarioTimer = setTimeout(function tick() {
    advanceScenario();
    scenarioTimer = setTimeout(tick, currentScenario().duration);
  }, currentScenario().duration);

  // File event emitter — every 2-4s
  intervals.push(
    setInterval(() => {
      const scenario = currentScenario();
      const active = activeAgents();
      const isSensitive = Math.random() < scenario.sensitiveWeight;
      const pool = isSensitive
        ? DEMO_FILE_POOL.filter((f) => f.sensitive)
        : DEMO_FILE_POOL.filter((f) => !f.sensitive);
      const template = pick(pool.length ? pool : DEMO_FILE_POOL);
      const agent = pick(active);

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
    }, randInt(2000, 4000)),
  );

  // Network update emitter — every 5-8s
  intervals.push(
    setInterval(() => {
      const scenario = currentScenario();
      const active = activeAgents();
      const useFlagged =
        scenario.name === 'critical' && Math.random() < 0.4;
      const domainPool = useFlagged
        ? DEMO_DOMAIN_POOL.filter((d) => d.flagged)
        : DEMO_DOMAIN_POOL.filter((d) => !d.flagged);
      const conn = pick(domainPool.length ? domainPool : DEMO_DOMAIN_POOL);
      const agent = pick(active);

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
    }, randInt(5000, 8000)),
  );

  // Stats update — every 10s
  intervals.push(setInterval(() => stats.set(buildStats()), 10000));

  // Anomaly scores — every 15s
  intervals.push(setInterval(() => anomalies.set(buildAnomalies()), 15000));

  // Resource usage — every 5s
  intervals.push(
    setInterval(() => {
      resourceUsage.set({
        memMB: randInt(120, 180),
        heapMB: randInt(80, 130),
        cpuUser: randInt(18000, 52000),
        cpuSystem: randInt(4000, 14000),
      });
    }, 5000),
  );

  return () => {
    clearTimeout(scenarioTimer);
    intervals.forEach(clearInterval);
  };
}
