/** @file Static data pools for demo mode scenario engine. */

/** @type {Array<{agent: string, process: string, pid: number, category: string, parentEditor: string|null, cwd: string|null, projectName: string|null, localModels?: string[]}>} */
// prettier-ignore
export const DEMO_AGENTS_POOL = [
  { agent: 'Claude Code', process: 'claude', pid: 3421, category: 'coding-assistant', parentEditor: null, cwd: '~/code/myapp', projectName: 'myapp' },
  { agent: 'GitHub Copilot', process: 'copilot-agent', pid: 4832, category: 'coding-assistant', parentEditor: 'Code', cwd: '~/code/myapp', projectName: 'myapp' },
  { agent: 'Cursor', process: 'Cursor Helper', pid: 2901, category: 'ai-ide', parentEditor: null, cwd: '~/code/myapp', projectName: 'myapp' },
  { agent: 'Windsurf', process: 'windsurf', pid: 5510, category: 'ai-ide', parentEditor: null, cwd: '~/code/backend', projectName: 'backend' },
  { agent: 'Aider', process: 'aider', pid: 6233, category: 'coding-assistant', parentEditor: null, cwd: '~/code/backend', projectName: 'backend' },
  { agent: 'Devin', process: 'devin-agent', pid: 7801, category: 'autonomous-agent', parentEditor: null, cwd: '~/projects/ml-pipeline', projectName: 'ml-pipeline' },
  { agent: 'AutoGPT', process: 'autogpt', pid: 8045, category: 'autonomous-agent', parentEditor: null, cwd: '~/projects/ml-pipeline', projectName: 'ml-pipeline' },
  { agent: 'OpenAI Codex CLI', process: 'codex', pid: 9102, category: 'cli-tool', parentEditor: null, cwd: '~/code/myapp', projectName: 'myapp' },
  { agent: 'Manus AI', process: 'manus', pid: 3877, category: 'autonomous-agent', parentEditor: null, cwd: '~/projects/ml-pipeline', projectName: 'ml-pipeline' },
  { agent: 'LM Studio', process: 'lms', pid: 2200, category: 'local-llm-runtime', parentEditor: null, cwd: null, projectName: null, localModels: ['llama3.1', 'qwen2.5-coder', 'deepseek-r1'] },
  { agent: 'Ollama', process: 'ollama', pid: 1544, category: 'local-llm-runtime', parentEditor: null, cwd: null, projectName: null, localModels: ['llama3', 'mistral', 'codellama'] },
  { agent: 'GPT Pilot', process: 'gpt-pilot', pid: 7102, category: 'autonomous-agent', parentEditor: null, cwd: '~/code/backend', projectName: 'backend' },
];

/** @type {Array<{file: string, sensitive: boolean, selfAccess: boolean, reason: string, action: string}>} */
// prettier-ignore
export const DEMO_FILE_POOL = [
  // ── Normal project files ──
  { file: '~/code/myapp/src/index.js', sensitive: false, selfAccess: false, reason: '', action: 'modified' },
  { file: '~/code/myapp/src/components/App.jsx', sensitive: false, selfAccess: false, reason: '', action: 'modified' },
  { file: '~/code/myapp/package.json', sensitive: false, selfAccess: false, reason: '', action: 'accessed' },
  { file: '~/code/myapp/README.md', sensitive: false, selfAccess: false, reason: '', action: 'modified' },
  { file: '~/code/myapp/vite.config.ts', sensitive: false, selfAccess: false, reason: '', action: 'modified' },
  { file: '~/code/myapp/src/api/auth.js', sensitive: false, selfAccess: false, reason: '', action: 'modified' },
  { file: '~/code/myapp/tests/unit.test.js', sensitive: false, selfAccess: false, reason: '', action: 'created' },
  { file: '~/code/myapp/src/utils/crypto.js', sensitive: false, selfAccess: false, reason: '', action: 'modified' },
  { file: '~/code/backend/src/routes/api.ts', sensitive: false, selfAccess: false, reason: '', action: 'modified' },
  { file: '~/code/backend/src/db/migrations/001_users.sql', sensitive: false, selfAccess: false, reason: '', action: 'created' },
  { file: '~/projects/ml-pipeline/model.py', sensitive: false, selfAccess: false, reason: '', action: 'modified' },
  { file: '~/projects/ml-pipeline/train.py', sensitive: false, selfAccess: false, reason: '', action: 'modified' },
  // ── Self-access (AI config) ──
  { file: '~/.claude/settings.json', sensitive: false, selfAccess: true, reason: 'AI agent config', action: 'accessed' },
  { file: '~/.gitconfig', sensitive: false, selfAccess: false, reason: '', action: 'accessed' },
  // ── Sensitive files ──
  { file: '~/code/myapp/.env.local', sensitive: true, selfAccess: false, reason: 'environment variables', action: 'accessed' },
  { file: '~/code/backend/.env', sensitive: true, selfAccess: false, reason: 'environment variables', action: 'accessed' },
  { file: '~/.config/gh/hosts.yml', sensitive: true, selfAccess: false, reason: 'GitHub token', action: 'accessed' },
  { file: '~/.ssh/id_rsa', sensitive: true, selfAccess: false, reason: 'SSH private key', action: 'accessed' },
  { file: '~/.ssh/id_rsa.pub', sensitive: true, selfAccess: false, reason: 'SSH public key', action: 'accessed' },
  { file: '~/.aws/credentials', sensitive: true, selfAccess: false, reason: 'AWS credentials', action: 'accessed' },
  { file: '~/.npmrc', sensitive: true, selfAccess: false, reason: 'npm registry token', action: 'accessed' },
  { file: '~/.kube/config', sensitive: true, selfAccess: false, reason: 'Kubernetes credentials', action: 'accessed' },
  { file: '~/.docker/config.json', sensitive: true, selfAccess: false, reason: 'Docker registry auth', action: 'accessed' },
  { file: '~/.gnupg/secring.gpg', sensitive: true, selfAccess: false, reason: 'GPG private key', action: 'accessed' },
  { file: '~/.config/gcloud/credentials.json', sensitive: true, selfAccess: false, reason: 'GCP credentials', action: 'accessed' },
];

/** @type {Array<{domain: string, remoteIp: string, remotePort: number, state: string, flagged: boolean}>} */
// prettier-ignore
export const DEMO_DOMAIN_POOL = [
  // ── Legitimate AI services ──
  { domain: 'api.anthropic.com', remoteIp: '18.64.128.42', remotePort: 443, state: 'ESTABLISHED', flagged: false },
  { domain: 'github.copilot.ai', remoteIp: '140.82.121.3', remotePort: 443, state: 'ESTABLISHED', flagged: false },
  { domain: 'api.githubcopilot.com', remoteIp: '140.82.121.4', remotePort: 443, state: 'ESTABLISHED', flagged: false },
  { domain: 'cursor.sh', remoteIp: '76.76.21.9', remotePort: 443, state: 'ESTABLISHED', flagged: false },
  { domain: 'api2.cursor.sh', remoteIp: '76.76.21.10', remotePort: 443, state: 'ESTABLISHED', flagged: false },
  { domain: 'cdn.oaistatic.com', remoteIp: '104.18.10.55', remotePort: 443, state: 'ESTABLISHED', flagged: false },
  { domain: 'api.openai.com', remoteIp: '104.18.7.192', remotePort: 443, state: 'ESTABLISHED', flagged: false },
  { domain: 'api.devin.ai', remoteIp: '34.102.136.180', remotePort: 443, state: 'ESTABLISHED', flagged: false },
  { domain: 'api.together.ai', remoteIp: '52.8.19.58', remotePort: 443, state: 'ESTABLISHED', flagged: false },
  { domain: 'huggingface.co', remoteIp: '18.154.227.120', remotePort: 443, state: 'ESTABLISHED', flagged: false },
  { domain: 'localhost', remoteIp: '127.0.0.1', remotePort: 1234, state: 'ESTABLISHED', flagged: false },
  // ── Suspicious destinations ──
  { domain: 'data-collector-unknown.io', remoteIp: '45.33.32.156', remotePort: 4444, state: 'ESTABLISHED', flagged: true },
  { domain: 'telemetry-exfil.net', remoteIp: '198.51.100.42', remotePort: 8080, state: 'ESTABLISHED', flagged: true },
  { domain: 'suspicious-relay.xyz', remoteIp: '203.0.113.66', remotePort: 9999, state: 'ESTABLISHED', flagged: true },
];

/**
 * Scenario phases that cycle in order.
 * @type {Array<{name: string, duration: number, agentCount: number, sensitiveWeight: number}>}
 */
export const SCENARIOS = [
  { name: 'calm', duration: 25000, agentCount: 3, sensitiveWeight: 0.05 },
  { name: 'elevated', duration: 25000, agentCount: 7, sensitiveWeight: 0.25 },
  { name: 'critical', duration: 25000, agentCount: 12, sensitiveWeight: 0.55 },
  { name: 'reset', duration: 5000, agentCount: 2, sensitiveWeight: 0.0 },
];
