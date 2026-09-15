# UI/UX recovery — 15 September 2026

The UI audit identified a failed catalog read that could only recover after
reloading the window, hidden settings validation, loss of focus when opening an
agent, unscaled statistical coverage captions, and an overcrowded initial view
at the supported minimum window size.

Catalog now distinguishes loading/error from successful emptiness, offers retry
and prevents creation until its data is loaded. Existing rows survive a failed
refresh. Settings uses a dedicated sticky save component containing the validation
message and a link to its field. That link restores the relevant section and
centres the focused field so the fixed controls do not cover it. Other drafts are
preserved. Explicit agent opening focuses its overview heading without scrolling;
normal tab and telemetry updates do not repeat this focus operation.

Coverage captions follow the scaled typography token. At small window heights,
the monitoring summary presents agent/risk totals with a keyboard-operable
More metrics control. Expanded mode preserves all existing metric values and
coverage explanations. Taller windows retain the full summary. Compact context
selectors and a reduced radar header leave more room for observed data.

Regression coverage is in ObservatoryUxRecovery.test.js and
frontend/observatory/tests/ux-recovery-check.mjs. The browser check exercises
the saved scale, summary expansion, visible validation, the focused field's
actual hit target, and agent opening/tab navigation. It uses disposable preview
settings and does not request process intervention or provider analysis.

The original audit evidence remains outside Git at
X:/tmp/aegis-uiux-audit-20260915. Follow-up screenshots and verification records
are kept at X:/tmp/aegis-uiux-fixes-20260915. Native installation, screen-reader
certification and event-recall claims are outside this UI correction.

Validation: the final local coverage run passed 3,493 tests with four skips.
An initial run lost its worker-limit argument in the shell wrapper and produced
eight UI timeouts; the complete two-worker rerun passed without changing test
timeouts. The shared browser suite passed its viewport/theme/scale matrix and
the added audit scenarios. A final isolated Electron run at 900×600 and 150%
verified visible validation, an uncovered focused field, catalog loading, metric
expansion, agent heading focus and scaled captions, with no page errors. Its
temporary application was closed normally. Production/preview builds, type
checks, formatting and lint passed; lint retained its existing warnings. No
dependency vulnerabilities were reported by the production audit.
