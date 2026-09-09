# Observatory integration

The earlier integrations passed functional gates but did not preserve the reviewed template closely enough. Their validation below is historical evidence, not visual approval of the current interface.

## Interaction motion follow-up — 2026-09-09

The requested feedback pass adds hover/press response to controls and agent rows, a sliding radar layer indicator, visible sweep/marker echoes, keyed detail reveals, native process disclosure transitions and dialog entrance. Marker scaling preserves its risk coordinate. Telemetry refreshes do not replay selection animation. Pause, stale observations and reduced-motion preferences stop their corresponding motion; the Animations setting previews immediately and discard restores the saved choice.

Rapid workspace navigation now keeps the last requested view and its history direction. Skipping an obsolete View Transition consumes its expected readiness rejection while leaving DOM update failures observable. Browser regression checks exercise sweep movement, stable marker centers, hover/press feedback, dialog selection, interrupted navigation, app/system reduced motion, pause/resume and persisted preferences.

Validation: all ten repository checks passed, with 2866 tests passed and 4 skipped across 160 files; lint has 75 warnings and no errors. Both renderer entries built, and 264 browser view/theme/scale combinations plus the motion interaction checks passed. The packaged Windows app exercised 24 observed processes, eleven workspaces, settings restart and six exports. All 114 packaged renderer files match the final build byte for byte. Native macOS/Linux and paid provider calls remain untested.

The deployed Windows copy was also exercised with the existing user profile and three real agent groups. Motion was enabled, the system reduced-motion preference was off, the sweep advanced and settings remained unchanged. An interaction video is retained in ignored dist/motion-live-qa/. No renderer errors were observed during that recording.

## Radar clarity follow-up — 2026-09-09

The requested refinement removes repeated product labels and side charts from Monitoring. Compact numbered radar markers map to one agent roster; the selected group's risk, combined usage and latest activity occupy a separate panel. Individual processes are expandable and retain their stamped identities. Summary cards have separate boundaries, and per-agent resource bars remain in Statistics. Closing a detail dialog with Escape preserves the radar selection.

The original twelve reference stylesheets remain unchanged; the intentional refinement lives in styles/radar-clarity.css. Browser checks cover marker collisions, roster alignment, collapsed process controls and dialog selection across 264 view/theme/scale combinations. Additional narrow-window checks include 900 px at 150% scale. The coverage suite passed 2866 tests with 4 skipped across 160 files. The packaged Windows app passed eleven workspaces with 25 observed processes, unique radar groups, settings restart and six exports. All 114 packaged renderer files match the final build. The deployed app displayed three unique agent groups without overlapping markers or labels; settings remained unchanged. These checks verify behavior and geometry; they do not constitute user visual approval.

## Agent grouping and theme follow-up — 2026-09-09

The radar grouped processes, but agent tables, resource bars, token summaries and activity filters still repeated product names. They now show one entry per agent. Product details expose the individual stamped processes; a group itself has no process-control target. CPU/RAM and token totals remain unknown when member measurements are incomplete, file totals count distinct retained paths, and risk is the highest member score.

High contrast retains the template's neutral surfaces and strengthens text, focus and interactive boundaries. The toolbar and keyboard theme toggles leave high contrast, matching the reference interaction. Settings follows toolbar theme changes without losing other drafts, and delayed startup settings cannot overwrite a new theme choice. The initial renderer surface is light, matching the host default; saved choices still take precedence.

Validation: 159 test files, 2864 passed and 4 skipped with coverage; both renderer builds; 264 browser viewport/theme/scale combinations including all four themes, high-contrast readability and theme persistence; repository type, Svelte, format, lint, witness, sequence and inventory checks. The packaged Windows app exercised 25 real processes, unique product rows, group details, all eleven workspaces, settings restart and six exports. All 114 packaged renderer files match the final build byte for byte. Native macOS/Linux and paid provider requests remain outside this check.

## Template restoration — 2026-09-09

Working branch: codex/observatory-template-restoration, based on 09bdc9b. The approved template is preserved in frontend/observatory/reference/; its twelve stylesheets are used directly in their source order. Superseded theme/layout styles were removed. Local project design/context skills and the UI agent instructions no longer direct work toward the retired designs.

The Svelte views now follow that source hierarchy. Live-data adaptations include grouped process markers, exact instance selection, optional resource measurements, supported provider controls, and native command errors. Detail dialogs keep fixed chrome and a scrolling body. Forms use native modal focus handling. Code and fixture hashes, layout checks and rendered comparisons are complementary evidence.

Validation:
- 157 test files: 2856 passed, 4 skipped, with coverage. The successful Windows run used two workers and temporary storage on X. An earlier parallel run hit a duplicate native watcher notification and a timeout; a later attempt exhausted C temporary storage. Neither assertion nor timeout was weakened.
- Repository build, format, lint, both TypeScript/Svelte projects, witness and sequence mutation gates, counts, and production dependency audit passed. Lint retains 77 warnings; Svelte reports zero errors and warnings.
- Both built entries passed the 132 browser combinations, captured-template hashes/cascade order, preview isolation and desktop fixture exclusion. All eleven template/desktop pairs and selected/detail/form states were rendered for review. Dialog Escape/focus, resource-route geometry, live appearance preview and discard passed.
- Real Electron and the packaged Windows executable passed eleven workspaces, reliable process population, settings restart, six native export handlers, and configuration key preservation/exclusion. No real provider request or intervention against a user process was performed.
- Windows x64 NSIS built locally with publication disabled, reusing the existing ICO derived from the unchanged application icon after the icon-conversion worker failed to allocate memory. Version remains 0.14.1-alpha. Native macOS/Linux behavior and paid provider calls were not exercised.

The desktop shortcut previously pointed to the older C installation. The local runnable copy is placed separately on X because C has almost no free space; the original shortcut is backed up before retargeting. No release tag or published version is part of this restoration.

## Earlier integration record

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
