/** @file Static data pools for demo mode scenario engine. */

/** @type {Array<{agent: string, process: string, pid: number, category: string, parentEditor: string|null, cwd: string|null, projectName: string|null, localModels?: string[]}>} */
// prettier-ignore
export const DEMO_AGENTS_POOL = [
  { agent: 'Claude Code', process: 'claude', pid: 3421, category: 'ai', parentEditor: null, cwd: '~/code/myapp', projectName: 'myapp' },
  { agent: 'GitHub Copilot', process: 'copilot-agent', pid: 4832, category: 'ai', parentEditor: 'Code', cwd: '~/code/myapp', projectName: 'myapp' },
  { agent: 'Cursor', process: 'Cursor Helper', pid: 2901, category: 'ai', parentEditor: null, cwd: '~/code/myapp', projectName: 'myapp' },
  { agent: 'GPT Pilot', process: 'gpt-pilot', pid: 7102, category: 'ai', parentEditor: null, cwd: '~/code/myapp', projectName: 'myapp' },
  { agent: 'Ollama', process: 'ollama', pid: 1544, category: 'local-llm-runtime', parentEditor: null, cwd: null, projectName: null, localModels: ['llama3', 'mistral', 'codellama'] },
];

/** @type {Array<{file: string, sensitive: boolean, selfAccess: boolean, reason: string, action: string}>} */
// prettier-ignore
export const DEMO_FILE_POOL = [
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

/** @type {Array<{domain: string, remoteIp: string, remotePort: number, state: string, flagged: boolean}>} */
// prettier-ignore
export const DEMO_DOMAIN_POOL = [
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
export const SCENARIOS = [
  { name: 'calm', duration: 25000, agentCount: 2, sensitiveWeight: 0.05 },
  { name: 'elevated', duration: 25000, agentCount: 4, sensitiveWeight: 0.25 },
  { name: 'critical', duration: 25000, agentCount: 5, sensitiveWeight: 0.55 },
  { name: 'reset', duration: 5000, agentCount: 1, sensitiveWeight: 0.0 },
];
