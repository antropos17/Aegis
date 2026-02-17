# Contributing to AEGIS

AEGIS is building an independent AI oversight layer — a tool that monitors what AI agents do on your computer, independent of any AI vendor. When AI becomes embedded in operating systems, browsers, and every application, oversight must not belong to those same companies. Your contributions help make that vision real.

## Development Setup

```bash
git clone https://github.com/YOUR_USERNAME/AEGIS.git
cd AEGIS
npm install
npm start
```

Requires Node.js 18+ and Windows 10/11 for full monitoring functionality. The Electron app launches a real-time dashboard that detects AI agents, monitors file access, scans network connections, and scores risk.

## Workflow

1. **Fork** the repository
2. **Branch** from `master`: `git checkout -b feature/your-feature`
3. **Implement** your changes following the code standards below
4. **Test** manually: `npm start` — verify no console errors, all tabs render, existing features work
5. **Commit** with a descriptive prefix: `feat:`, `fix:`, `docs:`, `refactor:`, `security:`
6. **Push** your branch and open a **Pull Request** with a clear description of what changed and why

## Code Standards

### General Rules

- **Vanilla JS only** — no React, no TypeScript, no build tools. All renderer code runs via `<script>` tags in load order. This is intentional: zero framework dependencies for auditability and transparency.
- **CommonJS in main process** — `require`/`module.exports` with `init()` dependency injection pattern. Each module receives only the state it needs.
- **JSDoc headers on all exported functions** — `@param`, `@returns`, `@since` tags required. Include `@file`, `@module`, `@description` at top of every file.
- **200 line soft limit per file** — split into focused, single-responsibility modules when exceeding.
- **`const` over `let`** when the binding doesn't change. Never use `var`.
- **Template literals** for all HTML generation in renderer.
- **No external dependencies** without discussion — the project intentionally has only 2 runtime dependencies (`electron`, `chokidar`). Adding a dependency requires justification.

### Naming Conventions

- IPC channels: `kebab-case` — `scan-processes`, `get-stats`, `file-access`
- CSS classes: `component-element` — `agent-card`, `feed-entry`, `trust-bar-fill`
- Section comments: `// ═══ SECTION NAME ═══` for major sections, `// ── subsection ──` for minor
- User-facing text: UPPERCASE for labels and badges, Title Case for proper names

### CSS

- 8 files split by concern: `variables.css`, `base.css`, `radar.css`, `panels.css`, `components.css`, `settings.css`, `tabs.css`, `responsive.css`
- Always use CSS custom properties from `variables.css` — never hardcode colors
- Neumorphic shadow pattern: `box-shadow: Xpx Xpx Ypx var(--shadow-dark), -Xpx -Xpx Ypx var(--shadow-light)`
- Both light and dark mode must work — test with the theme toggle

## How to Add a New Agent

### To `agent-database.json`

Add an entry to the `agents` array:

```json
{
  "name": "My Agent",
  "displayName": "My Agent",
  "processPatterns": ["myagent", "myagent.exe"],
  "icon": "🤖",
  "color": "#FF6B6B",
  "vendor": "My Company",
  "category": "coding-assistant",
  "description": "Short description of the agent",
  "website": "https://example.com",
  "knownDomains": ["api.example.com"],
  "defaultTrust": 50,
  "riskProfile": "medium",
  "configPaths": [".myagent/"]
}
```

**Required fields:**
- `name` / `displayName` — Agent identifier (must be unique)
- `processPatterns` — Substrings matched against running process names (case-insensitive)

**Important fields:**
- `knownDomains` — Domains classified as "safe" when this agent connects to them. Without this, the agent's connections will be flagged as unknown.
- `configPaths` — Directories to monitor for the Hudson Rock config protection feature. These directories are watched for unauthorized access.
- `defaultTrust` — Initial trust score (0-100). Lower = more suspicious. Affects risk score multiplier.
- `riskProfile` — `low`, `medium`, or `high`. Affects default permission assignments.
- `category` — One of: `coding-assistant`, `ai-ide`, `cli-tool`, `autonomous-agent`, `desktop-agent`, `browser-agent`, `agent-framework`, `security-devops`, `ide-extension`

### Via the UI

Users can also add custom agents through the Agent Database Manager in the RULES tab, with import/export support.

## How to Add a New Monitoring Module

Main process modules follow an `init()` dependency injection pattern:

```javascript
// src/main/my-module.js
'use strict';

let _state = null;

/**
 * Initialise with shared state references.
 * @param {Object} state
 * @returns {void}
 * @since v0.3.0
 */
function init(state) {
  _state = state;
}

/**
 * Your monitoring function.
 * @returns {Object} Results to send to renderer
 * @since v0.3.0
 */
function scan() {
  const agents = _state.getLatestAgents();
  // ... monitoring logic
  return results;
}

module.exports = { init, scan };
```

Then wire it in `main.js`:

```javascript
const mymod = require('./my-module');
mymod.init({ getLatestAgents: () => latestAgents, activityLog: sc.activityLog });
```

If the renderer needs data, register an IPC handler in `registerIpc()` and add the bridge method in `preload.js`.

## How to Add New Sensitive File Rules

Edit `src/shared/constants.js` — add to the `SENSITIVE_RULES` array:

```javascript
{ pattern: /my-pattern/i, reason: 'Description shown in UI', category: 'my-category', severity: 'critical' }
```

- `pattern` — RegExp tested against the full file path
- `reason` — Human-readable label displayed in the activity feed
- `category` — Optional grouping (e.g., `agent-config`, `credential`)
- `severity` — Optional: `critical`, `high`, `medium`, or `low`

## Issue Labels

When filing issues, use these labels:

- `bug` — Something broken or behaving incorrectly
- `feature` — New capability or enhancement
- `agent-database` — New agent signatures or updates to existing ones
- `security` — Security-related issues (use responsible disclosure for vulnerabilities)
- `documentation` — Docs improvements
- `platform` — Mac/Linux support work
- `kernel` — OS-level enforcement features

## Reporting Issues

- Use GitHub Issues with a descriptive title
- Include: OS version, Node.js version, Electron version, steps to reproduce, console output
- For feature requests, describe the use case and the threat it addresses
- For new agent requests, include: process name, vendor, known domains, category

## Code of Conduct

Be respectful, constructive, and focused on the mission. We're building independent AI oversight for everyone. Contributions of all sizes matter — from fixing typos to implementing kernel-level monitoring.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
