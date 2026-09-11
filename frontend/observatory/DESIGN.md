# AEGIS Observatory

The approved visual source is preserved in reference/ui/ and reference/DESIGN.md. Its full stylesheet set is imported in styles.ts. The earlier Shield/Fancy UI designs and the superseded integration layouts have no design authority.

Preserve the template's composition, hierarchy, spacing, typography, artwork, controls, radar and dialogs while connecting real telemetry through runtime/host.ts. Runtime behavior is implemented in Svelte; simulated observations must never enter a desktop build.

Live-data adaptations:
- The requested workspace comfort pass groups navigation into Observe, Investigate, Assess and Configure. Workspace destinations appear once in the sidebar; Back/Forward lives in the top toolbar, and mounted drafts and history are preserved. Search opens workspaces and specific statistics, settings, audit and export sections. Sensor entry points share the Statistics sensor view. Only live workspaces show observation controls. styles/comfort.css adds this adaptation after the original cascade.
- Statistics provides agent/process selection, a metric rail with values and one focused graph, observed-sample selection, bounded history, token sources and sensor monitors. Performance, Activity and Tokens own distinct metrics; Processes owns comparison/table views and Sensors shows AEGIS itself. The repeated risk radar, distributions, activity histogram and miniature rail graphs were removed in the requested usability pass. Gaps, incomplete identity coverage, counter resets and pause stay explicit. These charts use delivered agent/AEGIS measurements, never invented system-wide GPU, disk or bandwidth values.
- Settings, reports, audit and agent tables use internal sections. Save/discard stays near settings; policy drafts survive target changes. Events keep search/grouping visible and group extra filters. Activity/record dialogs add search and accurate remaining-record counts.
- Detail windows now use the requested internal tabs: overview, individual processes, retained activity, attributes and process controls as applicable. Observation groups open their records; catalog and provider editors separate general/connection inputs from recognition/usage. Each section uses the same named fields, cards and persistent header/footer. Raw JSON is replaced with readable attributes and nested disclosures; secret-bearing fields are excluded. Back/Forward preserves the section, search, expanded list, scroll and focus. These requested changes are implemented in styles/detail-layout.css after the preserved cascade.
- Recognized application directories and skill roots name resource context even when no accessor was recorded. Path context never supplies actor attribution or process control identity. Events, Network, audit history and HTML reports share resource/agent grouping with counts and access to every original record; session summaries roll up processes by product.
- `styles/coherence.css` unifies panel, control, badge and table presentation after the approved cascade. Shared observation components keep resource names, paths and evidence consistent across views. Exported HTML uses the same neutral Observatory surfaces with light, dark and print support.
- Requested motion feedback uses a visible radar sweep and marker echoes, hover/press response, a sliding layer indicator, keyed agent-detail reveals, native disclosure animation and dialog/workspace transitions. Marker centers stay on their risk coordinates. Telemetry updates do not replay selection animations. Live motion stops for pause/stale observations; app and system reduced-motion preferences stop motion. The Animations setting previews immediately and supports discard. `styles/feedback.css` adds this behavior after the preserved template styles.
- The requested radar clarity pass replaces repeated side charts and long in-circle labels with compact numbered markers and one roster. Selected-agent details form a separate panel; process selection is expandable. The monitoring screen has separate summary cards and one activity chart; per-agent resource bars remain in Statistics. `styles/radar-clarity.css` records this intentional refinement after the preserved template cascade.
- Radar, agent tables and resource charts group processes by agent identity. Radar pages four groups at a time. Product rows open an overview; its process list and the radar instance selector open explicitly chosen stamped processes. Distance represents risk, as in the template.
- Resource group totals require every member to be measured; token totals in Monitoring and Statistics may show a measured subtotal only with explicit coverage; risk is the highest member score, Files counts distinct retained paths with Windows case/slash normalization, and Network counts observed connections. Product grouping never supplies a process action identity.
- High contrast keeps the template's neutral surfaces and strengthens text, focus and interactive boundaries. The toolbar theme toggle returns to ordinary light/dark, matching the template; high contrast is selected explicitly in Settings.
- An unavailable measurement is shown as a dash. Sensor outages pause the sweep and disable process control.
- API configuration and analysis controls reflect supported host capabilities. A retained report is labeled with its actual evidence scope.
- Settings and policy drafts survive view navigation; failed saves retain inputs. Unsaved provider keys are cleared when their dialog or workspace closes.
- The toolbar pauses displayed telemetry while the monitoring backend continues. Process commands always validate the current live population.
- Process activity groups retained files and connections with access to each observation. Evidence has its own Attributes tab; resource delivery diagnostics use named expandable fields.

Visual verification uses the preserved source at the same viewport, scale, theme and state. Passing tests alone must not be reported as proof that the interface matches the template.

Graph correctness: resource collection sequences/times govern CPU/RAM history, with cache replay suppressed and mixed collection age spans visible; other telemetry uses source-specific receipt clocks. Resource, token, network and own-process updates never provide denominators for another source. Charts use fixed one/three/five-minute windows, visible measured subtotals and coverage, explicit missing-data breaks, and actual-point inspection. Histograms age by wall time and freeze with the view. Source delivery and collector completion timestamps are not exact OS measurement timestamps. Backwards wall-clock changes reset history and rate baselines.

Duplicate clarity: Statistics Processes separates Comparison and Table in internal tabs. Resource groups combine actions and classifications while retaining every original observation and displaying mixed evidence. Radar resource counts distinguish destinations from owner links; grouped socket records show local endpoints. Reports labels retained sensitive observations explicitly.

Risk clarity: the summary opens the highest-risk agent, the inspector and agent rows show its leading scoring factor, and Risk explanation is an internal detail tab. Its main factor is visible at the supported minimum viewport/scale; the full contribution list follows below. Product scores follow the highest process, with a direct link to that worker. Captured process assessments keep the factors and saved adjustment used by the displayed score; limited identity coverage and stale snapshots remain explicit.

Usability: Monitoring inspector and Agents rows open Statistics with the selected agent in one action. A process filter uses stamped instanceId; a departed selection remains selected and explicitly unavailable. Scoped history begins on a changed selection; all-agent and sensor histories continue independently. Per-agent file rates are unavailable because only global cumulative counters are supplied. Radar layers reserve equal stage/toolbar geometry, the inspector scrolls within stable bounds, and selection does not resize neighboring panels. Statistics retains the metric rail beside the graph throughout the supported desktop range. View-transition groups do not interpolate geometry; content fades/slides still honor reduced motion.

## Agent-centred workspace — 10 September 2026

The user's current request supersedes the earlier agent/process modal-tab workflow, the always-present radar inspector, and the duplicated overview Timeline described above. The approved Observatory hierarchy, artwork, neutral surfaces, semantic risk colours and Segoe UI typography remain the visual foundation. This refinement changes information organisation; the reference snapshot does not require restoring superseded navigation.

App owns one visible `{ agent, instanceId }` scope across Monitoring, Agents, Events, Network and Statistics. An empty agent means all agents; an empty process identity means all processes of the chosen product. Selection survives workspace navigation and process departure. Clearing it is an explicit All agents action. This is in-session state, without an implied persistence guarantee across app restarts.

Choosing an agent opens AgentWorkspace inline: observed status, risk and its leading reason with an expandable explanation, one resource chart with metric selection, retained file/network evidence, and worker processes. Section links scroll within this page. Exact-process attributes and controls use a disclosure. Detailed Statistics keeps the shared scope, hides duplicate local selectors, and preserves its current section when scope changes. Sensors remains global.

The global overview keeps summary cards, the radar as an agent entry point, one activity chart and recent evidence. The main App does not show an empty inspector or mount the duplicate Timeline. Modal evidence details support bounded record inspection and actions; they are no longer the primary agent investigation workspace. Related-process navigation returns to the inline agent scope.

Missing-data language identifies the missing fact: actor, endpoint verification, working directory, process start time or measurement. Resource context never supplies ownership. Retained evidence uses recorded ownership or exact stamped identities, without PID/path fallback; explicitly unattributed and self-access rows remain outside selected-agent evidence. Unstable `:u` and synthetic identities cannot select a real process. A departed exact selection remains selected, its retained activity stays available, and current measurements remain unavailable.

Retain native select behaviour, visible focus, modifier-safe shortcuts, ARIA tab relationships and reduced-motion support. Check the reference sizes, supported scales, themes, pauses, outages, partial coverage, long content and PID reuse. Component tests alone do not establish visual or native-window quality; screenshots and isolated Electron verification must be recorded separately. Research, before/after flows, evidence boundaries and the QA matrix are in [AGENT-WORKSPACE-UX.md](../../docs/current-state/AGENT-WORKSPACE-UX.md).

## Monitoring and sizing correction

Monitoring always shows the global population, summary, radar and activity. It never renders AgentWorkspace or an agent filter. Choosing an agent opens Agents; the retained selection continues across Agents, Events, Network and Statistics. Returning to Monitoring does not erase that investigation. A global summary link opens its destination with the all-agent scope so its count and destination agree. This supersedes the earlier inclusion of Monitoring in the shared selected-agent scope.

The shared sizing contract lives in styles/coherence.css: 4/8/12/16/24 px spacing, 16 px panel inset, 12 px panel radius, 8 px control radius, 32 px controls at 100% scale. Caption/body/section/metric text uses 11/12/14/26 px at 100%. Text and control height follow the UI scale; spacing remains the same density grid. Input, select and ordinary action buttons use the same height and typography across pages and dialogs. Textareas, icon buttons, native ranges/checkboxes and multiline record rows retain their semantic sizing. Graph labels and metric rails must also respect the scale. Do not add local pixel substitutes for these roles.

## Stationary interaction correction

The user's feedback supersedes the earlier sliding workspace/detail snapshots, control press scaling, hover lifts and animated disclosure height. Workspace navigation now commits directly, with scroll restoration in the same Svelte update; Back/Forward still restores each workspace. Ordinary selection, tabs and process filters never translate or scale controls or reading surfaces. Changing the shared scope retains the current scroll position; explicitly opening an agent starts its overview at the top. Section keyboard navigation scrolls only its horizontal tab strip. Editor sections capture scroll before the DOM changes.

Feedback uses 140 ms colour/border changes and a 120 ms opacity-only dialog/entity reveal. Native disclosures resize once without height interpolation. Busy indicators do not change button width. Radar sweep, coordinate echoes and pending indicators remain subject to pause/stale and both reduced-motion settings. Verify full-motion interactions as well as reduced motion; disabling animation in tests must not conceal geometry or scroll regressions.


## Renderer workload

Host deliveries are immutable snapshots held with `$state.raw`; charts also receive immutable history arrays without deep proxying. Draft forms retain their ordinary reactive state. Consumers share an exposure assessment for one snapshot and invalidate it when source references change. Weak snapshot keys do not keep departed observations alive. A held snapshot preserves its captured assessment; new deliveries recalculate event age and evidence. Clock labels share two Intl formatters, refreshed at least once a minute or after a backwards clock change to pick up default locale/time-zone changes. Composition, motion preferences, history retention, selection and measurement provenance remain governed by the sections above.

The identical-input comparison and its limits are recorded in [RENDERER-WORKLOAD.md](../../docs/current-state/RENDERER-WORKLOAD.md).


### Agent section tabs (2026-09-10)

Risk, Resources, Activity and Processes switch one local panel beneath the shared
agent context. This supersedes the earlier in-page section links. Clicking a tab
never scrolls the workspace or focuses its contents; arrow keys move between tabs.
Inactive panels stay mounted and hidden, preserving resource history and metric
selection. Exact-process attributes and controls belong to Processes. Requested
risk/process sections select their panel; the default overview opens Risk.


### Observation pagination (2026-09-10)

Events and Network keep page controls above the evidence table. Changing pages
updates rows without scrolling to a record or moving focus away from the control.
Unavailable directions use aria-disabled and a guarded handler so reaching the
first or last page does not remove keyboard focus. Filter changes still reset to
the first page; grouping and exact process attribution remain unchanged.


### Monitoring activity correction (2026-09-11)

Activity and Recent events are separate panels with the shared 16 px gap.
Hovering or keyboard-focusing a histogram interval holds its time window until
inspection ends, so its boundaries and opened observations agree. The readout
reserves two lines to prevent adjacent content from moving. Idle live windows
still advance; paused/stale windows remain frozen. An agent whose retained events
expire stays explicitly selected until the user changes that filter.


### Settings workspace refinement (2026-09-11)

Settings retain four persistent sections and their draft while presenting each
purpose as a labelled group with a description and consistent setting rows.
Appearance previews are explicit; scale and scan interval offer precise numeric
entry and presets without automatically saving. Invalid numbers block Save.
Startup explains restart-sensitive options, update states use readable labels,
and failed initial settings reads can be retried. The shared save/discard bar
stays reachable with a distinct primary action and saving/reloading status.
Provider credentials remain outside the generic settings form and exports.

### Protection overview (2026-09-11)

The user's request to make protection understandable supersedes the previous
radar-first landing composition. Monitoring starts with a compact review count,
observed agents, and the explicit absence of automatic access blocking. A bounded,
searchable activity list combines retained file events with the latest connection
snapshot and puts review flags first. Repeated records retain separate process
lifetimes, actions and attribution evidence.

Selecting activity opens its path or endpoint, explanation, current saved policy
and links to evidence, the exact policy context and existing process controls.
Unknown destinations, inferred ownership and open handles keep their uncertainty.
Saved allow/block values are preferences; the backend does not enforce them.
Failed policy reads show unavailable data; successful saves invalidate the overview.
Process navigation uses the current population even while the displayed activity
is paused. Selected evidence survives retention changes with an explicit label.

Detailed monitoring retains the radar and charts and is mounted on demand. The
default activity model reuses immutable deliveries across resource-only updates.
The introductory help, native controls, focus return and responsive detail panel
support keyboard use and larger text. Existing theme tokens and template files
remain the visual base. Browser checks cover the new default and explicitly open
detailed monitoring when checking the preserved radar layout.


### Radar resource exploration (2026-09-11)

The user's request to substantially improve Files and Network supersedes the
previous two-resource overlay and immediate navigation on radar selection.
Risk markers and roster rows now focus locally, with a leading risk reason and
explicit links to files, connections and the agent workspace. The risk circle
retains its measured score positioning.

Files and Network each show a searchable resource catalog and a selected-resource
relationship view. All radar pages, historical observations, own-file activity
and unattributed resources remain available. Filters apply to summary counts;
resource and relationship pagination bound the visible content. The responsive
layout uses adjacent columns or stacked panels without absolute-positioned cards.

Every resource retains all source records. Relationships separate process
lifetimes and attribution evidence. Solid lines mean confirmed ownership; dashed
lines mean indirect, ambiguous or legacy attribution. Unknown actors have no line.
These static links never imply actual data transfer. A connection is not proof of
its payload, an open handle is not proof of a read, and an endpoint allowlist is
not access enforcement. Unknown destinations remain distinct from review flags.

Selection survives layer changes and retention updates with explicit labels.
Process navigation resolves against the unique current lifetime, including while
the displayed view is paused. A stale or missing population disables navigation.
Filters preserve focus; choosing a resource focuses its detail heading. Visited
layers retain state, and unchanged observation arrays reuse the resource model.
All new styling remains scoped; the preserved reference and cascade are unchanged.

### Radar selection spacing (2026-09-11)

The selected roster row uses its background and a uniform border, without an
inset stripe beside the ordinal. Horizontal padding keeps the number away from
the edge. The radar toolbar grows with wrapped text and has no inner scrollbar.
The viewport/theme/scale checks cover toolbar overflow and ordinal clearance.
