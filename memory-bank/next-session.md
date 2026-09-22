# AEGIS — starting the next chat

Current continuation: [explicit pinned HTTPS](../docs/MCP-HTTPS-GATEWAY.md) adds endpoint descriptor v2 with operator-selected IPv4, CA, hostname and leaf SHA256 checks. It retains finite MCP and persistent-grant boundaries. No OAuth, DNS discovery or automatic certificate renewal. Owned fixtures are the evidence; third-party/provider compatibility remains unverified. Receipts: `X:/tmp/aegis-mcp-tls-20260922/receipts`; preserve, review after 14 days or 64 MiB.

Current continuation: [persistent MCP grants](../docs/MCP-DURABLE-GRANTS.md) add opt-in manifest v2, bounded local consumption records and expiry across stdio/HTTP restarts. V1 remains connection-local; task IDs are operator metadata, not verified identity. B2/B3 remain partial. Receipts: `X:/tmp/aegis-mcp-grants-20260922/receipts`; preserve and review after 14 days or 64 MiB. Consumed permission records are authorization state and must not be pruned as diagnostic output.

## Current assignment — AI-agent protection, 2026-09-22

B2.2 adds an [explicit loopback HTTP profile](../docs/MCP-HTTP-GATEWAY.md), sharing
B2.1 grants/schema/catalog checks. It pins a literal local endpoint and bearer,
uses finite JSON/SSE responses, rejects redirects/session replacement and never
automatically reinitializes or retries. Cancellation attempts an upstream
notification and DELETE; HTTP acknowledgement does not prove remote execution
stopped. Real loopback/Node CLI fixtures cover this boundary; installed-provider
and third-party HTTP compatibility remain unverified. This adds no public listener,
OAuth, OS containment or Observatory gateway coverage.
Receipts: `X:/tmp/aegis-mcp-http-20260922/receipts`; preserve them and review after
14 days or 64 MiB. Fixtures close their owned servers/sockets and remove their
temporary directories. No global retention change was made.

B2.1 now adds an [explicit stdio gateway](../docs/MCP-STDIO-GATEWAY.md): exact
one-attempt tool grants, bounded input/output schema validation, fresh accepted
catalog checks and direct-child cleanup. Real disposable upstream/CLI fixtures
cover allowed calls, replay, mutation, malformed traffic, cancellation and death.
B2 remains partial: OAuth and third-party HTTPS interoperability, general recipient/scope enforcement, protected launch
and third-party server/provider compatibility remain unverified. Gateway routes
are not yet connected to Observatory coverage. Diagnostics for this pass live at
`X:/tmp/aegis-mcp-gateway-20260922/receipts`; preserve receipts, review after 14 days
or 64 MiB. Owned fixtures are removed after each test and have bounded lifetimes.

Start with [the current handoff](ai-protection-handoff.md) and the current source.
B1 includes live lifecycle intake, policy-controlled selected execution, exact
approval binding and MCP routes. B5 includes preflight and opt-in live observation.
Installed Claude Code 2.1.263 passed running-child cancellation for selected and
catalog direct-stdio routes using synthetic local replies. The native negative
control failed when cancellation delivery was removed. See
[verification and boundaries](../docs/ACTION-LIVE-OBSERVATION.md).

Native selected/catalog owner-crash tests now cover sticky loss, retained pending
counters, stale endpoint rejection and explicit fresh-generation recovery. On
Windows Node 24.11.1 a held OS handle confirms direct-child exit after owner death;
this is runtime-specific evidence, not general descendant containment.
The nearest B5 interruption/crash cycle is complete: four real broker/relay tests
cover pending/running review cancellation, and installed Claude passed all eight
selected/catalog × direct/review × interrupt/crash scenarios. A cancellation-delivery
mutation fails. See the latest section of the observation document and its receipt.
Do not restart this completed verification slice. C1 descendant control remains
separate work. Independent identity,
verified blocking coverage and outside-route control remain open. A5, B1 and B5
are partial; the broader B2–B4/C1–C3/D1 queue is not implemented by this verification.

Select a clean worktree from current `origin/master`; preserve the dirty original
checkout. Read the handoff for source paths, evidence limits and disk precautions.
Earlier ETW/other-roadmap assignments below are historical context and do not
replace this queue. Check current refs/status before doing new work.

---

## Historical handoffs

## Current state — instructions and documentation, 2026-09-11

Baseline: `17a3c0d`, merged PR #438. Backend passes #428–434 were followed by
protection overview #435, radar Files/Network #436, selection/toolbar #437 and
Alert watchlist feedback #438. The watchlist increases observation; it neither
grants nor blocks access. All five required CI contexts for #438 passed.

The current pass repairs instructions, the agent example, CSS guidance and
historical links; application code is unchanged. Check publication results through
the `codex/instructions-docs-repair` branch/PR.

Worktree: `X:/tmp/aegis-etw-burst-20260911`. Check refs/status before continuing.
Preserve the dirty original checkout at `X:/Future/ESCAPE/AEGIS`.
Local `.agents/` and `.claude/` are Git-ignored; their fixes are outside the
public PR. The reviewed `aegis-context` needs no substantive changes.

Source and installation differ: the last known installed application corresponds
to #427; updates #428–438 were not installed. The last preview ran on port 8875
with demo data; check availability again. Do not use old PIDs or tool session IDs
to control processes.

Backend limits below remain: bursts lose events; E4/E5 identity, independent
absence, crash recovery and deployment are open; sleep testing is deferred.
Historical instructions below to "check the final merge" refer to completed passes
and do not create a new assignment.

## Previous step — output-pump wakeup, 2026-09-11

In `X:/tmp/aegis-etw-burst-20260911`, branch `codex/etw-output-wakeup` from
`3d88df4` (merged #433), an output-queue readiness signal replaces `Task.Delay(10)`.
One TaskCompletionSource uses the same lock, completes on the first enqueue and
resets on the final Take/invalidation; an empty invalidation does not abandon a waiter.
`FilePumpWait` also waits for stop, mapper/capture completion, cancellation or
heartbeat. Completed stop/capture tasks are excluded during drain; the five-second
deadline is preserved. Protocol v4, build suffix `-wakeup`; main, workload and
limits are unchanged.

49 C# self-tests, three normal/loss-check scenarios each and all local checks passed.
JS: 200 files / 3354 passed / 4 skipped. Live on the same binaries: 66000 reads
in 19.800 s, delivered 111722, filtered 45703, overflow 50246,
invalidation/ingress/native loss 0, map resets 6, ring evictions 15516.
Fixture Read/PID found, stopVerified true, exit 0, helpers 0.
Output high water 1922 / 4193804 bytes; pump 340.821 ms, write 263.684 ms,
remaining pump work 77.137 ms; main decode 307.434 ms. Idle waits 40 versus 1264;
these now wait for a signal/heartbeat instead of polling. Idle total 19589.352 ms
includes quiet periods; the 1983.918 ms maximum is not wake latency.

Loss remains. 50246 versus the previous 52066 does not prove throughput gain:
actual burst rate and background activity differ. Next E3 step: short
arrival/drain/occupancy intervals, output-ready→resume latency and broker
forwarding time, then choose the next change. Do not increase buffers blindly.
E4/E5 identity, independent absence, crash recovery and deployment are open.
Sleep testing is deferred. Report: `docs/roadmap/etw-output-wakeup.md`;
three raw JSON reports and 28 hashes:
`docs/recon/evidence/etw-file-home-26200-output-wakeup.json`.
Check the final PR/CI/merge. The installed application was not replaced;
preserve the original dirty UI checkout.

## Previous step — ETW timings, 2026-09-11

In `X:/tmp/aegis-etw-burst-20260911`, branch `codex/etw-service-timings` from
`4006268` (merged #432), protocol v4 adds collector pump/outputWrite/idleWait,
separate ingress/output depths, and main decodeChunk/acceptFrame/retainBatch/snapshot.
These are accumulated elapsed times, not CPU times. Do not add nested intervals.
Metrics use bounded memory; final reports survive stop; old v1–3 are rejected.

39 C# and 161 focused JS tests passed. Normal/loss-check passed three scenarios each.
One live UAC run on the same binaries: all 66000 reads in 19.738 s, delivered 117946,
filtered 51927, overflow 52066, invalidation/ingress/native loss 0, resets 6,
ring eviction 11775. Fixture Read/PID found, stopVerified true, exit 0, helpers 0.
Pump 173.667 ms, including write 124.442; remaining pump work 49.225. Empty wait
19702.462 ms total / 15.587 ms average / 24.365 ms maximum. Main decode 161.116 ms;
snapshot 687.099 ms includes polling while waiting for UAC. Output high water
1922 records / 4193804 bytes. Do not add nested timings or timings from different processes.

Next E3 experiment: wake an empty output pump when data arrives, preserving
cancellation, stop/drain and limits, then repeat the fixed profile.
The large idle total includes test pauses and does not establish the cause of loss.
Load and background activity changed; do not claim improved throughput.
E4/E5 identity, crash recovery, independent absence witness and deployment remain open.
Sleep testing is deferred; the installed program was not replaced. Report:
`docs/roadmap/etw-service-timings.md`; three raw JSON reports and 26 hashes:
`docs/recon/evidence/etw-file-home-26200-service-timings.json`.
Check this branch's final PR/CI/merge; preserve the original dirty UI checkout.

## Previous step — output-loss causes and serialization, 2026-09-11

In `X:/tmp/aegis-etw-burst-20260911`, branch `codex/etw-output-drain` from
`93aae23`, `outputOverflowDropped` and `outputInvalidatedDropped` are implemented.
Their sum equals `outputDropped`; ingress + output equals `dropped`.
The protocol is now `etw-file/3`; v1/v2 are rejected. Main retains separate
causes and maximum values in the report.

`FileWire.WriteObservations` encodes records directly into the final UTF-8 frame,
without separate size serialization or an intermediate JsonElement. Queue limits,
128 records, the 32 KiB target and 256 KiB wire cap are preserved. The encoding
buffer starts at 64 KiB; Utf8JsonWriter reserve is bounded at 768 KiB, while actual
JSON remains capped at 256 KiB. An empty queue allocates no frame and consumes no seq.
In a 30-batch test, managed allocations fell from 4301280 to 1983120 bytes (about −54%).
35 C# self-tests, 141 focused JS tests and build/formatter passed; normal/loss-check
passed three scenarios each on identical binaries.

Live with the same `repeated-read-4k-v1`: all 66000 reads in 20.005 s. Whole session:
290598 delivered, 224580 filtered, overflow 51648, invalidation 0,
ingress/native loss 0, decoder errors/conflicts 0, map resets 6, ring eviction 14113.
Scoped Read/PID found; stopVerified true, exit 0, helpers 0. Loss remains;
background activity and actual burst rate changed, so comparison with the previous
49406 does not establish a throughput change. Loss is localized to output-queue overflow.

Next E3 step: measure encoding and pipe/broker/main waiting times, queue depths
and idle-polling effects, then choose the next change. Do not increase buffers blindly.
Report: `docs/roadmap/etw-output-drain.md`; original normal/loss/live JSON and
23 hashes: `docs/recon/evidence/etw-file-home-26200-output-drain.json`.
Sleep testing is deferred; the installed application was not replaced.
Check the final PR/CI/merge; preserve the original dirty UI checkout.

## Previous step — repeatable ETW load, 2026-09-11

In `X:/tmp/aegis-etw-burst-20260911`, branch `codex/etw-repeatable-load` from
`0f40a6d`, added `node scripts/verify-etw-file.mjs --live --load-check --report=<new file>`.
One UAC prompt; a normal-token worker performs three cycles of 2000 paced +
20000 burst reads of 4096 bytes, with one handle per phase and a two-second pause
after each. The profile is fixed; actual rate, delays and partial results are
retained. Main/helper are unchanged.

Live on the previous binaries completed all 66000 reads in 19.896 s. Whole ETW session:
956985 delivered, 890960 filtered, ingressDropped 0, outputDropped 49406,
native loss/decoder errors/map conflicts 0, map resets 6, ring eviction 16362.
Fixture Read with path/PID found; stopVerified true, exit 0, helper processes 0.
Loss was reproduced at the output stage. `outputDropped` combines overflow and
invalidation, so the exact cause is not yet established. Counters include
background activity and are not divided by phase; one run does not prove
statistical repeatability.

Next E3 step: measure and improve output/serialization, separating output-discard
causes; compare using the same profile. Report: `docs/roadmap/etw-repeatable-load.md`;
two original JSON reports and 22 hashes:
`docs/recon/evidence/etw-file-home-26200-repeatable-load.json`.
`passed` in load mode means measurement/stop completed; losses are allowed and
retained. Sleep testing is deferred; the installed application was not replaced.
Check the branch's final PR/CI/merge; preserve the original dirty UI checkout.

## Previous step — ETW loss by stage, 2026-09-11

In `X:/tmp/aegis-etw-burst-20260911`, branch `codex/etw-stage-loss-counters`,
`ingressDropped` and `outputDropped` are implemented; their sum must equal `dropped`.
The main/helper protocol is now `etw-file/2`; old v1 is rejected. The new schema
lives in `etw-file-schema.js`; main retains separate maximum and final values.
Filtering, decoder errors, native losses and main-ring evictions are counted separately.
Output loss includes invalidation, so it does not by itself establish a slow writer.

28 C# self-tests and 128 focused JS tests passed. The ordinary process-check and
new `--loss-check` passed three scenarios each: deliberate overflow produced
4097 ingress and 6270 output drops, which reached the report through real
normal-token processes. A real UAC/ETW run on the same binaries passed:
57927 delivered, 57597 filtered, ingress/output/native loss 0, decoder errors 0,
map resets 321, ring eviction 11. Fixture Read with path/PID found,
stopVerified true, exit 0, helper processes 0.
Load was lower than before; this does not establish that overload is fixed.
Next: repeatable load to localize remaining loss; E3 remains open.
Report: `docs/roadmap/etw-stage-loss.md`; three original JSON reports and
20 source hashes: `docs/recon/evidence/etw-file-home-26200-stage-loss.json`.
Sleep testing is deferred; the installed program was not replaced.
Check the branch's final PR/CI/merge before further work; preserve the original dirty UI checkout.

## Previous step — ETW queues and live measurement, 2026-09-11

Backend work continued from `8b16692` in the separate checkout
`X:/tmp/aegis-etw-burst-20260911`. PR #428 merged as `7b1e153`; all five CI contexts passed.
`FilePipeline` no longer performs process queries or JSON serialization in the
mapper: fresh process witnesses are collected at output, without locking the map
and with the previous rate limit. Loss during a query invalidates and counts its result.
The regression check first failed with the old mapper, then passed: 8,192 additional
reads and Close were handled while the witness query was blocked, with ingress
drops 0; output-queue overflow was counted separately.

27 C# self-tests, Release build/formatter, three normal-token process scenarios
and 110 focused JS tests passed. Report/boundaries: `docs/roadmap/etw-burst-handling.md`.
The user then authorized a real UAC/ETW run. It passed on the same binaries:
463,125 delivered, 456,150 filtered, 6,674 dropped (~1.44%); all three native loss
counters 0, decoder errors and ring eviction 0. Fixture Read with its path and
test-process PID found; stopVerified true, exit 0, helper processes 0.
Original reports and 18 source hashes:
`docs/recon/evidence/etw-file-home-26200-burst-live.json`.
Background load differed from the earlier run; do not claim a measured speedup
or elimination of all loss. The dropped counter still combines both queues.
Next backend step: separate loss by stage and reproduce the load; E3 remains open.
Sleep testing is deferred; the installed program was not replaced. Evidence branch:
`codex/etw-burst-live-evidence`; check its PR/CI/merge before continuing.

## Previous continuation — B5, 2026-09-09

The user requested the full file-event/transport/backend block, leaving sleep
testing for later. `codex/etw-file-backend` implements the new diagnostic collector
`sidecar/etw-file`, supervisor/runtime and the health leaf connection in main.
Check the final PR/CI/merge status. Details and commands:
`docs/roadmap/etw-file-backend.md`, `sidecar/etw-file/README.md`.

This supersedes the older statement below that the application does not import
the protocol/health modules. Capture requires an explicit development flag with
one root; packaged builds do not include it. File events remain candidates in
bounded main-process memory; agent and instanceId are always null. Nothing is
forwarded to FileEvent, risk, baseline, sequence or audit.
Do not declare all of "reliable attribution" complete: E4/E5 remain open.

22 C# self-tests and three real normal-token process scenarios passed: two normal
sessions and EOF with unverified stop. Events are synthetic; native counters are null.
Latest result: `X:/tmp/aegis-etw-file-check-20260909-v6.json`.
JS protocol/reducer/supervisor and main-composer checks passed (110 tests).
The user authorized a real UAC test. Final live smoke passed:
`X:/tmp/aegis-etw-file-live-20260909-05.json`, binaries matching the normal run,
a Read candidate with the test process's path/PID, native counters 0, stop/child exit 0.
However, application queues dropped 12,061 of 88,772 events; this remains degraded
and does not complete E3. 76,418 events were filtered by policy; ring eviction 0.
A second bounded buffer separates the mapper from query/write; each is 4096 / 4 MiB.
Queue telemetry reports maxima across the two stages, not their sum; dropped is combined.
The aggregate `docs/recon/evidence/etw-file-home-26200-backend.json` retains 20 LF
source hashes, final normal/live reports and four early live attempts, including
the first acceptance failure. There is no independent absence witness or confirmed attribution.
SLEEP TESTING REMAINS DEFERRED. The next backend improvement is loss during load bursts.

A clean checkout of the backend patch passed format/build/lint, TypeScript/Svelte,
coverage (2928 pass, 4 skip with maxWorkers=2), both verification gates, counts and npm audit.
The first unbounded local coverage run hit ENOMEM/missing Electron dist; after
installing dist and limiting workers, the rerun passed without test changes.
The NuGet check, including transitive dependencies, also found no known vulnerabilities.
These are local results; check the final five CI contexts and merge separately.

Separate changes appeared during work in App/AgentCard/DemoBanner/ShieldTab,
Observatory components/styles/assets and the LiveRadar test. These belong to the
user, as do `.codex/agents/ui-designer.toml` and `memory-bank/fancy-ui-plan.md`;
exclude them from the backend commit. Run full backend verification on a clean
checkout of the commit.

## Previous handoff — B4

Updated 2026-09-08 after implementing a separate suspend harness without real sleep.
B2: PR #384, `f2f1ac4`; B3: PR #385, `cc47212`, both merged with five green CI contexts.
B4: PR #386, `01bf403`; first UAC stop: PR #387, `1f7cd82`, both merged with five green CI contexts.
Elevated cleanup merged: PR #388, `75c943d`, five green CI contexts.
First UX block merged: PR #389, `69530bd`, five green CI contexts.
Second UX block merged: PR #390, `8519796`, five green CI contexts.
Broker-death merged: PR #391, `37eac4a`, five green CI contexts.
Consent probes merged: PR #392, `7646463`, five green CI contexts.
First unsuccessful live attempt retained: PR #393, `045f2b0`, five green CI contexts.
Real refusal/late cases passed: PR #394, `54f22ee`, five green CI contexts.
Current backend block: `codex/etw-suspend-harness`; check the final PR status.
This instruction and the latest Session handoff in `memory-bank/progress.md` are
the continuation point. Check the current branch and file status first: the user
may have added other changes since this context was recorded.

## Completed work

The user separately authorized a lightweight UX audit and changes to the current
interface. Fixed the wait for first activity, Network access, Shield grouping,
filter resets, empty-feed messages, navigation to fresh events and keyboard input
in select controls. The risk index moved from a panel overlapping the feed into a
compact summary beside navigation; narrow Shield layouts retain feed height and scrolling.
Report: `docs/recon/ux-activity-review.md`. Browser checks used the built demo:
1440/1100 px dark and 1440 px light. Seven new regression tests.
This was a separate focused UI task; ETW code and completed measurements were unchanged.

The second pass fixed active-tab color in all four themes. Removed the false
"Scan complete" toast that appeared when the process count changed and called
processes agents. The header already shows separate counts and Scanning/Idle;
anomaly notifications are preserved. Two App tests cover these scenarios;
41 focused tests passed. Minimum measured contrast for the selected tab and its
hint was 9.29:1; this is not a contrast audit of the entire interface.
The same report was updated.

Application-process grouping: PR #378 (`60b66f0`). Skill names in file events:
PR #379 (`e98a199`); names come from paths, unknown agents remain unknown,
and directory creation is not treated as skill use.

Isolated `sidecar/etw-probe` harness: PR #380 (`59ca1ec`); repeated load:
PR #381 (`39da76e`); buffer comparison and extended run: PR #382 (`52cfbe7`).
It uses .NET 10 / TraceEvent 3.2.6 without Electron integration. All five required
CI contexts for these PRs passed before merge. The installed application was not updated.

The user already ran real measurements from ordinary PowerShell with a separate
UAC prompt for the collector. Do not repeat these commands without a new reason:

- `X:/tmp/aegis-etw-matrix-20260908`: 11 scenarios.
- `X:/tmp/aegis-etw-load-20260908`: 9 background/npm CLI/build measurements.
- `X:/tmp/aegis-etw-tune-20260908`: 9 buffer comparisons and one continuous 10-minute session.

All finished with exit code 0 and no reported collection loss/errors. The requested
16 MiB actually produced 256 buffers of 64 KiB, saving 48 MiB compared with 64 MiB.
During the long run, process memory fluctuated between 67–78 MiB and ended near 71 MiB.
16 MiB is a tested candidate for these workloads on Windows 11 Home 26200.8655;
it is not an already applied production budget or a universal guarantee.

Details and aggregates with original-file hashes:
`docs/recon/kernel-file-etw-measurements.md`, `docs/recon/evidence/etw-home-26200-*.json`.
The 13-question matrix remains partly open: ordinary test reads are linked to
process/path/QPC; the PID filter admitted both test processes; preopened files
remained pathless; warm mmap produced no Read events associated with the file.
Zero loss counters do not prove complete read coverage. Do not treat header PID
or a late TID-owner lookup as universally proven identity.

## B2/B3 complete; B4 prepared; real E1/E2 remain open

`docs/roadmap/etw-sensor-design.md` is the first design draft, checked against
source at `53b20e4`. Preparing it does not approve production integration.
It describes one `etw-file`, an ordinary C# broker and elevated collector, framed
transport, queues/loss, identity boundaries, unknown paths and agents, health,
and eight groups of focused checks E1–E8. Current FileEvent and its `confirmed`
state are unsuitable for direct ETW-candidate ingestion; diagnostic observations
do not enter baseline/risk/audit/sequence.

B3 implements `src/main/platform/etw-file-protocol.js` and `etw-file-health.js`,
with tests/fixtures in `tests/main/platform/`; the exact offline contract is
section 8 of the design. The decoder retains one bounded frame, requires a
synchronous consumer, and validates UTF-8, closed fields, uint64 and launch/session
binding. The reducer retains loss/unmeasured intervals, validates hello/ready/terminal,
rejects old sessions and never turns a diagnostic profile into HEALTHY.
It contains no event array.

The application does not import B3 modules. B4 adds a separate
`sidecar/etw-lifecycle` (.NET 10, no NuGet packages). Current `etw-lifecycle/2`
checks its own transport: a secured local pipe, mutual PID/full FILETIME/image/
user/logon/elevation verification, authorization before session creation, lease and stop.
A collision with an existing session name makes the harness refuse; it never
cleans up another session.

12 self-tests and eight scenarios with real ordinary processes passed: stop,
stdin EOF, broker death, collector exit/kill, lease, blocked write and simulated
launch refusal. They do not call ETW or report zero native counters: counters remain null.
Result: `X:/tmp/aegis-etw-lifecycle-check-20260908-v3/result.json`;
aggregate with hashes: `docs/recon/evidence/etw-lifecycle-home-26200-check.json`.
Release build and C# formatter passed. No harness processes remained after verification.

**Real UAC normal-stop already passed; do not rerun it without a new reason.**
After the user's "continue", the agent launched the prepared `uac` from an
ordinary process; the elevated collector passed mutual verification and stopped
the empty `AEGIS-EtwLifecycle` session normally. Result:
`X:/tmp/aegis-etw-lifecycle-uac-20260908/result.json`, exit 0.
Initial query and final stop: status 0; 256 × 64 KiB; all three loss counters 0.
Received stopped, child exit 0 and session absence after stop (4201).
The file provider was not enabled; no harness processes remained after the run.
Aggregate: `docs/recon/evidence/etw-lifecycle-home-26200-uac-stop.json`.
Apphost/assembly matched the normal-token run; LF source hashes were checked
against the merged commit. Historical raw hashes from before checkout are retained
separately and cannot be compared directly after Git line-ending conversion.
Same-account cross-integrity operation is confirmed on this host.

**New graceful-failure scenarios are also implemented and verified.** Version 2
uses two pipes with separate IDs and identical DACL/process checks; authorization
is sent after both are verified. The second carries a single `cleanup` after the
stop attempt, with its own 1 s timeout. In blocked-write, a partially written
primary stream is never resumed for reading. Primary ack and cleanup receipt
are retained separately.

14 self-tests, eight normal-token scenarios and `uac-failures` with four real
sessions passed: stop, parent stdin EOF, lease and blocked write. All had stop 0,
absence 4201, 256 × 64 KiB and loss counters 0; child exits were 0/0/9/10 respectively.
In blocked-write, primary ack was false and cleanup receipt true. No harness processes remained.
Reports: `X:/tmp/aegis-etw-cleanup-check-20260908/result.json` and
`X:/tmp/aegis-etw-cleanup-uac-20260908/result.json`; aggregate:
`docs/recon/evidence/etw-lifecycle-home-26200-cleanup.json`, with canonical LF
source hashes and identical binary hashes for both runs. Do not repeat without a new reason.

**Independent broker-death verification is now implemented and passed a real run.**
`check-broker-death` does not call ETW; `uac-broker-death` launches a query-only
witness before broker/collector. After mutual authentication, the coordinator
holds the collector through QUERY_LIMITED_INFORMATION | SYNCHRONIZE, verifies
FILETIME/image/user/logon/elevation and observes the session before the kill.
Only the ordinary broker is terminated; after it and the collector exit, the
witness queries the fixed name again. The witness has no stop/start operation
or arbitrary session-name input.

19 self-tests and nine normal-token cases passed. The real run
`X:/tmp/aegis-etw-broker-death-uac-20260908-v2/result.json` passed: before query 0,
256 × 64 KiB, broker killed/exited, collector exit 0, after query 4201, witness exit 0.
No harness processes remained after the run. Final counters are null: session
absence cannot reconstruct a lost terminal/stop receipt. Aggregate with 14 LF
hashes, three successful reports and the first unsuccessful attempt:
`docs/recon/evidence/etw-lifecycle-home-26200-broker-death.json`.

`docs/roadmap/etw-crash-ownership.md` records the orphan rule: an occupied name
blocks launch; a matching name, old PID or file-stored GUID does not authorize
deletion. Future cleanup requires a protected session owner and proven association
with its generation, including the replacement race. Service/automatic cleanup
are not implemented.

**Controlled refusal/late-UAC commands were checked without elevation and passed real runs.**
`check-consent` explicitly injects 1223 and delays ordinary-process launch.
`uac-refusal` requires "Yes" for the query-only witness, then "No" for the collector.
`uac-late` requires "Yes" for the witness, then a 10-second wait and "Yes" for the
collector under the same user. The new consent-broker closes both pipes after
5 seconds and when launch returns; it never sends authorize, even after an early "Yes".
Ordinary Broker.cs and its launch deadline are unchanged. Live acceptance requires
independent absence 4201 before/after, a valid launch outcome and process exit.
The code does not cancel the OS consent dialog; a person handles a stuck dialog.

22 self-tests and ten normal-token cases passed on the final identical binaries.
Reports: `X:/tmp/aegis-etw-consent-check-20260908-v3/result.json` and
`X:/tmp/aegis-etw-consent-regression-20260908-v2/result.json`; aggregate with
17 LF hashes: `docs/recon/evidence/etw-lifecycle-home-26200-consent-check.json`.
ETW was not called; all native stats are null; no harness processes remained.
Do not present these normal-token checks as real UAC outcomes.

After "continue", a real `uac-refusal` was launched, but the collector started
after 1567.0161 ms instead of being refused. The test correctly failed (exitCode 2):
early-consent, native error null, authorize false, identity verified, child exit 2.
Independent before/after queries returned 4201, witness exit 0; no harness processes remained.
Full report: `X:/tmp/aegis-etw-refusal-20260908/result.json`; aggregate with
17 LF hashes and binaries matching normal-check:
`docs/recon/evidence/etw-lifecycle-home-26200-consent-live.json`.
This does not establish whether a person saw a dialog or clicked "Yes". The UAC
UI was not automated and policies were unchanged. After initially reporting no
windows, the user confirmed two windows and clicking "Yes" in both during recent
attempts. Do not automatically apply that explanation to every earlier run.

**Both required live outcomes have now passed; do not repeat without a new question.**
Refusal: `X:/tmp/aegis-etw-refusal-retry-20260908-192954/result.json` — Windows
error 1223, injected false, child not launched, authorize false, exitCode 0.
Late consent: `X:/tmp/aegis-etw-late-20260908-193019/result.json` — launch returned
after 14130.4995 ms, channels expired, identity verified, child exit 2,
authorize false, final exitCode 0. Both had independent before/after query 4201,
counters null, witness/broker exit 0 and no remaining harness processes.
The aggregate `docs/recon/evidence/etw-lifecycle-home-26200-consent-verified.json`
contains 17 canonical LF hashes, both successful reports and five early failed attempts.
Apphost/assembly matched normal-token checks. UAC code and settings were unchanged.
These establish separate negative-broker scenarios; ordinary Broker.cs and its
timeout were unchanged. Cancellation while the OS dialog is still open and all
of E1/E2 are not resolved by these checks.
`X:/tmp/aegis-uac-no-dialog-diagnostic-20260908.md` is an earlier intermediate
diagnostic note; do not automatically resume missing-window investigation from it.

**Suspend mode is implemented; the user explicitly deferred real sleep.**
The readiness question was answered "We will test sleep later". Do not launch
the live check or put the computer to sleep without a new indication of readiness.
`check-suspend` checks real normal-token processes with an explicitly synthetic
pair of power events; `uac-suspend` registers a native callback and requires real
suspend 4 → automatic resume 18. Select "Yes" in both UAC prompts, wait for
READY FOR MANUAL SLEEP, manually select Windows "Sleep", then wake it after ~20 seconds.
After completion, `Capture-SuspendContext.ps1 -ReportDirectory <run>` saves
powercfg /a and bounded System-event metadata, including unsuccessful runs.
This host supports connected S0 Modern Standby; S3/hibernation are unavailable.

`PowerObserver` retains at most 16 events with UTC/QPC/unbiased clock, performs
no ETW/I/O in the callback, rejects event injection in native mode and verifies
unsubscription. Witness-suspend uses preflight/before/after; the old witness
retains before/after. Suspend-role deadlines: broker/peer 600 s, witness 720 s,
coordinator 480 s; the 4 s lease and short I/O bounds are preserved.
Actual .NET timer behavior during sleep is not yet measured. An owned stop request
is sent after suspend; acceptance requires the power pair, primary/cleanup receipts,
final counters, independent absence and exits. No restart, automatic sleep or elevated kill.

29 self-tests and 12 normal-token cases passed on identical final binaries.
Actual native power callback registration/unregistration was checked without sleep;
transitions in the process scenario are synthetic, ETW was not called and native
stats are null. The cancellation-after-ready test also waited for normal
collector/broker/witness exit 0. No processes remain.
Results: `X:/tmp/aegis-etw-suspend-check-20260908-v3/result.json` and `power-context.json`;
regressions: `aegis-etw-suspend-regression-20260908-v2`,
`aegis-etw-suspend-consent-regression-20260908-v2`,
`aegis-etw-suspend-death-regression-20260908-v2` under `X:/tmp/`.
The aggregate `docs/recon/evidence/etw-lifecycle-home-26200-suspend-check.json`
contains 21 LF source hashes, including ps1, four full reports and power context.
An [English translation of the captured sleep-state output](../docs/recon/evidence/etw-lifecycle-home-26200-suspend-check.en.md)
is available; the original evidence retains the captured Windows text.
The context script was also checked in Windows PowerShell 5.1. Exact steps and
limits: `docs/roadmap/etw-consent-suspend.md`. Next tasks: manual sleep when the
user is ready, and protected ownership/recovery after collector crash.
E1/E2 still require other credentials/logons and remote clients.
There is no automatic orphan deletion; elevated collector death may leave a session.
Do not present normal-token kill as an ETW cleanup test. CI does not build this C# project.
Do not repeat the three completed measurement sets. Electron integration and
installation are outside this harness; full B1 and E3–E8 remain open.

Start/stop correlation, timers/lease, ID uniqueness and completed-summary storage
are the future supervisor's responsibilities. Ordinary byte EOF does not confirm
ETW stop: the transport owner must call failSession if stopped was not received.
Confirmed attribution still requires E4/E5; late PID/TID lookup or a matching
public instanceId does not establish it. Full B1 remains open.

Apply project skills, run checks appropriate to the change and use the authorized
Git workflow through a PR, five CI contexts and merge. UI, dependencies, workflows,
installation and the default budget remain outside this continuation without a
separate basis.

## Remaining queue and rules

A1: the race between listing running WSL distributions and `wsl -d` can still
start a stopped distribution; polling again provides no atomic guarantee.
Then A2 POSIX signatures and A3 Docker/Podman. Separately, D2 macOS identity and
A4 GPU reconnaissance. C1/C2, D1, SQLite and Sensor Health are complete; do not restart them.

Open PRs when checked: #352/#353 Vitest, #354 Vite, #364 release 0.15.0-alpha.
These are outside the current ETW block. A release/tag and protected configurations
require separate authorization. AGENTS.md defines the current Git and verification
rules; the ordinary full cycle is already authorized. Do not launch other agents
unless the user asks.

The user is handling the large frontend effort separately; both lightweight UX
passes are complete. The latest request returned work to the backend to complete
several related ETW tasks. Do not repeat the successful broker-death check without
a new reason. Respond briefly in Russian, using plain language.
