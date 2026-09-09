# Contributing to AEGIS

AEGIS is building an independent AI oversight layer — a tool that monitors what AI agents do on your computer, independent of any AI vendor. When AI becomes embedded in operating systems, browsers, and every application, oversight must not belong to those same companies. Your contributions help make that vision real.

## Development Setup

```bash
git clone https://github.com/antropos17/Aegis.git
cd Aegis
npm ci
npm start
```

Requires the Node.js version in `engines` in `package.json` (also pinned in `.nvmrc` and used by CI) and Windows 10/11 for the primary supported monitoring path. macOS/Linux support is experimental; see the [known limits](README.md#known-limits). The Electron app launches a dashboard that detects AI agents, monitors file access, scans network connections, and scores risk.

## Workflow

1. **Fork** the repository
2. **Branch** from `master`: `git checkout -b feat/your-feature` (see [BRANCHING.md](BRANCHING.md) for the full prefix list)
3. **Implement** your changes following the code standards below
4. **Test**: run `npm test` — the suite prints its own pass/skip and file counts — and `npm start`; verify no console errors, all tabs render, existing features work
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
Release PRs created or updated with `GITHUB_TOKEN` can wait for **Approve workflows to run** before CI starts. A maintainer reviews the diff, approves the workflow run and waits for all required checks before merging. See [GitHub's documented approval behavior](https://docs.github.com/en/actions/concepts/security/github_token).

Merging the Release PR creates the version bump, changelog and GitHub Release; the installer workflow then builds and uploads artifacts. A release is ready to download only after that build succeeds.

## Code Standards

### General Rules

- **Svelte 5 + Vite for renderer** — component-based architecture with `$state`/`$derived`/`$effect` runes. Main process remains CommonJS.
- **CommonJS in main process** — `require`/`module.exports` with `init()` dependency injection pattern. Each module receives only the state it needs.
- **JSDoc headers on all exported functions** — `@param`, `@returns`, `@since` tags required. Include `@file`, `@module`, `@description` at top of every file.
- **Aim for 300 lines in new files.** Extract a focused module when adding to an oversized file; do not split existing files solely to meet the target.
- **`const` over `let`** when the binding doesn't change. Never use `var`.
- **Justify new dependencies.** The runtime dependencies in `package.json` are `ajv` (schema validation), `chokidar` (file watching), `electron-updater` (updates), `js-yaml` (ruleset parsing) and `semver` (version comparison). Electron is a devDependency used to build and run the desktop shell.

### Naming Conventions

- IPC channels: `kebab-case` — `scan-processes`, `get-stats`, `file-access`
- CSS classes: `component-element` — `agent-card`, `feed-entry`, `trust-bar-fill`
- Section comments: `// ═══ SECTION NAME ═══` for major sections, `// ── subsection ──` for minor
- User-facing text: UPPERCASE for labels and badges, Title Case for proper names

### TypeScript

- **New renderer files use TypeScript** (`.ts` or `<script lang="ts">` in Svelte). Main-process modules remain CommonJS JavaScript with JSDoc; there is no blanket migration requirement
- **Main process** (`.js`): annotated with JSDoc, which editors use for IntelliSense. `checkJs` is **off** in `tsconfig.base.json`, so `tsc` resolves these files but does not type-check their bodies — the annotations document intent, they are not enforced by the typecheck gate
- **Renderer** (`.ts`/`.svelte`): native TypeScript with ES modules
- Shared type definitions live in `src/shared/types/` (`npm run counts:check` derives the file count)
- Run `npm run typecheck` before opening a PR — zero type errors required. It checks both projects (`tsconfig.main.json` + `tsconfig.renderer.json`); a bare `npx tsc --noEmit` resolves the root solution file and checks nothing
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
  "names": ["myagent", "myagent.exe"],
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
- `names` — Substrings matched against running process names (case-insensitive). The field is `names`, not `processPatterns`; nothing in the codebase reads a `processPatterns` key

**Important fields:**
- `knownDomains` — Vendor endpoint allowlist metadata. An allowlisted endpoint is not a guarantee of safe behavior; unresolved endpoints are `unknown` and resolved names outside the applicable allowlists are `flagged`
- `configPaths` — Descriptive metadata; adding it does not register a watcher. Add a supported watch root to `AGENT_CONFIG_PATHS` in `src/shared/constants.js` and verify the watcher behavior separately
- `defaultTrust` — Database metadata; it is not an input to the current risk-scoring formula
- `riskProfile` — `low`, `medium`, or `high` metadata used by the database UI. It does not select default permissions; `config-manager.js` uses known-agent membership for the initial `monitor`/`block` value
- `category` — One of the 11 in use: `agent-framework`, `ai-ide`, `autonomous-agent`, `browser-agent`, `cli-tool`, `coding-assistant`, `container-runtime`, `desktop-agent`, `ide-extension`, `local-llm-runtime`, `security-devops`

### Via the UI

Users can also add custom agents through the Agent Database Manager in the RULES tab, with import/export support.

## How to Add a New Monitoring Module

Main process modules use an `init(deps)` dependency injection pattern; inspect the neighboring modules for the required dependencies:

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
  // Replace this example result with the observations produced by the module.
  return { observedAgents: agents.length };
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

Rules live in `rules/*.yaml` — one ruleset file per category, validated against `rules/_schema.json` and loaded by `src/main/rule-loader.js` with edit-triggered hot reload in unpacked runs. Add an entry to the ruleset for your category:

```yaml
  - id: "SS007"
    name: "SSH agent socket"
    pattern: "ssh-agent"
    reason: "Description shown in UI"
    category: "ssh"
    risk: critical
    enabled: true
```

- `id` — Unique rule id (2-letter category prefix + 3 digits)
- `name` — Short rule name
- `pattern` — Regex source string tested against the full file path
- `reason` — Human-readable label displayed in the activity feed
- `category` — Must be one of the 8 values in `_schema.json`: `ai-config`, `secrets`, `ssh`, `certificates`, `cloud`, `browser`, `devtools`, `crypto`
- `risk` — `critical`, `high`, `medium`, or `low`
- `enabled` — Set `false` to ship a rule disabled by default

## Issue Labels

When filing issues, use these labels:

- `bug` — Something broken or behaving incorrectly
- `enhancement` — New capability or improvement to an existing one
- `agent-database` — New agent signatures or updates to existing ones
- `security` — Security-related issues (use responsible disclosure for vulnerabilities)
- `documentation` — Docs improvements
- `platform` — Mac/Linux support work

The full set is on the repository's [labels page](https://github.com/antropos17/Aegis/labels); `good first issue` and `help wanted` mark issues that are open to contributors.

## Reporting Issues

Remove API keys, credentials and private paths from logs or exported settings before attaching them. Report vulnerabilities through the [private security channel](SECURITY.md#reporting-a-vulnerability).

- Use GitHub Issues with a descriptive title
- Include: OS version, Node.js version, Electron version, steps to reproduce, console output
- For feature requests, describe the use case and the threat it addresses
- For new agent requests, include: process name, vendor, known domains, category

## Code of Conduct

Be respectful, constructive, and focused on the mission. We're building independent AI oversight for everyone. Contributions of all sizes matter — from fixing typos to implementing kernel-level monitoring.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
