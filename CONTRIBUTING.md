# Contributing to AEGIS

AEGIS is building an independent AI oversight layer — a tool that monitors what AI agents do on your computer, independent of any AI vendor. When AI becomes embedded in operating systems, browsers, and every application, oversight must not belong to those same companies. Your contributions help make that vision real.

## Development Setup

```bash
git clone https://github.com/antropos17/Aegis.git
cd Aegis
npm install
npm start
```

Requires Node.js 18+ and Windows 10/11 for full monitoring functionality. The Electron app launches a real-time dashboard that detects AI agents, monitors file access, scans network connections, and scores risk.

## Workflow

1. **Fork** the repository
2. **Branch** from `master`: `git checkout -b feature/your-feature`
3. **Implement** your changes following the code standards below
4. **Test**: run `npm test` (475 tests across 28 files) and `npm start` — verify no console errors, all tabs render, existing features work
5. **Commit** with [conventional commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`
6. **Push** your branch and open a **Pull Request** with a clear description of what changed and why

### Branch Workflow
See [BRANCHING.md](BRANCHING.md) for full details.
- Create a feature branch: `git checkout -b feat/my-feature`
- Make changes with conventional commits
- Push and create PR: `gh pr create --base master`
- CI must pass, then maintainer merges

### Releases
Releases are automated via [release-please](https://github.com/googleapis/release-please).
Just write proper conventional commits. release-please creates a Release PR automatically.
When maintainers merge the Release PR → version bump + CHANGELOG + GitHub Release happen automatically.

## Code Standards

### General Rules

- **Svelte 5 + Vite for renderer** — component-based architecture with `$state`/`$derived`/`$effect` runes. Main process remains CommonJS.
- **CommonJS in main process** — `require`/`module.exports` with `init()` dependency injection pattern. Each module receives only the state it needs.
- **JSDoc headers on all exported functions** — `@param`, `@returns`, `@since` tags required. Include `@file`, `@module`, `@description` at top of every file.
- **200 line soft limit per file** — split into focused, single-responsibility modules when exceeding.
- **`const` over `let`** when the binding doesn't change. Never use `var`.
- **No external dependencies** without discussion — the project intentionally has only 1 runtime dependency (`chokidar`; `electron` is a devDependency). Adding a dependency requires justification.

### Naming Conventions

- IPC channels: `kebab-case` — `scan-processes`, `get-stats`, `file-access`
- CSS classes: `component-element` — `agent-card`, `feed-entry`, `trust-bar-fill`
- Section comments: `// ═══ SECTION NAME ═══` for major sections, `// ── subsection ──` for minor
- User-facing text: UPPERCASE for labels and badges, Title Case for proper names

### TypeScript

- **New files should be written in TypeScript** (`.ts`) — existing `.js` files will be migrated incrementally
- **Main process** (`.js`): uses JSDoc annotations + `checkJs: true` for type safety without converting to `.ts`
- **Renderer** (`.ts`/`.svelte`): native TypeScript with ES modules
- Shared type definitions live in `src/shared/types/` (34 types across 7 files)
- Run `npx tsc --noEmit` (typecheck) before opening a PR — zero type errors required
- **Zero `any`** — use proper types, generics, or `unknown` instead. ESLint warns on `any`
- Explicit return types on exported functions (`@typescript-eslint/explicit-function-return-type`)
- Unused variables are errors, not warnings, in `.ts` files

### CSS

- Scoped styles inside `.svelte` components + 2 global files: `tokens.css` (M3 design tokens) and `global.css` (base styles)
- Always use CSS custom properties from `tokens.css` — never hardcode colors
- Glassmorphism pattern with `backdrop-filter` blur and M3 design tokens
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
- `category` — One of: `coding-assistant`, `ai-ide`, `cli-tool`, `autonomous-agent`, `desktop-agent`, `browser-agent`, `agent-framework`, `security-devops`, `ide-extension`, `local-llm-runtime`

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
