# Development workflow

Start with the actual checkout, `git status --short`, and `npm run dev:context`.
Read `out/development/context.md` (a short, generated inventory); search
`memory-bank/progress.md` and `memory-bank/ai-mistakes.md` only for the current
subsystem. Preserve the historical records. A commit alone does not identify an
uncommitted tree: generated reports also contain dirty state and a source digest.

## Navigation and visualizations

After the ordinary root `npm ci`, install the optional, separately locked tools:

```sh
npm ci --prefix tools/development --ignore-scripts
npm run dev:context
npm run dev:map
```

Open `out/development/map.html`. It is an offline page with a dependency diagram,
a searchable module/check-scope table and literal IPC call sites. JSON and Mermaid
are written beside it. Outputs overwrite fixed files rather than accumulate runs.
No source bodies, credentials, telemetry or application data are included.

Dependency-cruiser uses the checkout's TypeScript and Svelte compilers. Its rules
reject renderer-to-main and shared-to-process-layer imports; cycles are warnings.
Svelte compiled imports are included in this graph. It does not prove runtime
reachability or capture computed imports, dependency injection or IPC data flow.
The IPC inventory separately extracts literal direct calls; inspect handlers and
senders for validation and sensitive data. Direct test imports are navigation
hints; absence means unknown, not untested. Coverage labels describe configuration,
not execution. JS `@ts-check` annotations and effective TS configuration are read;
Svelte template checks remain a separate command.

Use the smallest useful graph slice during implementation. Read full module bodies
only when necessary. Keep generated output local and regenerate after source or
configuration changes. Run `npm run dev:tools:test` to verify the inventory and
the architecture rules, including deliberately invalid import boundaries.

## Selecting verification

| Change | First checks | Additional evidence |
| --- | --- | --- |
| Main/shared behavior | Relevant `tests/main` / `tests/shared` files, main typecheck | Actual dependency callers; platform behavior on the affected OS |
| Observatory logic/component | Relevant renderer/component tests, `frontend:check` | Render affected states; production build for host-boundary changes |
| Preload, IPC, exports, API handling | Relevant behavioral tests; `dev:security`; security diff review | Trace data across the actual handler, bridge and consumer |

During iteration, run affected tests first. Before merging, run all required gates
from the current `AGENTS.md` / CI workflow. Do not rerun an unchanged passing suite
without a reason. Run temporary mutation gates separately from tree-scanning checks.
The optional developer tools are not new required GitHub contexts.

The active Electron smoke test is `npm run frontend:test:electron`; it launches the
real host and writes bounded named screenshots under `dist/electron-qa`. Inspect its
environment and effects before running. The old `capture-screenshots.mjs` targets
the retired demo shell and is not evidence for Observatory. Demo UI screenshots
alone never verify the real preload bridge or OS sensors.

## MCP

Svelte MCP and OpenAI documentation are already useful for their respective APIs.
Use Svelte's autofixer on changed components, then the repository's own checks.
Context7 is optional for other dependencies when official/local docs are insufficient;
send library/version questions, not private source, telemetry or credentials.

Serena is optional symbol navigation. Install from its official instructions and
pin a reviewed release or commit. The tested source commit on 2026-09-18 was
`c6fbd1c5932df2494ffa0020af5a9fbe80b82143`. Select language `svelte` (includes JS/TS),
activate the exact checkout by absolute path, and verify the active project before
queries. Begin with `find_symbol`, `find_referencing_symbols` and
`get_symbols_overview`; literal searches remain useful for IPC strings and dynamic
CommonJS. Use read-only mode and a tool allowlist; automatic symbol editing is not
needed for the navigation workflow. Newly configured MCPs may need a new Codex
session. A configuration entry alone is not a successful MCP handshake.

Keep machine paths outside committed configuration. Back up global configuration
before registration. The local installation can be disabled globally and enabled
only in this project's local `.codex/config.toml` override. Do not publish that
machine-specific override without checking portability.

## Local static security checks

Use Semgrep 1.177.0, independently installed from the application dependencies:

```sh
uv tool install --python 3.13 semgrep==1.177.0
npm run dev:security
semgrep --test --config tools/development/security-rules.yml tools/development/security-rules.js
```

The runner accepts `AEGIS_SEMGREP`, then ignored `tools/development/local.json`
(`{"semgrep":"/absolute/path/to/semgrep"}`), then PATH. It uses local rules, disables
metrics/version checks and fails on findings or parser errors. The JSON report
lists skipped/partially parsed targets: zero findings is not a clean scan when
parsing failed. The first Windows run exposed a raw NUL byte in the template
literal in `src/main/resource-monitor.js`; spelling it as `\u0000` preserves the
runtime delimiter while making the file parseable by the scanner.

The three initial rules detect weakened Electron preferences, raw IPC exposure,
and dynamic code evaluation. They do not prove sender validation, data-flow safety,
absence of secrets, or freedom from supply-chain vulnerabilities. Use the existing
Codex Security diff workflow for scoped security review. Reserve whole-repository
and repeated deep scans for explicit audit tasks. `npm audit --omit=dev` does not
cover every development tool or the Electron runtime listed as a devDependency.

## Storage and measurement

Set TEMP/TMP, npm/uv/Python/Electron caches to a spacious data drive per process.
Keep reports in ignored `out/development` with fixed filenames. The local Serena
launcher rotates each MCP log at 2 MiB with two backups and prunes closed logs at
startup/shutdown after 30 days or above 32 MiB total; active/locked files are skipped.
The pinned installation and reusable caches are retained, not purged blindly.
Check free space before and after installations or full verification batches.

Evaluate Serena on five representative navigation tasks using the same checkout
and model settings. Record correctness, calls, elapsed time, returned text bytes,
and tokens only if the host exposes them. Include cold startup/indexing cost;
smaller output is not itself proof of lower total cost. Do not advertise savings
until the comparison is measured.
