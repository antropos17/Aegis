# Observatory interface rules

This is the canonical design for the next AEGIS frontend. Preview behavior is simulated; production host integration follows FRONTEND-HANDOFF.md. Earlier designs are retired from new interface work.

## Surfaces and selection

Use neutral surfaces and a consistent radius hierarchy: 12 px panels, 8 px controls, 6 px small labels. Selection uses a filled surface with a complete border. Hover changes surface color without moving the target. Focus has a separate visible outline. Avoid underline-only selection and competing selected states.

## Status and identity

Agent identities use the original local artwork listed in `public/assets/agents/SOURCES.md`. Preserve proportions and scale icons with text. Radar markers use the same logos as tables and details. A short frame pulse accompanies the sweep; no decorative expanding circles. Stream and sensor status use activity/check/shield icons with text.

Risk labels share one outlined badge style. Low is neutral; Medium is amber; High and Critical are red. Text is always present, so color is not the only indication. Surfaces are not tinted by risk.

## Data and actions

The activity chart aggregates the demo store's timestamps into 24 intervals. Filters select period, event kind, and agent. Hover/focus reads the exact interval; activating a nonempty interval opens its events. Empty intervals report that no events exist. Resource bars represent the current process snapshot: CPU on a 0–100% scale, RAM relative to the largest process, with values and scale explained.

Agent names and audit resources are buttons with visible link styling and keyboard support. They open details for that exact record. Mock paths do not open real files or external network endpoints. Chart data and interface state are retained when live data updates.

## Motion

Control state transitions use 140 ms, data changes use 280 ms, chart entrance uses 320 ms. Live updates animate values and bars without recreating focused controls. Pause freezes the stream and radar; charts remain readable. Reduced motion and the Motion setting disable animation without hiding data. Radar phase and keyboard focus survive layer changes and navigation.

## Window verification

Check all views at the 1200×800 default and the 900×600 minimum, plus limited content height and 100–150% UI scale. Navigation and status remain anchored; workspace and inspector scroll within the window. Test chart counts, filters, keyboard movement, exact-record actions, pause, and reduced motion in addition to screenshots.

## Navigation transitions

View changes use an interruptible 200 ms snapshot transition, with a 10 px directional offset. Content and scroll are restored inside its update callback. New requests supersede pending updates. Detail navigation shares the transition; closing uses 100 ms. Form listeners attach after the asynchronous modal update. Reduced motion disables these effects. Graph entrance must not restart after a navigation snapshot finishes.

## Entity navigation

Processes, instance IDs, working directories, network addresses and catalog signatures link to metadata details. Resource details connect parent folders, related events and associated agents. Exact event IDs travel with actions so history navigation cannot target a subsequently opened record. External product websites open separately; simulated filesystem paths stay within the prototype. Small question-mark controls reveal contextual popovers and retain keyboard access. Catalog artwork is local and provenance is recorded in `public/assets/agents/catalog/sources.json`.

## Radar selection and agent summaries

Clicking empty radar space or pressing Escape within the radar clears selection. The inspector shows an explicit unselected state; process actions require a selected agent. Clearing or selecting preserves the sweep element and its animation clock. Four agent summaries show original logos, current CPU/RAM, PIDs and ten 30-second event bins over the trailing five minutes, using a shared vertical scale. Charts open their exact matching events. At a radar-body width of 760 px or more, summaries flank the canvas; smaller windows place them in two columns below it.

## Profile and section identity

Profiles use a semantic icon and a restrained color accent: Paranoid/bell/red, Strict/shield/amber, Balanced/scales/green and Developer/terminal/blue. Only the selected profile receives a colored border and check; text and surfaces remain neutral. Section headings, permission categories, mode tabs and commands reuse the shared icon vocabulary. Agent filters and permission headers reuse original local agent artwork. Native selects retain keyboard behavior.

## Analysis workspace

AI analysis has a main navigation tab. Use a narrow configuration column and a wider report with evidence and history sections; stack at smaller desktop widths. Reports capture their evidence at run time. Titles and compact/detailed export settings apply to the next run. Provider configuration and demo state are visibly distinct. No decorative confidence scores, invented API connection success or browser API-key storage. Internal section transitions use the existing motion coordinator.

## Desktop density and stable analysis panels

Use a 12 px gap between sections and a 16 px shared panel inset. Short export/settings panels align at the top instead of stretching to match a long neighbor. Tables and detail windows use compact, consistent insets. At desktop widths, AI analysis fills the available window: configuration and report content scroll independently, section controls stay anchored, and each section retains its scroll position. Internal analysis transitions capture only the report body; provider controls and configuration stay stationary. A single available demo data source is shown by the provider status rather than a redundant select.

## Detail windows

Dialog history, title and close control share a compact top row. Only the body scrolls; footer actions remain visible. Detail history stores the body scroll offset, and a different record with the same title begins at the top. Initial focus goes to the first editable field or the title for read-only details. Entity layout responds to available dialog width and UI scale. Audit copy actions carry their own record data so returning through history never copies a different entry.
