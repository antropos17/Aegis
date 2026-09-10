# Observatory usability — 2026-09-10

The user reported distant controls, repeated charts, missing per-agent statistics and size jumps.

Workspace destinations now appear once in the sidebar; Back/Forward is in the top toolbar. Monitoring's inspector and agent rows open Statistics with that agent selected. Existing destinations, detail dialogs, drafts and navigation history remain available.

Statistics has agent and exact-process filters shared across its sections. Performance owns CPU, memory and process count; Activity owns connection counts, risk and global file rates; Tokens owns usage; Processes shows comparison or table without another timeline; Sensors always describes AEGIS. Repeated risk radar, distributions, activity histogram and miniature metric graphs were removed. The metric selector shows values beside one focused chart.

A changed selection starts a fresh scoped history. Switching sections preserves it; global/sensor history continues independently. Missing identities keep their coverage limitation. A departed selection never silently changes to all agents or a replacement PID. Current stamped identities filter resources, tokens and connections. Per-agent cumulative file counters are not exposed by the bridge; those rates are omitted instead of deriving them from bounded retained rows.

Radar layers reserve the same stage and toolbar geometry. The inspector has an independently scrollable stable height, the roster reserves its page slots, and the chart reserves measurement/coverage lines. The supported desktop layout keeps the roster alongside the radar and metric values beside the graph. View transitions no longer interpolate container geometry.

## Verification

The focused regression suite passed 53 tests. The first full suite found one test still expecting the removed workspace tabs; it was updated to exercise Back/Forward availability and dispatch. The final full run passed 3217 tests with 4 skips across 186 files. Format, lint (existing warnings), TypeScript/Svelte, both builds, both mutation gates, derived counts and the production dependency audit passed.

Browser checks passed on the initial implementation: 264 workspace, 16 risk, 48 resource-layer, 48 detail, 64 internal-section and 32 graph states. Final compact-layout checks additionally assert stable radar/inspector heights, fixed metric plot position, direct scoped navigation, selection persistence, Back and absence of horizontal overflow at 1200x800/100% and 900x600/150%, in light/dark and reduced motion.

Electron source smoke passed all 11 workspaces, isolated-profile settings restart and six exports with no renderer errors. Final compact browser checks passed 4 usability states, 32 graph states and 48 resource-layer states; screenshots were visually reviewed at the supported large/minimum sizes.\n\nThis pass does not redesign the sidebar's information architecture or remove the existing workspace destinations. It does not provide historical per-agent backfill, system-wide GPU/bandwidth telemetry, or per-agent cumulative file counters.
