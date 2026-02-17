# Contributing to AEGIS

Thank you for your interest in AEGIS. This document covers the development workflow, code standards, and how to extend the monitoring system.

## Development Setup

```bash
git clone https://github.com/YOUR_USERNAME/AEGIS.git
cd AEGIS
npm install
npm start
```

Requires Node.js 18+ and Windows 10/11 for full functionality. The Electron app launches a dashboard that monitors AI agent processes in real time.

## Workflow

1. **Fork** the repository
2. **Branch** from `master`: `git checkout -b feature/your-feature`
3. **Implement** your changes following the code standards below
4. **Test** manually: `npm start` — verify no console errors, existing features intact
5. **Commit** with a descriptive message: `feat:`, `fix:`, `docs:`, `refactor:`
6. **Push** your branch and open a **Pull Request**

## Code Standards

### General Rules

- **Vanilla JS only** — no React, no TypeScript, no build tools. All renderer code runs via `<script>` tags.
- **CommonJS in main process** — `require`/`module.exports` with `init()` dependency injection pattern.
- **JSDoc on all exported functions** — `@param`, `@returns`, `@since` tags required.
- **200 line soft limit per file** — split into focused modules if exceeding.
- **`const` over `let`** when the binding doesn't change.
- **Template literals** for HTML generation in renderer.
- **No external dependencies** without discussion — the project intentionally has only 2 (`electron`, `chokidar`).

### Naming Conventions

- IPC channels: `kebab-case` (e.g., `scan-processes`, `get-stats`)
- CSS classes: `component-element` (e.g., `agent-card`, `feed-entry`, `trust-bar-fill`)
- Section comments: `// ═══ SECTION NAME ═══` for major sections, `// ── subsection ──` for minor
- User-facing text: UPPERCASE for labels, Title Case for names

### CSS

- 8 files split by concern: `variables.css`, `base.css`, `radar.css`, `panels.css`, `components.css`, `settings.css`, `tabs.css`, `responsive.css`
- Use CSS custom properties from `variables.css` (never hardcode colors)
- Neumorphic shadow pattern: `box-shadow: Xpx Xpx Ypx var(--shadow-dark), -Xpx -Xpx Ypx var(--shadow-light)`

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

**Fields:**
- `processPatterns` — Substrings matched against running process names (case-insensitive)
- `knownDomains` — Domains classified as "safe" when this agent connects to them
- `configPaths` — Directories to monitor for the Hudson Rock config protection feature
- `defaultTrust` — Initial trust score (0-100). Lower = more suspicious.
- `riskProfile` — `low`, `medium`, or `high`

### Via the UI

Users can also add custom agents through the Agent Database Manager in the RULES tab.

## How to Add a New Monitoring Module

Main process modules follow an `init()` dependency injection pattern:

```javascript
// src/main/my-module.js
'use strict';

let _state = null;

function init(state) {
  _state = state;
}

function doSomething() {
  // Use _state.getLatestAgents(), _state.activityLog, etc.
}

module.exports = { init, doSomething };
```

Wire it in `main.js`:

```javascript
const mymod = require('./my-module');
mymod.init({ getLatestAgents: () => latestAgents, activityLog: sc.activityLog });
```

Register IPC handlers in `registerIpc()` if the renderer needs to call it, and add the bridge method in `preload.js`.

## Reporting Issues

- Use GitHub Issues with a descriptive title
- Include: OS version, Node.js version, steps to reproduce, console output
- For feature requests, describe the use case and why it matters

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
