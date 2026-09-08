# ETW broker death evidence and orphan ownership

This is the next B4 slice after the version 2 graceful-failure evidence. It
separates a lost broker from a crashed elevated collector. Both are failures of
the transport, but only the surviving collector still holds the original session
handle and in-memory stop authority.

## Implemented broker-death experiment

The normal coordinator first launches a query-only witness, then a normal broker
and its elevated collector. Both elevated launches use explicit same-account UAC.
The witness authenticates its held coordinator; the coordinator authenticates the
held witness using the existing kernel peer PID, exact creation FILETIME, image,
user/logon and elevation checks. Its protected first-instance local pipe uses the
existing DACL, remote rejection and identification SQOS.

The witness's `etw-witness/1` protocol accepts only `before` then `after`. The only
native operation in that helper is QUERY of `AEGIS-EtwLifecycle`. Requests cannot
choose a session name, command, executable, provider or output path. Frames are
closed JSON with bounded lines, UTF-8 validation, depth limits and fixed phases;
a failed exchange cannot be retried on the same stream. Authorization consists of
the authenticated request, after mutual identity checks. There is no START, STOP,
UPDATE, provider-enable, configuration-write or orphan-removal request.

The broker reports ready only after authenticating its collector and receiving
its post-StartTrace readiness. The coordinator holds that collector instance and
checks creation time, image, user/logon and elevation. The witness must observe
the fixed session present before the deliberate kill. The coordinator terminates
only its held normal broker, waits for both broker and collector exit, then requests
one final independent query. No elevated process or process tree is killed.

The coordinator's collector handle requests only PROCESS_QUERY_LIMITED_INFORMATION
and SYNCHRONIZE and stays held through exit. The .NET `Process.SafeHandle` reopening
path can request all-access; it is avoided for this cross-integrity observation.
[Process access rights](https://learn.microsoft.com/en-us/windows/win32/procthread/process-security-and-access-rights),
[.NET 10.0.10 process implementation](https://github.com/dotnet/runtime/blob/v10.0.10/src/libraries/System.Diagnostics.Process/src/System/Diagnostics/Process.Windows.cs).

Acceptance requires every condition below:

| Evidence | Required result |
| --- | --- |
| Collector readiness and identity | Authenticated broker ready; exact held collector identity verified before kill. |
| Independent initial query | Success, known statistics and actual nonzero buffer fields. |
| Deliberate failure | Held normal broker killed and exited; collector exited 0. |
| Independent final query | Status 4201 after both exits; unavailable statistics remain null. |
| Observer | Restricted pipe, authenticated held peer, successful query exchange and exit 0. |

The coordinator starts the witness first so its consent cannot consume the
collector's short lease. The scenario deadline is 150 seconds live / 35 seconds
normal; a query exchange has five seconds and each witness write has two seconds.
The helper has a 165-second lifetime. Consent and synchronous native calls have
no proven hard cancellation deadline. Cancellation before launch starts nothing;
after launch, pipe closure/EOF permits cleanup and incomplete exits stay failures.

Successful absence is an independent point-in-time observation of the fixed name.
It does not recover the lost stop acknowledgment or final counters, prove lossless
capture, or establish ownership of a future session with the same name. The
development apphost and managed build remain trusted inputs. These are separate
processes on one host, not protection against a compromised coordinator or admin.

`check-broker-death` exercises real normal-token processes and both witness queries
with **no native ETW calls** and null statistics. It cannot satisfy the live gate.
`uac-broker-death` enables one empty session and runs the live acceptance above.
The original collector protocol remains `etw-lifecycle/2`; report schema remains 2
with a `mode` discriminator and a separate broker-death outcome shape.

The [recorded result](../recon/evidence/etw-lifecycle-home-26200-broker-death.json)
passed on the local Home host on 2026-09-08: independent before query 0 with
256 × 64 KiB buffers; broker killed/exited; held collector exit 0; independent
after query 4201; witness exit 0. Final counters remain null. There were no harness
processes afterward. The same binaries passed 19 self-tests, eight old normal-token
cases and the new normal witness case. The first incomplete live attempt is
retained; its coarse diagnostic does not prove a precise failure stage or cleanup.

## Orphan policy: current decision

Retain refusal on occupied name. Do not add automatic recovery to the current
user-writable standalone harness. After collector death, a new process has no
retained creation handle or trusted durable ownership record. A matching name,
GUID copied from a local file, dead PID, binary path or old log entry does not grant
authority to stop whatever currently occupies that name. Query followed by
stop-by-name also leaves a replacement race.

| State | Allowed current action |
| --- | --- |
| Live collector holds successful StartTrace authority | Request its normal owned-handle stop; retain authority if stop fails. |
| Broker dies, collector survives | Collector stops through its original handle; independent witness checks absence. |
| Name already occupied before StartTrace | Fail launch; no attach, stop, rename or second session. |
| Collector crashes or ownership is uncertain | Report stop unverified, refuse restart on collision; no automatic deletion. |
| Query fails or access is denied | Preserve unknown status; neither absence nor zero counters may be inferred. |

A future production recovery design should put creation and stop authority in a
single protected privileged controller that outlives the data worker, validate
its installation/integrity and authenticate clients. Losing that controller is a
separate crash case. Durable intent alone is insufficient: recovery must establish
how a record refers to the same live session generation and how replacement races
are excluded before granting stop authority. Until proven, recovery stays blocked
on occupancy and reports a gap. This is a design requirement, not an implemented
service or a claim that GUID/handle persistence solves generation ownership.

Before implementing recovery, test foreign occupancy, forged/stale records, PID
reuse, session replacement between query and stop, controller/worker crash,
failed stop and reboot. Keep a foreign session alive through every refusal case.
Actual elevated collector kill remains outside the current harness commands.

## API basis and remaining gates

Microsoft documents session lifetime beyond controller exit and recommends a
bounded number of descriptively named sessions. That guidance motivates recovery
design; it does not make a name an authorization credential.
[StartTraceW](https://learn.microsoft.com/en-us/windows/win32/api/evntrace/nf-evntrace-starttracew).
Query retrieves properties and statistics; stopping is a distinct operation that
invalidates the handle.
[ControlTraceW](https://learn.microsoft.com/en-us/windows/win32/api/evntrace/nf-evntrace-controltracew).

The [dedicated refusal/late-consent probes](etw-consent-suspend.md#verified-refusal-and-late-approval)
have now passed on this host. Other credentials/logons, remote clients, suspend,
pending-dialog cancellation, collector crash and production deployment remain open E1/E2 gates. File providers,
Electron wiring, attribution E4/E5 and other E3–E8 gates remain outside this slice.
The completed matrix/load/tune and graceful-failure sets need no repeat here.
