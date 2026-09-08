# ETW consent probes and suspend gate

The consent probes are implemented in the standalone lifecycle harness. They
exercise refused elevation and a collector launched after its authorization
channels expire. They do not enable a provider or connect ETW to Electron.
Live results require human interaction with Windows consent dialogs. Both
same-account consent cases passed on 2026-09-08. The local normal-token checks
remain explicitly simulated and cannot substitute for that live evidence.

## Controlled consent probes

From a normal PowerShell after a Release build, use a fresh directory per command:

```powershell
& './sidecar/etw-lifecycle/bin/Release/net10.0-windows/EtwLifecycle.exe' check-consent 'X:/tmp/aegis-etw-consent-check-new'
& './sidecar/etw-lifecycle/bin/Release/net10.0-windows/EtwLifecycle.exe' uac-refusal 'X:/tmp/aegis-etw-refusal-new'
& './sidecar/etw-lifecycle/bin/Release/net10.0-windows/EtwLifecycle.exe' uac-late 'X:/tmp/aegis-etw-late-new'
```

Run the live commands separately. Each first requests elevation for a query-only
witness: accept with the same account. After authentication, its initial query
must return absence (4201). Occupancy or unknown status prevents collector launch;
no session is attached to or removed. The coordinator then starts its normal
consent broker, which requests the second elevation:

| Command | Second dialog action | Required launch outcome |
| --- | --- | --- |
| `uac-refusal` | Choose **No**. | Actual launch error 1223, no child process, no injected denial. |
| `uac-late` | Leave open for at least **10 seconds**, then choose **Yes** with the same account. | Launch returns after the five-second budget, held child identity matches, child exits 2 after rejection. |

Both protected pipe servers expire after five seconds, even while the synchronous
launch waits for consent. The broker also closes them immediately when launch
returns. This dedicated negative probe **never sends authorization**, including
an unexpected early approval. The existing collector cannot call StartTrace
before successful pipe authentication and an authorization frame. Early approval
fails the late-consent test even when the final session query shows absence.

The broker retains its launch handle and records elapsed launch time, identity
verification, actual exit, native error and whether denial was injected. The
coordinator requires broker exit 0, witness authentication/DACL and exit 0, and
independent native absence before and after. Missing identity, unknown exit,
query errors, fabricated zero counters or missing evidence fail acceptance.
These absence queries observe the fixed name at two points; they do not measure
continuous session history. The no-authorization code path is a separate reason
the intended child cannot create a session.

`check-consent` injects error 1223 for refusal and delays a real normal-token launch
beyond an accelerated 50 ms budget. It uses real processes and protected pipes,
but all native statistics stay null. `InjectedDenial: true` cannot pass a live
refusal. Reports use schema 2, the command as `mode`, `liveEmptySession: false`
and `nativeQueryEnabled: true` only for live commands.

The coordinator allows 140 seconds; the witness has a 165-second lifetime and
bounded query/terminal exchanges. These bounds do not cancel the Windows consent
dialog. Resolve a pending dialog manually if the coordinator is cancelled or
times out. A late child has no surviving authorization server. The coordinator
may terminate only its normal broker; elevated children are never force-killed.
An incomplete run is retained and does not prove the absence of a pending launch.

This adds a test broker with a short revocation budget. It does not change the
ordinary lifecycle broker's launch timeout, implement a production supervisor,
validate alternate credentials or establish packaged binary integrity. The
mutable development apphost and assembly remain trusted inputs.

## Recorded live attempt

The first actual `uac-refusal` attempt on 2026-09-08 did **not** produce a refusal.
The collector launched after 1567.0161 ms, with verified identity and exit 2. The
broker sent no authorization; the authenticated witness observed absence 4201
before and after and exited 0. The command correctly reported failure because
the observed outcome was early consent. No harness processes remained.

The [complete failed report](../recon/evidence/etw-lifecycle-home-26200-consent-live.json)
retains the raw-report hash, matching normal-check binaries and 17 canonical LF
source hashes at `7646463`. It cannot establish whether a person saw or accepted
a dialog. No UAC UI was automated or policy changed. The user subsequently
confirmed seeing two dialogs and approving both on recent attempts. Do not infer
that action for every older run or count any early approval as successful refusal.

## Verified refusal and late approval

The [successful live evidence](../recon/evidence/etw-lifecycle-home-26200-consent-verified.json)
records two passing runs with the same apphost/assembly as the normal-token checks
and 17 canonical LF source hashes. All harness processes exited after each run.

| Scenario | Observed result |
| --- | --- |
| Refusal, 23:30 UTC | Actual Windows error 1223, no child launched, no injected denial, no authorization. |
| Late approval, 23:30 UTC | Launch returned after 14130.4995 ms; channels expired, held child identity verified, child exit 2, no authorization. |
| Both independent observations | Before and after status 4201 with null counters; authenticated witness exit 0, broker exit 0. |

The aggregate also retains five earlier failed early-approval reports. Successful
refusal and late approval close these narrow same-account negative-broker cases;
do not repeat them without a new question. They do not change the ordinary broker
deadline or validate cancellation while a dialog remains pending. Suspend,
alternate credentials/logons, remote clients, packaging and crash recovery remain
open. No policy change or security UI automation was used.

## Suspend/resume: implemented harness, live transition pending

Use the new dedicated commands, not `uac`, `uac-failures` or a consent probe:

```powershell
& './sidecar/etw-lifecycle/bin/Release/net10.0-windows/EtwLifecycle.exe' check-suspend 'X:/tmp/aegis-etw-suspend-check-new'
& './sidecar/etw-lifecycle/bin/Release/net10.0-windows/EtwLifecycle.exe' uac-suspend 'X:/tmp/aegis-etw-suspend-uac-new'
& './sidecar/etw-lifecycle/Capture-SuspendContext.ps1' -ReportDirectory 'X:/tmp/aegis-etw-suspend-uac-new'
```

The normal-token check injects a clearly marked type 4/18 pair and runs real
broker/collector/witness processes without ETW or sleep. It passes with synthetic
power evidence only in check mode. A native observer rejects injection.

The live command registers a native callback, then requests two UAC approvals:
query-only witness and empty-session collector. Approve **both**, using the same
account. After the exact **READY FOR MANUAL SLEEP** message, use Windows **Sleep**,
wait about twenty seconds and wake the computer. This first run requires human
readiness because it affects the host. The harness never invokes sleep, changes
power policy, disables hibernation or creates a wake task. A failed command retains
its report. Run the context script after completion, including failure.

The extended witness role accepts exactly `preflight`, `before`, `after`: absence
before collector launch, presence after readiness, absence after cleanup. The
existing role still accepts only `before`, `after`. Both use the authenticated
`etw-witness/1` transport; profile selection is fixed at process launch. No start,
stop, arbitrary session name or general command was added to the witness.

`PowerObserver` records at most 16 events. Each contains type, UTC, monotonic ticks
and unbiased interrupt time; the snapshot includes clock frequency and arm stamp.
Callbacks only capture and signal asynchronous continuations. A pre-arm suspend,
overflow, callback failure, missing native registration/unregistration, backward
clock ordering, missing/reversed/repeated transition pair or synthetic live
evidence cannot pass. The required sequence is suspend 4, automatic resume 18,
optionally followed by user-resume 7. UTC adjustments do not establish ordering.
The static native delegate stays rooted; a late callback cannot dereference a
freed managed object. Failed unregistration is reported and retains the small
subscription allocation until process exit.

Once armed, suspend triggers a single existing owned-stop request. No restart or
second launch occurs. Acceptance requires the observed pair, held child identity
and exit 0, authenticated primary stop and separate cleanup receipt with known
final counters, broker exit 0 and independent absence with witness exit 0. A lost
receipt remains incomplete even if absence succeeds. Cleanup on cancellation or
failure closes normal broker stdin and, if needed, terminates only that broker;
it never force-kills the elevated collector. Incomplete cleanup preserves failure.

Only the suspend role uses broker/collector lifetime settings of 600 seconds,
witness 720 seconds and coordinator 480 seconds. Per-read lease remains four
seconds; pings, write and final-query bounds remain short. These are configured
.NET deadlines, not proven wall-clock limits across sleep or synchronous native
calls. Other scenarios retain their original lifetimes. If resume exposes a lease
or receipt race, the strict result remains failed; do not substitute an ordinary
stop result for missing power evidence.

The context script records capture-time `powercfg /a`, capped at 8192 characters,
and at most 64 scoped System events per provider during the report interval:
Kernel-Power 42/107/506/507 and Power-Troubleshooter 1. Only provider, event ID,
timestamp and selected numeric state/reason fields are retained. No full event
messages, user SIDs, device paths or unrelated log are exported. Query failures,
empty results and truncation are explicit; the script never upgrades acceptance.

The [normal-check evidence](../recon/evidence/etw-lifecycle-home-26200-suspend-check.json)
records 29 self-tests, including real native registration/unregistration and
actual normal-token collector cleanup after cancellation when armed, and
twelve normal-token cases with matching binaries. The power pair is synthetic;
all ETW statistics remain null. The Home host advertises connected S0 Modern
Standby; S3 and hibernation are unavailable. Capabilities do not prove an actual
transition. No real sleep has been recorded yet. Further states/hosts and timer
behavior across real sleep remain open.

The production supervisor must start a new epoch after resume and report the gap;
that integration and its old-message rejection tests remain separate from this
empty-session experiment. Collector crash still requires the
[protected ownership/recovery design](etw-crash-ownership.md).

Windows delivers power notifications via
[WM_POWERBROADCAST](https://learn.microsoft.com/en-us/windows/win32/power/wm-powerbroadcast);
the notification alone does not identify the specific low-power state.
[PBT_APMRESUMEAUTOMATIC](https://learn.microsoft.com/en-us/windows/win32/power/pbt-apmresumeautomatic)
has a documented sleep-to-hibernation exception. The
[unbiased interrupt-time clock](https://learn.microsoft.com/en-us/windows/win32/api/realtimeapiset/nf-realtimeapiset-queryunbiasedinterrupttime)
excludes sleep and hibernation. These API facts guide the proposed measurements;
no current result proves suspend behavior of this harness's .NET timers.
The implementation uses the direct callback form of
[PowerRegisterSuspendResumeNotification](https://learn.microsoft.com/en-us/windows/win32/api/powerbase/nf-powerbase-powerregistersuspendresumenotification)
and checks
[PowerUnregisterSuspendResumeNotification](https://learn.microsoft.com/en-us/windows/win32/api/powerbase/nf-powerbase-powerunregistersuspendresumenotification).
