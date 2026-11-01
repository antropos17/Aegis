# Dashboard comparison and polish — 19 September 2026

English translation of the historical report. The observations, dates and
verification limits below describe that work; this translation adds no new evidence.

The comparison used Observatory at `12eee9f`, the current `origin/master` when
work began. The primary checkout contained older source and unfinished edits;
those were preserved. Changes used the separate `codex/dashboard-design-polish`
branch.

Reference: the owner-supplied file “AEGIS — идеальный дашборд.html”, containing
18 screens and component sheets. SHA-256:
`581453cbe7be046a1f6167fde877d09a10c74c6e8a279f980e7d7728fadc5143`.
Its contents are a design reference. Depicted data, sensor states and buttons
do not establish that the corresponding capabilities exist.

## Findings

The reference makes the task clearer: select an observation, understand its
basis and proceed to an action. The existing interface already provides most
working sections, retains agent/form selections and distinguishes real
observations from demonstrations. The confirmed overview problem was space
allocation: repeated introductions and a large summary pushed the first record
down, while opened evidence received less width than the list.

The polish applies these principles to the existing overview. It preserves the
startup radar and does not replace the interface with the complete static mockup.

## Comparison

| Area | Reference | Observatory before the change | Decision |
| --- | --- | --- | --- |
| Main screen | Review with an attention queue | Startup radar with Protection overview nearby | Preserve the startup choice; improve the overview |
| Overview hierarchy | Brief summary followed by records | At 900×600, the first record's text fell below the workspace boundary | Compact summary/headings; remove repeated introduction in short windows |
| Selected record | Wide evidence area | List-to-detail ratio of 1.6:1 | Give details more width; retain sequential order in narrow windows |
| Next action | Buttons beside evidence | Evidence and Agent & controls below the policy block | Move buttons before the saved policy |
| Knowledge limits | Explicit observation/inference distinction | Open-handle caveat inside a closed disclosure | Make caveat, timestamp and record count immediately available |
| Color emphasis | Items needing attention highlighted | Absence of automatic blocking also shown in amber | Make the normal limitation neutral; retain visible explanation |
| Filters | Category counts | Names only | Add group counts, including accessible button descriptions |
| Navigation | Compact Monitor / Check before use / Records / Configure | Observe / Investigate / Assess / Configure with more separate destinations | Full regrouping needs separate work preserving commands, history and destination selection |
| Agents and activity | Expandable list, evidence graph, Files/Network together | Agent table, separate tabbed workspace, separate Events/Network | Preserve existing paths; an evidence graph needs a relationship/causality contract |
| Local checks and actions | Result before setup details | Saved result, limits and separate live route observation already exist | Avoid duplicate screens; do not import fabricated mockup results |
| Records and reports | Shared Records group and report preview | Separate Audit and Reports groups; export and saved-record viewing | Shared navigation and preview are separate functional work |
| Commands | Search agents, files, chains and sections | Search sections/tasks through `WorkspaceCommand[]` | Entity search needs indexing; preserve the existing search name |
| Sensors | Loss/state summary with timestamps | Sensors opens existing sensor statistics | Do not import reference values or coverage guarantees |

## Outside the polish scope

A shared sequence/unattributed-activity queue, daily reviewed-record counter
and entity search require data work. `Mark reviewed` exists in process-instance
details and is stored only in current-session memory by `instanceId`. It is
not an activity-record review marker or the reference's persistent Review queue.
Agent opening, exact process identity, absent observations, pause and preference
read failures retain their existing rules.

## Verification

- Visually inspected 18 reference sheets, the main existing sections and the
  changed overview. Wide-screen comparison used 1440×900.
- Additional overview matrix: 32 combinations of 900×600 / 1200×800, 100 / 150%
  scale, four themes, English and Portuguese. Checked Enter selection, focus
  restoration, empty results and absence of horizontal overflow.
- At 900×600 / 100%, the first row occupies y=406.78–498.28; the application's
  bottom bar begins at y=570. The first record is fully visible without scrolling.
  At 150%, normal scrolling keeps the content accessible.
- Measured actual colors for five selected text roles across four themes:
  minimum contrast 5.22:1. This samples the changed area and does not certify
  accessibility of the whole application.
- Component regression checks open-handle caveat/time visibility without
  expanding details. Existing stale-data, instance-change and preference-read
  failure checks remain.
- Browser regression checks first-row visibility in a small window and evidence
  width priority, covering 24 size/theme/scale combinations with/without selection.

Screenshots and machine results are in ignored `out/design-audit/` and
`dist/frontend-qa/`. Full repository checks are recorded in the PR results.
Native Electron, live sensors and a screen reader were not separately tested
in this initial polish; a browser demonstration does not establish their behavior.

## PR #520 follow-up

Reviewed merge commit `192108820b1a2ee19ea55219a364dd8c2a537d4a`;
its PR CI and separate master CI succeeded. The polish preserves the startup
radar and does not implement the whole static reference.

Confirmed a focus-restoration defect in the existing detail-close handler.
At 1200×800 / 150%, selecting the eighth row and closing details focused a row
at y=1123.73–1244.48 while the workspace bottom was 762.25. The handler focused
the row before the grid update and suppressed scrolling. If search hid the
selected row, closing details lost focus entirely. This handler predates #520;
the added checks close gaps in the earlier first-row/`activeElement` checks.

The fix waits for the Svelte update, restores focus and scrolls the row into
view with room below the sticky header. If the row no longer exists, the activity
section receives focus. A hidden workspace does not steal focus. After the fix,
the same eighth row occupies y=625.73–746.48 and is fully visible.

Follow-up verification passed 32 combinations of 900×600 / 1200×800,
100 / 150% scale, four themes and two languages. Enter performed selection and
closing; checks covered a visible focused row, fallback focus after search and
absence of horizontal overflow. The general `frontend:test` also passed.
Native `frontend:test:electron` checked 11 sections, a reliable process snapshot,
restart, settings persistence and six export handlers without renderer errors,
process interventions or provider requests. A screen reader was not separately
tested. Artifacts are in ignored `.agent/redesign-520/`, `dist/frontend-qa/`
and `dist/electron-qa/`.
