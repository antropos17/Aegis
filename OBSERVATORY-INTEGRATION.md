# Observatory integration

Base: 64478536ed8e0faa86e7a60eb543d0683b2a2e9e. Worktree: X:/tmp/aegis-observatory-integration. Branch: codex/observatory-integration.

Patch SHA256 verified; frontend contents match prepared worktree. Main checkout and preparation preserved. Temporary output belongs on X (C nearly full). No release tag authorised.

## Stages

1. Inventory and isolation: complete.
2. Typed host lifecycle and Svelte migration: complete.
3. Feature parity and action contracts verified in component tests and Electron.
4. Browser QA: 132 combinations passed; packaged renderer observed real instances.
5. Desktop entry switched; old shell, components, fonts and styles removed.
6. Local repository gates passed; Windows installer built and packaged app smoke passed. PR/CI handoff follows.

## Transfer matrix

All 54 preload methods; source references captured from the current backend base. Payloads, destination and evidence are filled as each path is implemented.

| Method | Existing consumers | Observatory destination | Evidence/status |
| --- | --- | --- | --- |
| getStats | lib/stores/ipc.ts | `host.ts` | Implemented; host/component tests and Electron workspace smoke |
| getResourceUsage | lib/stores/ipc.ts | `host.ts` | Implemented; host/component tests and Electron workspace smoke |
| exportLog | App.svelte, lib/components/Reports.svelte | `Reports.svelte` | Implemented; host/component tests and Electron workspace smoke |
| exportCsv | App.svelte, lib/components/Reports.svelte | `Reports.svelte` | Implemented; host/component tests and Electron workspace smoke |
| generateReport | App.svelte, lib/components/Reports.svelte | `Reports.svelte` | Implemented; host/component tests and Electron workspace smoke |
| getSettings | lib/components/Footer.svelte, lib/components/OptionsPanel.svelte, lib/components/Timeline.svelte | `Settings.svelte` | Implemented; host/component tests and Electron workspace smoke |
| getUpdateStatus | lib/stores/ipc.ts, lib/stores/updates.ts | `Settings.svelte` | Implemented; host/component tests and Electron workspace smoke |
| checkForUpdates | lib/components/SettingsUpdates.svelte, lib/stores/ipc.ts, lib/stores/updates.ts | `Settings.svelte` | Implemented; host/component tests and Electron workspace smoke |
| downloadUpdate | lib/stores/ipc.ts, lib/stores/updates.ts | `Settings.svelte` | Implemented; host/component tests and Electron workspace smoke |
| installUpdate | lib/stores/ipc.ts, lib/stores/updates.ts | `Settings.svelte` | Implemented; host/component tests and Electron workspace smoke |
| onUpdateStatus | lib/stores/ipc.ts, lib/stores/updates.ts | `Settings.svelte` | Implemented; host/component tests and Electron workspace smoke |
| saveSettings | lib/components/OptionsPanel.svelte, lib/components/Timeline.svelte | `Settings.svelte` | Implemented; host/component tests and Electron workspace smoke |
| analyzeAgent | lib/components/ThreatAnalysis.svelte | `Analysis.svelte` | Implemented; host/component tests and Electron workspace smoke |
| analyzeSession | lib/components/ThreatAnalysis.svelte | `Analysis.svelte` | Implemented; host/component tests and Electron workspace smoke |
| openThreatReport | lib/components/ThreatAnalysis.svelte, lib/utils/threat-report.js | `Analysis.svelte` | Implemented; host/component tests and Electron workspace smoke |
| getAllPermissions | lib/components/RulesTab.svelte | `Rules.svelte` | Implemented; host/component tests and Electron workspace smoke |
| saveAgentPermissions | lib/components/PermissionsGrid.svelte, lib/components/RulesTab.svelte | `Rules.svelte` | Implemented; host/component tests and Electron workspace smoke |
| saveInstancePermissions | lib/components/PermissionsGrid.svelte | `Rules.svelte` | Implemented; host/component tests and Electron workspace smoke |
| resetPermissionsToDefaults | lib/components/RulesTab.svelte | `Rules.svelte` | Implemented; host/component tests and Electron workspace smoke |
| onFileAccess | lib/stores/ipc.ts | `host.ts` | Implemented; host/component tests and Electron workspace smoke |
| onStatsUpdate | lib/stores/ipc.ts | `host.ts` | Implemented; host/component tests and Electron workspace smoke |
| onNetworkUpdate | lib/stores/ipc.ts | `host.ts` | Implemented; host/component tests and Electron workspace smoke |
| onToggleTheme | App.svelte | `App.svelte` | Implemented; host/component tests and Electron workspace smoke |
| getAgentDatabase | lib/components/AgentDatabaseCrud.svelte | `Catalog.svelte` | Implemented; host/component tests and Electron workspace smoke |
| killProcess | App.svelte, lib/components/AgentCard.svelte, lib/components/PidList.svelte, lib/stores/ipc.ts | `Details.svelte` | Implemented; host/component tests and Electron workspace smoke |
| suspendProcess | App.svelte, lib/components/AgentCard.svelte, lib/components/PidList.svelte, lib/stores/ipc.ts | `Details.svelte` | Implemented; host/component tests and Electron workspace smoke |
| resumeProcess | lib/components/AgentCard.svelte, lib/components/PidList.svelte, lib/stores/ipc.ts | `Details.svelte` | Implemented; host/component tests and Electron workspace smoke |
| getCustomAgents | lib/components/AgentDatabaseCrud.svelte | `Catalog.svelte` | Implemented; host/component tests and Electron workspace smoke |
| saveCustomAgents | lib/components/AgentDatabaseCrud.svelte | `Catalog.svelte` | Implemented; host/component tests and Electron workspace smoke |
| exportAgentDatabase | App.svelte, lib/components/AgentDatabaseCrud.svelte | `Catalog.svelte` | Implemented; host/component tests and Electron workspace smoke |
| importAgentDatabase | lib/components/AgentDatabaseCrud.svelte | `Catalog.svelte` | Implemented; host/component tests and Electron workspace smoke |
| getAuditStats | lib/components/AuditLog.svelte, lib/stores/ipc.ts | `Reports.svelte` | Implemented; host/component tests and Electron workspace smoke |
| getAuditEntriesBefore | lib/components/Timeline.svelte, lib/stores/ipc.ts | `Reports.svelte` | Implemented; host/component tests and Electron workspace smoke |
| openAuditLogDir | lib/components/AuditLog.svelte | `Reports.svelte` | Implemented; host/component tests and Electron workspace smoke |
| exportFullAudit | App.svelte, lib/components/AuditLog.svelte | `Reports.svelte` | Implemented; host/component tests and Electron workspace smoke |
| testNotification | lib/components/SettingsMonitoring.svelte | `Settings.svelte` | Implemented; host/component tests and Electron workspace smoke |
| exportConfig | App.svelte, lib/components/OptionsPanel.svelte | `Settings.svelte` | Implemented; host/component tests and Electron workspace smoke |
| importConfig | lib/components/OptionsPanel.svelte | `Settings.svelte` | Implemented; host/component tests and Electron workspace smoke |
| revealInExplorer | lib/components/ActivityFeed.svelte, lib/components/GroupedFeedItem.svelte | `Details.svelte` | Implemented; host/component tests and Electron workspace smoke |
| getAppVersion | lib/components/Footer.svelte | `App.svelte` | Implemented; host/component tests and Electron workspace smoke |
| exportZip | App.svelte, lib/components/ReportsTab.svelte | `Reports.svelte` | Implemented; host/component tests and Electron workspace smoke |
| getFalsePositives | lib/stores/ipc.ts | `host.ts` | Implemented; host/component tests and Electron workspace smoke |
| addFalsePositive | lib/components/ActivityFeed.svelte, lib/components/AgentCardDetails.svelte | `Details.svelte` | Implemented; host/component tests and Electron workspace smoke |
| openExternalUrl | lib/components/AgentDatabaseCrud.svelte | `Catalog.svelte` | Implemented; host/component tests and Electron workspace smoke |
| getRules | preload only | `Rules.svelte` | Implemented; host/component tests and Electron workspace smoke |
| reloadRules | preload only | `Rules.svelte` | Implemented; host/component tests and Electron workspace smoke |
| onRulesReloaded | preload only | `Rules.svelte` | Implemented; host/component tests and Electron workspace smoke |
| onScanBatch | lib/stores/ipc.ts | `host.ts` | Implemented; host/component tests and Electron workspace smoke |
| onScanStatus | lib/stores/ipc.ts | `host.ts` | Implemented; host/component tests and Electron workspace smoke |
| onAgentResourceUsage | lib/stores/ipc.ts | `host.ts` | Implemented; host/component tests and Electron workspace smoke |
| onTokenCosts | lib/stores/ipc.ts | `host.ts` | Implemented; host/component tests and Electron workspace smoke |
| blocklistAdd | lib/components/AgentActions.svelte, lib/stores/ipc.ts | `Details.svelte` | Implemented; host/component tests and Electron workspace smoke |
| blocklistRemove | preload only | `Details.svelte` | Implemented; host/component tests and Electron workspace smoke |
| blocklistList | preload only | `Details.svelte` | Implemented; host/component tests and Electron workspace smoke |

## Bugs found during integration

- Existing stop confirmation stores a PID without re-resolving instance identity on confirmation. New actions must retain stamped identity and reject stale/outage targets.
- Existing seed reads can overwrite newer push data and have no teardown; new lifecycle must guard late reads and unsubscribe.
- RulesTab treats the getAllPermissions envelope as the permissions map; adapter must unwrap both agent and project scopes.
- Existing catalog import only changes the displayed list, without persisting imported custom agents. New import must validate and save before reporting success.

## Limitations

Nothing here certifies live provider, installer, non-Windows platforms or release readiness yet.

## Payload contracts

- Read-only getters take no parameters. on* subscriptions return teardown functions. Seven telemetry subscriptions are owned by host.ts; theme, rules and updates are owned by their mounted consumers.
- saveSettings sends the latest settings merged with editable fields. Provider key editing is confined to Analysis. Config exports omit the key; imports without a key preserve the configured key.
- Process commands send `{pid, instanceId}`. Renderer re-resolves after confirmation; main requires an OS stamp in the latest reliable population. Legacy numeric payloads remain compatible. The final OS call remains PID-based, so this does not claim an atomic OS identity guarantee.
- Permission save uses the complete defaults/project map or `{agentName, parentEditor, cwd, permissions}`. Saved project overrides are shared by processes with the same durable context.
- Catalog saves a validated custom-agent array, preserving bundled entries. Import returns `{success, agents}` and is persisted before success is displayed.
- analyzeAgent takes a name (all matching instances), analyzeSession takes no arguments. openThreatReport takes structured fields and captured counts. Provider calls require explicit user action.
- getAuditEntriesBefore takes `(ISO timestamp, limit, types?, boundaryOffset?)`. The optional offset includes timestamp ties and skips already consumed boundary records; omitted retains the legacy exclusive contract. Both SQLite and JSONL fallback are tested.
- Watchlist entries use `{signature, pid?, reason?}`; these raise alerts and do not block execution. False positives use `{agentName, pattern, timestamp}` and trigger a guarded reread.
- Export and reveal commands require confirmed native results; cancellation is displayed as incomplete. Path metadata is displayed without reading secret file contents.

## Regression migration

Pure renderer/store and backend tests remain. Tests coupled to deleted visual components (old ring geometry, skeletons, timelines, grouped cards and theme styles) were retired with those components. Observatory.test.js, ObservatoryEvidence.test.js, observatory-host.test.js and observatory-activity.test.js cover their retained contracts: stamped selection, missing/zero measurements, attribution, skill labels, quiet population churn, anomaly threshold, effective sensors, filter reset/pause, permission persistence, failed saves, audit ties, imports, key isolation and update actions. Browser checks cover fixture exclusion, shared components, navigation, dialog and layout.

Additional fixes: permission drafts survive new scans; null identities cannot select another unknown process or claim its resources; token-only samples remain visible; cumulative AEGIS CPU counters become rates; no snapshot delivery marks retained observations stale; native folder failures are no longer reported as success.

## Validation results — 2026-09-09

- npm ci completed in an independent dependency directory. package-lock.json unchanged. A junction was suitable for initial checks but omitted transitive dependencies during packaging; it was detached without changing the original installation.
- All 10 verification commands passed: renderer build, formatting, lint (warnings remain), TypeScript, Svelte, coverage, witness gate, sequence gate, counts and production dependency audit. Latest suite: 2851 passed, 4 skipped, 155 test files. No coverage threshold was lowered.
- Browser: 132 view/viewport/theme/scale combinations, dialog/escape, production fixture exclusion, preview isolation. Dev preview loaded on an alternate local port because the prepared preview owns 8770.
- Headless preview frame sample: 90 requestAnimationFrame intervals, median 16.7 ms, p95 16.8 ms, four fixture agents at 1200x800. This is a narrow rendering measurement, not a whole-app throughput guarantee.
- Electron and packaged executable: all 11 workspaces; reliable live process population separately verified in the visible renderer; six export handlers; settings persisted after restart; config import preserved the local key and exported config omitted it. contextIsolation and sandbox true; nodeIntegration false.
- Windows x64 NSIS installer built locally with publication disabled. Version remains 0.14.1-alpha; this artifact is a local integration candidate, not a new published release.

## Changed-path security review

Host text renders through Svelte text bindings; metadata removes key/secret fields recursively. No dynamic HTML or evaluation was added. Production CSP disables renderer network connections; native external URLs remain HTTP/HTTPS checked. Native operations now await the shell result. Process controls validate the stamped target in renderer and main; the retained numeric compatibility path and final PID-based syscall are known boundaries, not an atomic OS identity guarantee.

Configuration writes now replace the destination from a sibling temporary file; failed writes restore in-memory settings and propagate to the renderer for settings, project permissions, catalog and false-positive changes. Fault-injection tests confirm the previous disk file and in-memory state remain unchanged. Configuration exports also omit encrypted/legacy key fields. No real provider key was used in testing; the isolated profile contains a nonfunctional sentinel.

## Remaining release verification

Live paid Anthropic requests and non-Windows runtime behavior were not exercised. Native picker choices were supplied by the Electron harness while real export/import handlers and disk output ran; OS picker interaction and installer install/uninstall were not automated against the user's existing installation. Publishing/tagging/version selection remains a separate user action. Local profiles, logs, exports, screenshots and installer output stay under ignored dist/ and are excluded from the PR.
