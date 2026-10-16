# Contributing to AEGIS

AEGIS monitors local AI agents, reviews selected project files and checks explicitly configured actions. Contributions help make the observations, controls and their limits easier to understand. Start with the [documentation index](docs/README.md) for user guides and technical contracts.

## Development Setup

```bash
git clone https://github.com/antropos17/Aegis.git
cd Aegis
npm ci
npm start
```

Requires the Node.js version in `engines` in `package.json` (also pinned in `.nvmrc` and used by CI) and Windows 10/11 for the primary supported monitoring path. macOS/Linux support is experimental; see the [known limits](README.md#known-limits). The Electron app launches a dashboard that detects AI agents, monitors file access, scans network connections, and scores risk.

## Workflow

Fork the repository if needed, then follow the
[Git and PR workflow](docs/development/workflow.md#git-and-pr-cycle) and
[branch/commit conventions](BRANCHING.md). Use a branch from a freshly fetched
base and preserve unrelated work. External contributors submit a PR for
maintainer review; repository automation permissions do not grant contributor
access.

Choose checks from [Selecting verification](docs/development/workflow.md#selecting-verification).
For visual changes, also follow [Observatory verification](frontend/observatory/AGENTS.md).
Describe the resulting behavior, reason for the change, actual validation and
remaining limits in the PR.

### Releases
Releases are automated via [release-please](https://github.com/googleapis/release-please).
Just write proper conventional commits. release-please creates a Release PR automatically.
Release PRs created or updated with `GITHUB_TOKEN` can wait for **Approve workflows to run** before CI starts. A maintainer reviews the diff, approves the workflow run and waits for all required checks before merging. See [GitHub's documented approval behavior](https://docs.github.com/en/actions/concepts/security/github_token).

Merging the Release PR creates the version bump, changelog and GitHub Release; the installer workflow then builds and uploads artifacts. A release is ready to download only after that build succeeds.

## Code Standards

[CODING_STANDARDS.md](CODING_STANDARDS.md) owns language, module, JSDoc,
identity and lifecycle conventions. [The development guide](docs/DEVELOPMENT.md)
contains implementation examples; [Observatory design](frontend/observatory/DESIGN.md)
owns the active interface contract. Derive dependency versions and scripts from
`package.json`, and justify new dependencies in the PR.

The main process uses CommonJS JavaScript with JSDoc; new renderer files use
TypeScript. Check effective `checkJs` and per-file directives before describing
body-level JavaScript type coverage. A passing root solution-file `tsc` command
does not check source; use the repository's typecheck scripts.

## How to Add a New Agent

### To `agent-database.json`

Add an entry to the `agents` array:

```json
{
  "id": "my-agent",
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
- `id` — Unique stable identifier (1–128 ASCII letters, digits, underscores, dots or hyphens; reserved object keys are rejected)
- `displayName` — Nonempty human-readable name, up to 200 characters
- `names` — Nonempty array of nonempty strings (up to 256 characters each). Exact process-name matches are case-insensitive; a name does not establish executable origin, and a generic runtime such as `node.exe` is not attributed to the CLI it launched. The field is `names`, not `processPatterns`; nothing in the codebase reads a `processPatterns` key

**Important fields:**
- `knownDomains` — Vendor endpoint allowlist metadata. An allowlisted endpoint is not a guarantee of safe behavior; unresolved endpoints are `unknown` and resolved names outside the applicable allowlists are `flagged`
- `configPaths` — Descriptive metadata; adding it does not register a watcher. Add a supported watch root to `AGENT_CONFIG_PATHS` in `src/shared/constants.js` and verify the watcher behavior separately
- `defaultTrust` — Database metadata; it is not an input to the current risk-scoring formula
- `riskProfile` — `low`, `medium`, or `high` metadata used by the database UI. It does not select default permissions; `config-manager.js` uses known-agent membership for the initial `monitor`/`block` value
- `category` — One of the 11 in use: `agent-framework`, `ai-ide`, `autonomous-agent`, `browser-agent`, `cli-tool`, `coding-assistant`, `container-runtime`, `desktop-agent`, `ide-extension`, `local-llm-runtime`, `security-devops`

### Via the UI

Open **Agent catalog** to add a custom agent or import/export signatures. The supported fields are validated by `validateCustomAgent` in `src/main/settings-validation.js`.

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
