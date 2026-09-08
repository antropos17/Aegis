# ETW consent probes and suspend gate

The consent probes are implemented in the standalone lifecycle harness. They
exercise refused elevation and a collector launched after its authorization
channels expire. They do not enable a provider or connect ETW to Electron.
Live results require human interaction with Windows consent dialogs. The local
normal-token checks are explicitly simulated and cannot close the live gate.

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
a dialog. No UAC UI was automated or policy changed. Confirm human interaction
before repeating; refusal and late-consent gates remain unverified. Suspend was
not attempted. Do not count this early-approval result as successful refusal.

## Suspend/resume: procedure design, not a completed experiment

Do not put the host to sleep using an existing `uac`, `uac-failures` or consent
command. The current collector has a 25-second lifetime and four-second read
lease; the witness has two query phases. None records native power transitions.
A delayed timer or stopped heartbeat alone cannot demonstrate an actual suspend.
There is no `uac-suspend` command yet.

Prepare a dedicated mode before running this gate:

1. Add a power-notification observer to the normal coordinator, with a bounded
   event record. Capture suspend/resume notifications, wall-clock and monotonic
   timestamps, plus unbiased interrupt time; do not infer a particular sleep
   state from the notification alone. Preserve the host's available sleep states
   and scoped System-log transition metadata without exporting the full log.
2. Extend the witness with an explicit, bounded phase sequence for preflight
   absence, ready presence and final absence. All consent and authentication must
   complete before displaying **ready for manual sleep**. Choose test-specific
   lifetime/deadline behavior that survives the intended sleep interval; record
   the actual timer behavior across resume instead of assuming all clocks agree.
3. In this isolated mode, treat a power transition as a terminal gap. Revoke the
   old launch, attempt its owned-handle stop and require process exits plus final
   independent absence. Never accept an old delayed `ready`, pong or terminal as
   a new session. Missing final counters remain null. Do not auto-restart or
   remove an occupied session. Power callbacks must not block on native stop.

After those prerequisites and normal-token tests pass, on a host the user is
ready to suspend: launch the dedicated mode, confirm ready/presence, manually
sleep and wake the computer, then inspect the saved transition evidence and
cleanup. Repeat only for a different question: short sleep, sleep longer than
the lease, and hibernation where supported. Distinguish each observed power
state and retain failures. A wake without a recorded transition pair is
incomplete; clean absence without transition evidence is only cleanup evidence.

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
