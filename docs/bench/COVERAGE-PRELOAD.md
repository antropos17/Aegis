# Dormant Windows coverage through the Electron preload

`frontend/observatory/tests/coverage-preload-electron.mjs` checks a bounded local
integration: freshly built production Observatory, unchanged production preload,
real Electron IPC, and the actual dormant Windows ETW runtime health leaf.
It requires Windows x64, the repository's qualified Node 24 runtime, installed
dependencies, and an already available Electron binary. It never installs tools.

Run from the checkout, selecting a new output directory whose parent exists:

```powershell
node frontend/observatory/tests/coverage-preload-electron.mjs --build --output X:/owned-reports/new-run
```

An unchanged successful production build can be reused for a fixture-only rerun:

```powershell
node frontend/observatory/tests/coverage-preload-electron.mjs --reuse-build X:/owned-reports/new-run/receipt.json --output X:/owned-reports/another-new-run
```

Reuse requires the retained passing receipt, unchanged production input hashes,
unchanged Node binary and exact renderer artifact hashes. Current fixture source
hashes are recorded separately; changing a fixture cannot silently change the
recorded build provenance. A changed production input requires `--build`.

The directory must be new. The command retains `receipt.json`, `combined.log`
and two viewport PNGs. Its `disposable` child holds all fixture profile,
session, logs, temporary files and caches; cleanup removes only ordinary closed
entries under that exact child. Reparse entries cause refusal. Receipts and
screenshots are preserved, including failed runs. Caller-owned report directories
should have a retention policy appropriate to their verification purpose.

## Measured boundary

The dedicated fixture host imports `platform/sensor-runtime.js`,
`platform/etw-file-runtime.js` and the pure `app-health.js` module. It does not
import the application's `main.js` or initialize monitoring. The actual platform
and package state select the runtime branches: Windows native sensor creation
returns `null`; unpackaged ETW creation with no diagnostic arguments yields
`DISABLED` with `diagnostic-opt-in-required`.

Source inspection establishes that the Windows native factory returns before
creating a host or reading home paths. The dormant ETW constructor creates an
in-memory supervisor/read view, sets unavailable health and registers suspend/
resume listeners. It does not start capture. The fixture supplies fail-fast
callbacks for helper existence, spawning, root checking and population access;
all must remain unused. It never calls start, restart, control or refreshIssuers.
Real power-monitor listeners are removed on owned-app shutdown. Ordinary packaged
helper selection and active capture are outside this probe.

`get-stats` obtains the leaf directly from `runtime.getHealth()` on every call.
The surrounding stats object is a deliberately limited fixture envelope:
`deriveAppHealth({ bootPhase: false })`, unknown population, the actual ETW leaf
and actual native-sensor absence. It does not exercise production `getStats()` or
claim an initialized app-health aggregate. Ancillary settings, version, empty
resource usage, false positives, permissions and alert-journal replies are fixture
values. No provider health or successful observation is fabricated.

The BrowserWindow uses the real preload with sandbox, context isolation and no
Node integration. Its renderer is the production Vite build. The fixture's IPC
sender/frame checks restrict replies to its own window; they do not qualify
production IPC authorization. External requests and new windows are blocked.
The bridge is never replaced or injected into the page.

Assertions compare an actual `window.aegis.getStats()` reply with the main-side
runtime snapshot and the rendered leaf's state, reason, loss, failure count and
unknown last-success time. Native-sensor absence stays absent. Keyboard navigation
opens Coverage and Sensor statistics, verifies focus and toolbar order, and returns
to Coverage. Reduced motion is enabled and running infinite animations are absent.
Two owned-window screenshots cover 1200×800 and 900×600 layouts. Electron's
`capturePage` keeps the window hidden; it does not capture the desktop.

The negative control omits the ETW leaf from one fixture `stats-update` push.
The same bridge/display oracle must reject this omission while the production
runtime's raw health remains unchanged. A second real push restores the leaf and
the oracle must pass. This proves sensitivity to transport/display loss; it is
not a native fault injection or product-source mutation.

## Budgets and provenance

The production build has a 90-second execution deadline and a 1 MiB output
allocation. Its first output-limit, timeout or spawn failure latches once and
clears the execution timer. Output continues draining inside the byte cap. The
caller awaits the one termination request, root-process exit and pipe closure;
termination can take up to 5 seconds, exit confirmation up to 3 seconds and pipe
draining up to 1 second. A successful exit never schedules another PID kill.
Root exit immediately enters that bounded drain wait even if inherited stdout or
stderr remains open. Root exit, pipe closure and termination confirmation are
recorded separately. A drain timeout refuses cleanup and reports uncertainty;
destroying the parent's pipe endpoints cannot upgrade it to a confirmed drain.
Descendant lifecycle is not observed by this harness. No PID-directed termination
is issued against a root already known to have exited.

One monotonic absolute Electron deadline is armed before launch. Its 120-second
budget covers launch, the first evaluation, the full journey and shutdown. The
journey stops with 15 seconds reserved for a close attempt of up to 5 seconds,
one fallback tree-termination command of up to 5 seconds and exit confirmation
of up to 3 seconds. Every phase uses the remaining absolute budget; an evaluation
without a Playwright timeout cannot bypass it. Deadline expiry rejects the parent
wait; closing the owned app then interrupts any outstanding renderer operation.

If launch produces no owned process handle, termination/exit cannot be confirmed,
or sampling cannot drain, the receipt fails and the disposable directory is
retained. For unresolved child lifecycle, the parent exits after writing the
explicit uncertainty; it does not
claim that an unresolved child or its descendants have stopped. The PID and owned
paths permit a later identity-verified inspection. Retrying a numeric PID kill is
never the cleanup policy.

Combined retained build/application output is capped at 2 MiB. The owned
profile/cache/temporary child has a separate 128 MiB logical-file budget, sampled
every second during the app batch and after shutdown. PNG output has a separate
8 MiB total budget. No video or full trace is collected. These are observed
budgets with fail-fast termination, not filesystem quotas.

Focused runner controls use short injected budgets and owned inert Node children.
A never-settling first-evaluation callback must hit the same production deadline
guard; direct process-handle cleanup is appropriate to that child with no
descendants. A real noisy child must exceed its output allocation, request tree
termination once and report confirmed exit before allowing cleanup. An intentional
termination-refusal seam must retain an explicit unconfirmed state. Temporary
source mutations disabling the deadline race and failure latch must fail those
assertions and restore the exact source SHA256. These are runner controls, with
the callback model recorded separately from the actual Electron bridge run.
A separate deterministic event/stream control emits root exit while holding both
pipes open. It must reach the short drain bound, preserve an unconfirmed-drain
result even if local destruction emits close, and make no termination request.
Its modeled ChildProcess and PassThrough streams avoid launching a descendant;
it does not qualify native descendant supervision.
Build-reuse negative controls mutate hash metadata only; they are not product
source mutations or native fault injection.

Receipts include source SHA256 maps before/after the production build and after
the app batch, renderer artifact hashes, Node/Electron binary hashes, loaded
production modules, raw health snapshots, invoked fixture channels, resource
samples and both drive free-space readings. The source maps cover main/shared,
Observatory sources and tests, Vite configuration, package metadata and lockfile.
The script refuses source drift during measurement. Build and fixture commands
run with child-only X-drive paths when the caller selects an X-drive output.

A successful receipt establishes this dormant local integration only. It does
not establish normal application startup, production sender authorization,
installed/packaged behavior, Linux/macOS operation, native delivery, attribution,
provider execution, enforcement, or full W9 acceptance. A successful build alone
does not establish any runtime result.
