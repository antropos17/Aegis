# AEGIS Observatory

## One investigation workspace — 7 October 2026

The user requests further simplification based on popular EDR workflows. Simple
uses three primary destinations: Investigate, Check files and Settings. Investigate
contains one compact agent roster, one contextual risk/response header and one
activity feed. Product selection changes the same App scope without changing
workspaces. Explicit worker selection stays next to the score and the existing
manual response actions. No product or reused PID silently becomes an action target.

Selecting a captured observation opens an evidence pane alongside the feed; full
path/address, recorded actor, action and false-alarm status remain together.
At narrow widths the pane is placed above the feed within the same workspace.
Opening it reveals and focuses the captured evidence. Closing it returns focus
after reflow to the original connected control, or to Activity if that control was
filtered away. Below 981px a native product selector replaces the roster beside
the full-width risk/actions and feed. Full technical details
remain available, and the original Advanced route registry is preserved. Ordinary
sensor state is compact in the footer; audit loss/write failure and observation
outages stay explicit. AEGIS resource diagnostics remain in Advanced/Statistics.

This user-authorized composition replaces Simple Home/Agents/Activity navigation.
It preserves Observatory artwork, typography, semantic colors, motion contracts,
exact identity, missing/stale data and captured evidence. Progressive feed mounting
does not become hard virtualization; connection snapshots are not event history.
Source references and verification ownership are in
`../../docs/development/edr-investigation-2026-10-07.md`.

## Explicit application exit — 5 October 2026

The sidebar exposes Quit AEGIS independently of workspace or sensor state.
Closing the native window continues monitoring in the tray; Desktop settings
explains this behavior. Exit uses the Observatory modal and the selected interface
language, with Cancel focused by default. Escape and the close button cancel and
restore focus to the sidebar. Confirmation alone sends the explicit true value
to the main-owned exit handler; pending requests coalesce. It uses normal app shutdown and preserves its journal
drain. Unsaved edits are explicitly discarded only after confirming exit.
Pending clicks coalesce without dropping keyboard focus. Cancellation and failure
leave the control available with fixed localized feedback; preview disables it.
The existing reference cascade, semantic tokens and stationary controls apply.

Settings stays usable without a current process snapshot. Process-outage banners
remain on observation-dependent workspaces; sensor and audit-delivery warnings
remain visible in Settings, including the loss warning before application exit.

## Live chart refinement — 5 October 2026

The user requested the visual approach of [Liveline](https://benji.org/liveline).
Statistics and the agent Resources panel share a native Svelte/SVG adaptation:
a quiet horizontal grid, light area fill, a circular endpoint, a right-side value
badge and scale, and one/three/five-minute interval buttons. The large readout
separately labels live, selected, paused, held and unavailable states. A retained
reading outside the selected interval is labelled held. The existing
Observatory surfaces, typography, colours and workspace composition apply.

Only display coordinates ease for 240 ms after an update. Readouts and hover or
keyboard inspection use exact delivered values and timestamps. Counter series
keep their discrete steps. Each missing observation splits both line and fill;
an unavailable latest reading has no live endpoint badge. Zero remains the axis
baseline, and an expanding scale takes effect immediately to retain spikes.

The frame loop ends after the transition; unrelated source deliveries with the
same observations do not restart it. Inspection, pause, stale view, app or
system reduced motion, document visibility and off-screen/hidden agent panels
stop motion. Components dispose frames and observers when removed. The history,
measurement coverage, collection-clock provenance and stamped selection contracts
continue to govern these charts. No React or additional chart dependency is used.

## Token history retention — 5 October 2026

The token source list labels the aggregate of older exited records as archived
usage and displays its compacted record count instead of a PID. The current agent
table and rates continue to use exact live identities; the archive has no process
identity and cannot contribute to those values. All live counters and 256 recent
exited rows remain individually retained. Model label omissions have an explicit
notice and do not change numeric usage, cost or uncertainty flags. This retention
does not bound the Claude Code transcript adapter's separate dedup state.

## Observation status — 1 October 2026

The sensor shortcut and Statistics sensor coverage use the same localized observation labels for startup, healthy,
limited, unavailable and unknown app health. Missing or unrecognized states stay
unknown. These labels do not confirm blocking or every sensor plane. Status text
resizing preserves the end only after the user reached it; other scroll positions
remain intentional. Layout-generated scroll events cannot clear that anchor before
the child-size observer has applied the new extent. The same compact footer,
keyboard routes and Alerts lane apply.

## Audit history and delivery reads — 30 September 2026

History pages and delivery counters settle independently. A failed first history
read remains unknown; a successful empty array has a separate empty-page message.
Later failures preserve accepted rows, cursor, boundary offset and applied Type,
along with local search and grouping. Retry repeats the captured request; a
successful filter retry aligns the visible Type with the accepted page. The
history retry control stays mounted during the pending attempt, and completion
does not move focus away from a control selected by the user.

Delivery has its own refresh. Failed reads retain previous counters with explicit
feedback, while both stored and current byte sizes become unknown. Uninitialized
counter defaults are not observations; unavailable storage does not erase valid
independent delivery counters. Fixed English and Portuguese feedback omits host
error text. The preview explicitly simulates readable empty storage. Existing
section tabs, filters, observation groups and metadata remain the visual basis;
these read states do not establish writeability or hash-chain integrity.
The Type selector has a short localized accessible name. Internal storage-read
codes stay in the host contract; the interface uses the localized storage notice
and measured bytes instead of duplicating the code in delivery metadata.

## Rules persistence and readback — 30 September 2026

Permissions and detection rules load independently. Each section distinguishes
loading, a completed empty result and unavailable data, retains its last loaded
values after a failed read, and offers a read-only retry. Explicit failure replies
and malformed permission or rule populations remain unavailable.

A confirmed permission write updates the submitted target's saved baseline,
including while another target is selected. The following readback has separate
feedback: an unavailable or differing policy preserves local drafts and explains
what could not be confirmed. Edits made during the write remain unsaved. A default
reset clears drafts only when the fresh saved policy matches the reset reply;
missing, differing or failed readback retains them. Late reads from an earlier
generation and replies after unmount cannot replace current state.

Production and preview reset replies carry explicit success after their save
completes. English and Portuguese share these states and retain the explanation
that saved preferences do not activate automatic file or network blocking. The
existing permission rows, target controls and rule table composition remain.

## Action and returned-result workflow — 30 September 2026

Action control starts with task links and configuration controls before route
guides. Explicit focus jumps reveal configuration and live observation; the
returned-files link opens the existing Local security destination. Its comparison
import action stays above retained content. Search, type filters, matching and
selected counts, and 20-row pages keep inspection manageable. The selection draft
is visibly local and unapproved; a changed capture resets it. A rejected retained
ID labels the displayed capture unavailable. Confirmed clear releases main-owned
retention and returns focus to import, preserving the input artifact and project.
Native controls, scoped semantic-token styles, original reference artwork and
stylesheet order remain the visual basis. Launch and project export stay unavailable.

## AppContainer executable preflight — 27 September 2026

The captured AppContainer check shows a fixed, path-free executable metadata
observation in technical details. A known script wrapper or a file above the
128 MiB limit receives a specific next step before any CLI launch; the policy
decision stays separate. A timed-out metadata read keeps a completed policy
decision and labels the executable observation unavailable. The preview marks
metadata not checked because it reads no selected file. The existing neutral
panel, native disclosure and English/Portuguese copy remain in place; no row
claims ACL access, executable compatibility or verified isolation.

## Sensitive activity review — 27 September 2026

A fixed Alerts entry opens a bounded review list of recent sensitive file
observations. Main stores up to 100 private summaries and review decisions under
userData, keyed by a random event UUID. A new observation of the same path starts
unreviewed. Restored summaries remain reviewable; full evidence and process controls
require a live event in this window. New deliveries show a brief bottom toast with
a basename and qualified source attribution; initial retained events enter quietly.
The review panel uses the Observatory's
neutral surface, semantic alert border, stationary controls and native focus
order. Escape closes it and returns focus to Alerts. Captured live evidence remains
inspectable after a row is marked reviewed. A failed save leaves it open; no review decision is shown as
file isolation, access blocking or selected-action approval. Settings identifies
its Notifications toggle as desktop-popup only.

## Process scan cadence — 27 September 2026

The Agent processes sensor card shows a historical count of scheduled process
scans skipped while an earlier scan was still running, with the last skip time.
The count is scoped to the app's monitoring session and remains visible after
later successful scans or a pause. Its neutral note explains that agent changes
may have appeared late during those overruns. It is separate from the sensor's
provider health and observed event-loss counters; a skipped interval does not
prove that a particular event was lost.

## Monitoring event retention — 27 September 2026

The overview's minute count names only file observations still retained in the
renderer display history. When the 500-row display window evicts delivered
observations, the same card names the cumulative display-history eviction count
for this renderer window. The count does not infer which evictions happened within the
last minute and does not describe audit-log loss.

## Rules, permissions and sensor clarity — 27 September 2026

Permission targets use aligned fields and the save row follows the category rows
without covering them. Each file-path detection rule has an accessible individual
on/off control. A confirmed change persists in settings and updates the live rule;
failed saves restore the control. Rule states survive YAML reloads. The interface
explains that other sensors and detections continue.

Observation sensor cards pair each sensor with a relevant existing icon, a distinct
name and a short purpose line. Status and measured counters remain separate; known
diagnostic codes receive readable labels. Agent catalog search/filter controls and
catalog actions form two wrapping groups, with creation visually primary.

## Catalog process-signature ownership — 26 September 2026

The Agent catalog shows which earlier entry owns a case-insensitive process
signature. Bundled agents come first; saved custom agents follow in catalog order.
The static comparison mirrors the scanner's first-owner rule and keeps existing
duplicate-ID visibility. A row names its first conflicting signatures and owners;
agent details list every conflict. The add/edit recognition pane previews conflicts,
including imported signatures retained behind the editable first name. Saving
remains available; any unique signatures can still identify the entry.
These messages describe catalog precedence, not a live process observation or
change to detection, policy, or IPC. The existing neutral table and detail
composition remain in place, with scoped wrapping for long signatures.

## Route evidence summary — 26 September 2026

When a check or route observation is available, Action control shows three
separate evidence rows: selected inputs checked, a live MCP owner observed, and
a selected tool call reaching that owner. Each row uses the captured check or
the current observation generation that actually supplies it. Matching route and
selection labels do not bind checked files to a running owner. A lost or stopped
connection retains its last snapshot as past evidence, without a live label.
Selected-file deletion has no matching configuration preflight in this workspace;
its operation report must be inspected separately. A reached owner can answer ask
or deny, so the summary makes no execution, deletion or blocking claim. Client
identity remains self-reported, and other tools and descendants are outside this
evidence. The neutral panel, responsive rows and existing translation system are
used without changing the approved reference cascade.

## Selected-file deletion setup — 26 September 2026

Start here lists a dedicated online guide for the terminal-owned exact-file MCP
deletion route. Action control points to the same fixed documentation URL next to
its executable/catalog configuration check and states that the check does not
assess deletion or establish automatic blocking or general coverage. The desktop
host reports whether opening the guide succeeded; simulated preview disables the
external action. The signpost uses a native button, scoped neutral styles and the
existing guide feedback language.

## Catalog and action-check clarity — 26 September 2026

Catalog risk profile is labeled as saved metadata in the table, editor and detail.
Its table badge is neutral; the profile does not state current behavior or safety.
Captured catalog checks show allow, ask, deny and invalid-configuration counts,
with unavailable rows counted separately as not assessed. Ask, deny and invalid
rows expose their check reason directly. Counts and reasons remain tied to the
captured check, separate from live route observation and the editable setup.

## Session-only file review — 26 September 2026

Flagged retained file groups can be marked reviewed in the selected evidence panel.
All activity keeps those groups with a visible session-review label, while the
Needs review count and filter exclude them. A new file row in the same group
restores the review flag even when its timestamp and group size are unchanged.
Review state exists only while this overview is mounted and retains row identity
weakly; absent groups are pruned. Network groups have no review control because
their observation identity is not stable. This changes no saved policy or sensor.

## Dashboard reference audit — 19 September 2026

The supplied “AEGIS — идеальный дашборд” boards inform a focused protection-overview
polish. The default radar and workspace destinations remain as documented below.
The overview uses the shared body/section tokens, a compact wrapping summary and
filter counts with accessible descriptions. At short window heights the redundant
intro is omitted; observation scope and the absence of automatic access blocking
remain visible. At wide widths selected evidence receives more space than the list;
smaller windows retain the single-column reading order. Evidence time, record count
and the held-handle limitation are visible before disclosures. Evidence/process
actions precede saved policy preferences. No telemetry, attribution, permissions
or review persistence contract changes. The comparison and measured checks are in
[DASHBOARD-DESIGN-AUDIT.md](../../docs/current-state/DASHBOARD-DESIGN-AUDIT.md).

Closing selected evidence restores keyboard focus after the activity grid has
reflowed and reveals the originating row below the sticky page heading. If that
row was removed or filtered out, the activity region receives focus instead.
This programmatic fallback adds no extra Tab stop; hidden workspaces do not
receive deferred focus.

## Desktop icon and tray menu — 19 September 2026

The app and tray icons reuse the neutral installer shield; the tray retains a
semantic status marker. Its menu opens AEGIS, pauses/resumes monitoring, opens
Settings or quits through the existing lifecycle. Settings uses retained navigation
and focus behavior. The menu has no process intervention or provider action.
## Live route observation — 19 September 2026

Action control starts with a separate live-observation panel using the existing
neutral panel, native buttons, spacing and typography. It presents the current
evidence state before counters, keeps last receipt time and self-reported identity
limits visible, and retains the final evidence on loss. A polite region announces
state changes without announcing every heartbeat. Preview disables attachment
and explicitly explains its desktop-only availability. Stop observing affects
only the observation connection. Configuration results and setup stay separate.

## Icon and interaction audit — 19 September 2026

The requested audit replaces ambiguous repeated navigation symbols with fourteen
distinct, curated Tabler outline shapes. Their path geometry is pinned to upstream
source with hashes and an MIT notice; no network request or external SVG markup is
used at runtime. Task links reuse the symbol of their destination. Existing fonts,
neutral palette, semantic status colors and stationary controls remain unchanged.

Start here and Settings keep their permanent sidebar entries; duplicate toolbar
buttons are removed. The guide's repeated page caption is omitted. Command search
matches task aliases but shows each workspace/section destination once, preserving
specific section priorities. Selecting a destination closes Commands without
restoring its old trigger; navigation focuses the destination main region without
changing the restored scroll. Dismissing Commands restores a visible trigger.

Captured file/action results precede setup in DOM and visual order. Explicit
controls move between captured evidence and setup; receiving a result never
automatically collapses the form or transfers focus. Catalog decisions precede
technical metadata. Hidden retained workspaces cannot receive deferred evidence
focus. Context help stays below observed activity and has one all-tasks link.

## Guided workflows — 19 September 2026

The requested usability pass adds Start here to the toolbar and navigation without
changing the default radar. Three primary tasks open monitoring, local file review
and action setup checks; a compact task list links the remaining workspaces. These
task names also work in Commands. A native disclosure explains optional terminal
setup, action versus agent catalogs and connection-scoped MCP status. Its fixed
online documentation links use the desktop host and show confirmed success or
failure; preview never opens them. This guide does not configure or connect a route.

Local security starts with one project-review action. Review options reveals the
other review modes, profile layout and offline inputs while a visible summary
keeps the current selection clear. Result source and capture time remain visible;
the next-action button opens and focuses the relevant findings/changes/coverage
tab. Snapshot acceptance, export and uncertainty keep their existing semantics.
Action control presents a plain-language outcome and next step before technical
details in a closed native disclosure. Captured context and coverage limitations
remain visible when the draft changes. The independent guide, local review and
action check pages omit process-outage banners; telemetry-dependent pages including
Analysis and Reports retain them. Global sensor entry points remain available.

The neutral Observatory palette, Segoe UI, spacing/type/control tokens and original
stylesheet order remain authoritative. New guide styles are scoped, wrap at small
widths and preserve stationary controls. Keyboard navigation, four themes, enlarged
scale, English/Portuguese and retained results are part of visual verification.

## Action control checks — 19 September 2026

Action control under Assess uses the existing neutral panels and native form
controls to select a route and files through main-owned dialogs. A retained result
shows its captured selection, route and time separately from the draft. Policy
outcomes and configuration validity never receive a safe or verified-blocking
badge. Current-process runtime/terminal observations and the absence of connection,
authorization and outside-route evidence stay visible. All catalog rows remain
reachable, including at 900x600 and 150% scale. Failure/cancellation retain the
prior result; preview examples remain explicitly simulated. Styles are scoped,
with shared spacing/type/control tokens and stationary interaction.

## Sequence evidence hierarchy — 16 September 2026

Audit sequence details begin with the transfer-not-observed assessment, then the
relationship summary and actual file/TCP events. Owners, PIDs and endpoints stay
with their events. Process paths, full identities, evidence codes, snapshot times
and detailed assessment reasons move into a native disclosure after the events.
The disclosure starts closed, uses the existing attribute-group styling and
supports Enter/Space with visible focus. The primary caveat and first event heading
must fit without scrolling at 900x600 and 150% scale. Expanded evidence remains
available without horizontal overflow. Legacy missing assessments stay explicit.

## Related sequence evidence — 16 September 2026

SEQ003 adds an ordered ancestor-to-descendant list containing the PID and recorded
instance identity of all two-to-four-hop path participants. Intermediates are path
evidence only. The event steps still show their actual actors. The list shares
the existing scrolling detail body; snapshot times, uncertainty and enlarged-scale
access to the TCP step remain visible. Endpoint labels never imply a direct edge.

SEQ002 uses the existing Audit detail overview. It shows separate recorded actors,
the observed parent/child PIDs and relationship snapshot times. Causality and
transferred content remain explicitly unproven. SEQ001 keeps its same-instance
description. Existing scoped detail styles and the reference cascade are preserved.

## Local security workspace — 16 September 2026

The requested interface integration adds Local security under Assess. A compact
native form selects the offline review and directory layout; native dialogs choose
all actual files. One result retains its source and capture time through navigation,
cancellation and failure. Result sections group findings, files, packages, MCP tool
fingerprints, changes and coverage. Lists retain all rows through search/pagination;
expandable evidence preserves hashes, source binding and attribution uncertainty.

No-findings and unchanged-content states retain a safety-not-determined label.
Snapshot acceptance requires explicit review acknowledgment and a fresh matching
capture. Export, snapshot and acceptance feedback require confirmed host success.
Preview fixtures stay explicit and persistence actions are disabled. Existing
Observatory surfaces, spacing, typography, themes and stationary controls apply;
new styles are scoped and the reference cascade is unchanged.

## UI/UX recovery corrections — 15 September 2026

Catalog loading, failure and an empty successful result are distinct states. A
failed read offers Retry; creation stays unavailable until the catalog is loaded.
Settings validation lives in the sticky save area and links back to the invalid
field, preserving the draft and making that field visible above fixed controls.
Explicitly opening an agent focuses the inline overview heading once; ordinary
section changes and telemetry updates retain their current focus.

At window heights up to 700 px, Monitoring initially shows compact agent/risk
totals with More metrics to expose the complete summary and coverage explanations.
The complete summary remains visible by default in taller windows. The small-window
radar header omits its repeated introductory subtitle; the risk legend and layer
instructions remain available. Agent/process selectors use a compact horizontal
label layout at this height. Statistical coverage captions follow the shared
scaled caption token. These corrections preserve the existing themes, motion
policy, measurement meanings and navigation destinations.

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

### Watchlist feedback and grouping (2026-09-11)

The process watchlist loads automatically and combines the selected agent's
status and add/remove action into one stable row. Other entries live in one
bounded disclosure. Duplicate signature/PID entries share one displayed action;
distinct PID scopes remain separate. Agent names resolve through the catalog.
A shared live status survives removal of its row and reports loading, saving,
success or failure. Concurrent mutations and refreshes are guarded. Failed
readback after a confirmed write is reported separately and requires reloading
before another change. Removing a focused row returns focus to the stable agent
action. Watchlist flags remain alert-only and do not grant or block access.

### Localization and default radar (2026-09-11)

The user's requested starting view is the radar in Monitoring. The protection
overview remains available through the view switch. Agent markers use original
local logos, a numbered index and a narrow risk-colored underline. Circular
plates, shadow halos and marker echo animation are removed. Selection uses a
single outline; the sweep and stable 44px pointer targets remain.

English and Brazilian Portuguese share the same Svelte components. Language
changes update navigation, controls and accessible labels immediately and persist
under `aegis.language`, independently of the theme/scale draft. The root document
language follows the selection. English source messages are the fallback for
unknown copy; recorded names, paths, evidence text and provider responses retain
their source language. The Portuguese vocabulary from PR #425 is reused alongside
the Observatory message catalog in `translations/pt-BR.json`.

### Circular agent markers (2026-09-11 follow-up)

The user requested circular agent icons with smooth edges. Radar markers now use
a 44px circular surface, a thin risk-colored border and a circular ordinal at its
lower edge. The inner artwork has a circular clip and uses normal image
interpolation. Native CSS curves provide antialiasing without blurring the logos.
Selection keeps a clear contrasting border. No marker shadows or pulses return.

### Discoverable monitoring modes and action icons (2026-09-11)

Both monitoring destinations remain visible in a bordered mode switch directly
below the page heading. Radar and shield icons identify detailed monitoring and
the protection overview; a filled selection and pressed state show the current
view. Selecting the current view keeps it open. The group wraps at narrow widths.

Primary navigation and operation buttons reuse the existing monochrome SVG set:
open, filter, refresh, save, import/export and watchlist actions. Labels remain
visible and icons stay hidden from assistive technology. Dense record rows,
numeric presets, metric selectors and ordinary cancel/close actions retain their
existing presentation to keep the interface quiet.

### Resource identity icons (2026-09-11)

Resource rows now share a compact bordered SVG symbol and a written type label.
Source, configuration, document, image and database files have distinct marks;
unrecognized extensions retain the ordinary file mark. Folders require recorded
directory metadata or a trailing path separator. Skill resources use a book.
Domain names use a globe, IP-only destinations use a server and unspecified
network destinations retain the connection symbol. These categories describe
recorded names and metadata, never inspected contents, ownership or safety.

The same ResourceIcon is used in radar lists, relationship diagrams, activity
rows and resource details. ObservationResource carries it into Events, Network,
agent evidence and retained history. Neutral surfaces and existing risk labels
keep resource identity separate from assessment. All labels are localized.

### Process and attribute details (2026-09-11)

Worker rows and process cards pair PID with the processor symbol and recorded
project paths with a folder. Suspend, resume and stop controls use their familiar
pause, play and stop marks while retaining labels, capability limits and the stop
confirmation. Selected activity repeats the resource symbol and type shown in
the list. Known metadata labels for process IDs, paths, domains, IPs, ports and
observation times use the same icon vocabulary; other attributes stay plain.

### Section navigation cues (2026-09-12)

Agent sections and detail tabs pair their existing labels with optional neutral
SVG symbols. Risk uses the shield, resource usage a chart, activity the activity
line and processes the processor. Attributes, retained records, recognition and
related entities use clipboard, history, search and connection symbols. Catalog
and provider editor tabs use the same vocabulary. Tab labels, counts, selection
and keyboard navigation remain visible and operable at enlarged scale. The
radar's individual-process action also uses the processor symbol. Worker counts
in the agent heading follow the selected language.

### Keyboard and catalog recovery (2026-10-06)

Settings measures its sticky save bar when revealing focused controls. The
visible field stays between the section tabs and save controls at enlarged
interface scale. Commands keeps keyboard focus in its search field while arrows
move the selected destination; results do not add individual Tab stops. A polite
status announces result counts and empty searches, with a Clear search action.

Data & help offers a device-local switch for S, T and 1–5, saved immediately.
Ctrl K and existing navigation buttons remain available. Custom catalog deletion
requires confirmation with Cancel initially focused and preserves recorded
activity. Rejected writes remain retryable; confirmed deletion returns focus to
catalog search even if a subsequent refresh fails. Catalog signature links and
counts use the existing scale-aware caption token. New controls are localized
in English and Portuguese.

### Related context beside results (2026-10-06)

The agent workspace keeps a compact context summary above its existing detail
tabs. Resources, retained activity and worker counts link to their respective
panels. Values reuse the existing scope and completeness rules; unavailable
measurements remain dashes and retained network snapshots stay labeled.
At narrow widths, measurement labels and notes carry the visible summary;
section names remain in the accessible button names. Reduced spacing and a
flexible risk-reason column keep the primary reason above the fixed footer.

The file activity card offers All activity and Sensitive events filters without
leaving the agent workspace. Rows retain attribution, show the qualified action
and recorded reason, and open the existing evidence inspector. Open-handle
observations carry their collection caveat. All original detail navigation stays
available.

Local review results show a bounded preview of source-ordered coverage notices
beside findings and provenance. The control opens the complete coverage tab and
focuses its tab only while the workspace remains visible. Filters and pagination
remain mounted. These additions use scoped token-based styles and preserve the
approved template, artwork and stylesheet cascade.

When Network has no current snapshot, its existing Statistics advice includes a
direct sensor-health action. The shared navigation opens the Sensors tab, keeps
the selected agent/process scope, and uses the existing workspace focus behavior.

Completed AI reports keep their captured scope counts, source and first
recommended check beside the report header. The evidence shortcut opens the
existing recorded-scope panel; historical reports retain their own snapshot.
Captured counts stay on one line and use one column at narrow widths.
Audit introduces retained entries and delivery counters together, with a direct
action to the other existing tab. Reading history does not establish current
writeability or hash-chain integrity. Both views retain their original detail,
export and recovery controls.

### Simple agent experience foundation (2026-10-06)

The user authorized a beginner default with independently enabled Advanced
controls. The original five-destination composition was superseded on 7 October
by Investigate, Check files and Settings as specified above. The stable fourteen
workspace routes, contextual links, commands and
history remain available. Advanced reveals their full navigation. Its verified
device preference is saved separately from host settings and unsaved drafts.

Simple agent detail places the observed process risk and its leading reason,
guarded Pause/Resume/Stop actions, and retained file/connection activity in one
composition. The product roster and nearby explicit worker selector now provide
selection within the investigation workspace.
Expanded risk explanations and technical compositions stay available. Missing
observations remain qualified; neither a held file nor a connection snapshot
proves a modification or a connection lifetime.

The common evidence feed uses incremental native scrolling and a stable Show
older activity keyboard action. Reviewed evidence retains its captured identity,
rows and focus while new arrivals wait behind Show latest. Search still covers
the retained source population. Initial rows and loading increments are bounded;
this is progressive loading, not a fixed-size virtual window for arbitrarily
large network populations. The authorized arrival reveal must pause when the
feed is hidden, stale, paused or being read and honor reduced motion.

An exact file exception can be enabled and reversed beside its evidence.
Confirmed storage and readback govern the shown state. Exceptions affect scoring
and new notifications; retained Alerts, journal and history remain available.
Failed preference reads are qualified. Existing canonical process identity,
confirmation and operation failure handling remain in force. This interface
change does not establish automatic process blocking.
