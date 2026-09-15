# AEGIS: selected agent workspace

Date: September 10, 2026. Status: the interface organization is implemented and has passed local checks; CI results are recorded in the PR. This document connects user complaints, research and specific Observatory changes. It does not report a measured improvement in usability.

Clarification after user review: Monitoring always shows the overall view. The selected agent scope applies to Agents, Events, Network and Statistics. The current sizing and routing conventions are described in [DESIGN.md](../../frontend/observatory/DESIGN.md#monitoring-and-sizing-correction); they supersede the inclusion of Monitoring in the shared scope below.

## Goal and scope

The user reported too many Unknown labels, scattered information, nested tabs in dialogs and constant navigation. This pass aims to provide a consistent answer to "what is happening with the selected agent": its processes, resource use, observations and risk reason should form one connected workspace. Observatory's visual hierarchy, local logos, neutral surfaces, color semantics and Segoe UI system typography are preserved. Reorganizing information does not require a new theme or decorative charts.

The work draws on source inspection, an audit divided among several agents and published guidance. Source review can reveal lost context and contradictory states, but it cannot measure subjective usability. That requires a separate observed user scenario with criteria chosen in advance.

## Source audit findings

Before these changes, `App.selected` served only Monitoring/Radar. `Statistics.svelte` stored its own product and process selection, while two instances of `Events.svelte` independently stored agent filters inside expandable panels. Moving from the inspector to statistics passed the product and reset the selected process. It appeared to continue work on the same agent while changing the data scope.

A single worker process represented each radar group. Its disappearance or a radar page change could reset the selection. Meanwhile, the inspector displayed group totals next to an individual-process selector. These are different entities that needed explicit separation in application state.

`Details.svelte` maintained its own history, scrolling and tabs. Moving through a group, its processes, an individual process, activity and a resource created a second navigation system inside the application. Agent-name buttons, process counts and Open often led to the same initial dialog page. The overall screen also repeated activity in several blocks. Unknown labels combined different reasons for missing information and did not explain what AEGIS actually lacked.

The audit started with components in [frontend/observatory](../../frontend/observatory/), especially App, Statistics, Events, RadarInspector, Details and runtime/detail-model. These findings describe the state before this pass; the adopted changes are recorded below.

## Guidance from external sources

Grafana recommends organizing a dashboard around a question, using parameters to reuse views, limiting duplication and giving charts a clear purpose. This supports a shared agent scope and fewer repeated views; it does not prove that a particular AEGIS layout is more effective. [Grafana: dashboard best practices](https://grafana.com/docs/grafana/latest/visualizations/dashboards/build-dashboards/best-practices/).

A modal dialog blocks the main context and requires separate interaction. NNGroup describes it as a way to focus attention on a bounded task. Moving extended agent investigations onto a page is our inference for AEGIS, rather than a ready-made pattern from the article. [NNGroup: modal and nonmodal dialogs](https://www.nngroup.com/articles/modal-nonmodal-dialog/).

Carbon distinguishes no data, no filter results and failed data retrieval. A message should explain the specific situation and, when possible, the next step. This supports separate wording for an unrecorded actor, an unavailable measurement and a departed process. [Carbon: empty states](https://carbondesignsystem.com/patterns/empty-states-pattern/).

NNGroup associates quantitative comparison with length and position on a common scale; color works better as an additional cue. Resource history therefore remains a line chart, and risk color is accompanied by a value and explanation. Retaining the overview radar is an AEGIS decision based on its existing visual language. [NNGroup: dashboard perception](https://www.nngroup.com/articles/dashboards-preattentive/).

W3C APG defines tab roles, panel relationships, focus order and arrow-key navigation. Reducing the number of tabs does not remove these requirements from the remaining Statistics, Settings and other sections. [W3C: tabs pattern](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/).

Dashboard Design Patterns organizes recurring solutions and tradeoffs among content, interaction and space. We use it to make tradeoffs explicit: a shared page requires scrolling, detailed logs remain separate views, and a compact overview cannot show every record at once. The study does not evaluate AEGIS. [Bach et al.: Dashboard Design Patterns](https://arxiv.org/abs/2205.00757).

## Adopted interface organization

App owns the `{ agent, instanceId }` scope. An empty product means all agents; an empty instanceId with a selected product means all its processes. The shared AgentContext bar is available in live sections. Moving between the overview, Agents, Events, Network and Statistics preserves the selection. All agents explicitly returns to the overall view. This is interface state for the current session; the document does not promise persistence after restart.

The selected agent opens in the main AgentWorkspace area. Sections appear in this order: name and observation state; risk with its leading reason and an expandable explanation; one resource chart with CPU, memory or token selection; retained files and connections; worker processes. Short links navigate to sections on the page. Technical attributes and process controls expand near the selected worker process. No separate history chart is added below every metric.

The overall Monitoring view retains its overview role: summary, radar as an entry point to an agent, activity chart and recent observations. The empty side inspector is removed from the main application, and the duplicate Timeline is no longer mounted. Standalone components may retain their previous contracts for tests and reuse; this does not create another user route.

Statistics remains the place for detailed measurement analysis. Its own selectors are hidden when an external scope is supplied; changing the product preserves the selected section and metric unless the user explicitly requests another section. Sensors shows AEGIS independently of the selected agent. History for a scope starts when the selection changes; missing values and incomplete coverage remain visible.

Modal details support bounded inspection of an observation, a resource's records and utility actions. They no longer serve as the primary agent workspace. Navigating from a record to its process returns the user to the main context. Confirmation of a potentially dangerous action remains a separate interaction.

## Accurate uncertainty and identity

Network `unknown` appears as Endpoint unverified; a missing actor appears as Actor not recorded; a missing working directory appears as Working directory not recorded. When the source provides a reason, the interface explains it in readable text. These labels clarify existing data and do not create new attribution.

A path inside `.codex` or `.claude` can identify resource context but does not establish an actor. General logs retain these observations. A specific agent scope excludes selfAccess and explicitly unattributed records; the product is matched through the recorded actor or a usable exact stamp of the current process. Process scope uses the retained instanceId. PID reuse never transfers old events or measurements to a new process.

Degraded identities ending in `:u`, unknown start times and synthetic observations do not become selectable real worker processes. They may appear in the overall view with an explanation of the limitation. A selected process remains selected after departure: current measurements are unavailable, while retained activity remains accessible. A sensor outage does not replace the last reliable population with an empty list.

## Before and after scenarios

| Task | Before this pass | Adopted behavior |
| --- | --- | --- |
| Inspect Codex | Select it on the radar, then open a separate dialog | Select Codex to open its risk, resources, activity and processes page |
| Compare resource use and network activity | Open another section and find the filter again | Move to Network or Statistics with the scope preserved |
| Inspect a worker process | Group → processes tab → new dialog contents | Select a process in the shared bar or a Worker processes row |
| A process departs | Selection could disappear; a new population changed the context | Keep the exact selection and show the absent current process alongside available history |
| Understand Unknown | Read a generic uncertainty label | Learn whether the actor, address, start time or measurement is unavailable |

These are routing changes, not measured task times. The number of actions depends on the starting state and entry point, so no numerical speedup is claimed.

## Verification and remaining limits

Component checks confirmed consistent scope across App, Events, Network and Statistics; opening an agent row without a modal; history retention after PID reuse; pause behavior; and separation of Ctrl/Meta+S/T from single-key commands. Relevant files are `ObservatoryAgentWorkspace.test.js`, `ObservatorySharedScope.test.js`, `observatory-agent-scope.test.js` and the existing `ObservatoryStatisticsScope.test.js`. The additional ObservatoryDepartedHistory.test.js checks time-window retention after a process departs and independent Sensors updates. Type and Svelte checks passed without errors. The full suite passed in CI, including the departed-process clock fix. During a local rerun under load, an existing test that launches a temporary binary exceeded its timeout once; an isolated rerun passed. The PR records checks for the latest commit.

| QA area | Required states |
| --- | --- |
| Geometry | Reference viewports of 1200×800 and 900×600; limited height; 100–150% scale; long paths |
| Presentation | Light, dark and high-contrast themes; ordinary and reduced motion |
| Data | Empty startup, reliable empty snapshot, sensor outage, partial resources, unsupported tokens |
| Selection | All agents, product, exact process, departure, reused PID, `:u`, synthetic source |
| Navigation | Sidebar, rows, shared bar, Back/Forward, log → process, return from a record |
| Keyboard | Tab, tab arrow keys, Escape, system shortcuts, focus return, unavailable actions |
| Native window | Isolated Electron profile, actual dimensions, no interventions against user processes |

The frontend:test browser pass checked themes, scale, viewports, shared scope, direct navigation, overflow and focus return. Agent-page screenshots were inspected in light and dark themes, including 900×600 at 150%. The native Electron pass completed without runtime errors; restart and settings persistence were checked with a disposable profile. This is a bounded regression matrix, not a guarantee of an error-free interface. This pass does not extend sensors, recover lost attribution or create historical measurements from before observation began. Further usability evaluation should use the scenarios above and separately record navigation errors, repeated selection and the clarity of explanations for missing data.
