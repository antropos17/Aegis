# Action control checks in Observatory

**Action control** in the Assess group brings the existing nonexecuting route
and catalog checks into the desktop app. It is the first B5 interface slice.
The configuration check does not report a connected agent or verified blocking.
The separate [Live route observation](ACTION-LIVE-OBSERVATION.md) panel observes
an explicitly selected running MCP owner, with self-reported client metadata and
sticky coverage loss. Neither panel establishes verified blocking.

When a captured check or route observation is available, the **Route evidence**
summary presents three independent questions. **Selected inputs checked?**
describes the retained, nonexecuting configuration check for
the files chosen in the native dialog. **Live MCP owner observed?** needs a fresh
initialized owner snapshot from one explicitly chosen observation endpoint.
**Selected tool call reached owner?** needs that connection to report at least one
owner invocation. An invocation may answer `ask` or `deny`; it does not prove a
command ran or a file was deleted. A lost or stopped connection retains the last
snapshot as **past connection evidence**, without implying that the route remains
live. There is no automatic search for other clients or tools.

Matching selection and route labels across the check and observation do not bind
the checked files to the running owner. Mismatched labels are shown explicitly.
The separate selected-file deletion route has no matching configuration preflight
mode here; its returned operation report supplies its own outcome. All three rows
remain bounded by self-reported client identity, unknown outside-route activity
and unsupported descendant control. See [the observation contract](ACTION-LIVE-OBSERVATION.md)
for connection lifetime and counter meanings.

Choose a single action or a catalog, select the intended route, then choose the
files in native dialogs. A single action needs a schema 2 or 3 execution policy and a
schema 1 action request. A catalog needs its manifest, which explicitly selects
the referenced policy/request files. The existing bounded check reads those
inputs and reports their current configuration and policy decisions. A schema 3
`reviewRequired` action appears as `ask` with the `review-required` detail; the
check still does not approve or run it.

| Selection | Routes |
| --- | --- |
| Single action | Direct execution, terminal confirmation, MCP stdio, MCP terminal review |
| Catalog | MCP stdio, MCP terminal review |

The displayed result retains its actual selection, route and completion time
when the form changes or another check is cancelled or fails. Navigating to
another workspace and back preserves the mounted result. Nothing runs on page
entry, and the result is not persisted across app restarts.

## Meaning of the result

Configuration validity and an `allow` policy decision do not establish execution
permission. Every result keeps blocking verification unperformed, connection
unchecked, authorization absent, outside-route coverage unknown and descendant
control unsupported. Temporary revision bindings used by catalog checks are
revoked before returning. No approval or binding is retained by the interface.

Runtime and terminal fields describe the **checking AEGIS main process**. The
desktop normally lacks an interactive terminal. Its result does not test a
separate Node process, an installed client, or a terminal broker started elsewhere.
The timestamp marks when this check completed; no continuous watch follows it.

Catalog results show each captured action's policy outcome and configuration
reason. Invalid, unavailable, cancelled and timed-out checks remain distinct.
Configuration checks provide no safe badge, coverage percentage, automatic
installation, action launch, network connection, export or snapshot acceptance.
The separately opted-in observation panel uses its own local connection.

## Host boundary

For configuration checks, the existing `local-security:review` invoke accepts an action selector
(`check-route` or `check-catalog`) and a fixed route enum. Renderer-supplied paths,
commands, URLs, report bodies and extra options are rejected. Main owns the native
file selection and returns only the check report with its generated ID, selection,
route and completion time. Private paths, action arguments, environment values,
file contents and capabilities do not enter this envelope.

Checks share the local-review operation lock and exact owned top-frame/document
validation. Navigation and window destruction abort the active check; ownership
is checked again after each dialog and before delivery. A check neither replaces
the retained offline local review nor creates an export/acceptance capability.

The preview uses explicitly simulated examples and performs no filesystem access.
Its examples include allow, ask and deny, with the same unverified-control labels.
Production builds exclude that fixture module.

## Remaining B5 work

Live selected-route observation and coverage-loss transitions now have a separate
panel and the evidence summary above. Independent agent/version identity and
installed-adapter verification controls remain open. The CLI
[preflight contract](ACTION-ROUTE-CHECK.md),
[MCP status contract](ACTION-MCP-STATUS.md) and installed-provider receipts explain
which evidence is available today. A preflight result cannot substitute for those
connection or execution observations.

## Verification

IPC tests cover exact route-only requests, native selection cancellation, existing
review retention, busy serialization, foreign frames/documents and navigation or
destruction during a check. A real-core fixture checks policy deny without a
sentinel effect. Renderer tests cover invalid envelopes, fixed coverage labels,
captured route/time, pending operations and retained results.

`npm run frontend:test` includes a preview sequence for single and mixed-catalog
checks, keyboard activation/focus, retained navigation, four themes, 100%/150%
scales at 1200x800 and 900x600, a 200% case and Portuguese layouts. The source
template checksum and production fixture-exclusion checks remain in that suite.

`node frontend/observatory/tests/action-coverage-electron.mjs` uses the production
renderer, real preload, IPC owner and checkers with a disposable Electron profile.
Native dialogs are stubbed to explicitly generated local fixtures. It checks
allow/ask/deny, invalid configuration, mixed catalog, desktop terminal absence,
selection cancellation, draft/result separation, keyboard activation, private
canaries, path injection rejection and foreign-document denial. It records
screenshots and a fixed receipt under `.agent/b5-action-coverage-native/` and
removes its owned profile and input files. It does not run the selected actions
or test a complete monitoring session or manual interaction with OS file dialogs.
