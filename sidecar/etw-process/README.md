# Process ETW diagnostic slice

This independent helper and `src/main/platform/etw-process-protocol.js` implement
protocol `aegis-etw-process-diagnostic`, version 1. The executable exposes
`--metadata`, `--fixture`, and `--self-test`. Capture classes are internal and
have no executable, Electron, IPC, or UI launch route. `launchAllowed` remains
`false`. Polling remains the active process fallback.

The slice does not supply population, identity, file mapping, audit, or risk
inputs. W11 file admission blocks 1/2 and block 3 keep their existing order;
this is separate preparation for process block 4. Compilation and synthetic
fixtures establish no live start/stop coverage, latency, elevated launch,
crash recovery, or production readiness. No 1,000-process or <50 ms claim follows.

## Selected schema

The selected manifest provider is `Microsoft-Windows-Kernel-Process`, GUID
`22fb2cd6-0e7b-422b-a0c7-2fad1fd0e716`, process keyword `0x10`. The exact accepted
event descriptors are start `1:4` (opcode/task `1/1`), stop `2:2` (`2/2`), and
rundown `15:2` (`0/15`). Older and future versions count as unknown. Rundown stays
distinct from start. The installed provider's `EventMetadata.Template` supplied
the ordered names/types recorded in `schema-pins.json`; its source metadata
digest is included. [EventMetadata.Template](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.eventing.reader.eventmetadata.template)
describes provider payload structure. These pins were independently checked
against the installed manifest using
[TdhGetManifestEventInformation](https://learn.microsoft.com/windows/win32/api/tdh/nf-tdh-tdhgetmanifesteventinformation).
The classic kernel Process MOF documentation does not establish these modern layouts.

Before constructing native capture, TDH must match the selected provider,
ID/version, ordered scalar names/types, and counts. The decoder validates the
entire bounded payload layout, including SID and terminated string fields.
String/SID values and raw payloads are discarded. Only numeric observations
leave the decoder; diagnostics use fixed error codes.

`subjectPid` comes from payload `ProcessID`. `headerPid` is retained separately
and supplies no subject authentication. `creationTime100ns` preserves the raw
unsigned FILETIME as a canonical decimal string, with
`payload-CreateTime-FILETIME` provenance, or both fields are `null` for zero.
There is no conversion through a JavaScript number, timestamp guess, cached
birth, or current process handle. A later handle cannot retrospectively
authenticate an already-exited short-lived PID.

The manifest's `ProcessSequenceNumber` is preserved separately as
`providerProcessSequenceNumber` with explicit payload provenance, or `null`.
It is not relabeled as ProcessStartKey or a birth time. None of the selected
templates supplies a subject ProcessStartKey, so `processStartKey` is always
`null`. [EVENT_EXTENDED_ITEM_PROCESS_START_KEY](https://learn.microsoft.com/windows/win32/api/evntcons/ns-evntcons-event_extended_item_process_start_key)
describes the process logging the event; it cannot establish this payload
subject's identity. Generation UUIDs scope capture/wire sequences; they do not
prove a Windows boot or connect witnesses across boots.

## Bounds and stop semantics

The ledger retains at most 1,024 numeric events plus begin/stopping/stop frames.
It rejects payloads over 32 KiB, bounds terminated strings to 8 KiB, and counts
unknown decoding and local overflow explicitly. The native session requests
eight 64 KiB buffers and common buffering, with no ETL file. ETW can adjust buffer
allocation; actual memory bounds still require native measurement. See
[EVENT_TRACE_PROPERTIES](https://learn.microsoft.com/windows/win32/api/evntrace/ns-evntrace-event_trace_properties)
and [logging modes](https://learn.microsoft.com/windows/win32/etw/logging-mode-constants).
Common buffering is a diagnostic choice and is not a high-volume qualification.
No retained image names, command lines, package names, or user SIDs enter the wire.

Every frame carries protocol, version, exact provider, capture generation, and
contiguous sequence. The Node collector bounds retained evidence, rejects
unknown fields and mismatched provenance, records duplicate observations and
QPC reversals, and preserves arrival order. Events arriving after `stopping`
remain admissible until the consumer finishes. A successful native stop alone
or a final sequence alone cannot establish drain.

`transportDrained` requires the stopping/stop sequence, exact admitted count,
successful owned native stop, successful consumer completion after stop, and no
provider/protocol failure. `diagnosticComplete` additionally requires known zero
native/local losses, zero unknown decodes, duplicates, and QPC reversals. This is
capture diagnostic completeness; a null identity witness remains null.
[ProcessTrace](https://learn.microsoft.com/windows/win32/api/evntrace/nf-evntrace-processtrace)
may deliver events out of order and can return several seconds after session
stop. The coordinator first invokes owned native `ControlTrace` synchronously.
Only after that call returns does its one-to-ten-second consumer wait budget
start. That budget does not bound the native call or total shutdown duration.
If the consumer wait expires, the coordinator requests consumption cancellation
and emits an incomplete receipt. Cancellation does not cancel a native API call
or prove resource release. A blocked native stop can prevent return altogether.
The final counter supplies no drain proof.

Native session start/enable failure, consumer failure, stop failure, host crash,
and orphan cleanup remain qualification requirements before exposing capture.
Owned handle stop prevents name-based adoption; this helper has no separate
retained owner/guard and has not qualified crash recovery. Capture must remain
unexposed until authenticated parent/crash cleanup and total shutdown behavior
are qualified. No in-process timeout supervision or native-call abandonment is
implemented. Native constructor,
callback delivery, filter support, buffering/loss accounting, shutdown timing,
and actual provider rundown have not been exercised by synthetic fixtures.

## Focused checks

Build the standalone project with .NET 10 and run the compiled DLL with
`--self-test`. Run `npx vitest run tests/main/etw-process-protocol.test.js --project main`
for the protocol boundary. The existing main-project include discovers its
eleven pure JavaScript cases on every platform. To include the twelfth,
compiled synthetic fixture case, set the process-local
`AEGIS_PROCESS_FIXTURE_PATH` to the JSON output of `--fixture` before running
the check. Set `AEGIS_PROCESS_REQUIRE_COMPILED=1` for the qualified local Windows
run, so missing fixture input fails instead of skipping. Without these inputs,
the compiled case is explicitly skipped. Providing synthetic compiled output
does not establish hosted native or capture acceptance. Use physical dependencies
in the selected checkout; do not install into a shared dependency junction.

Use task-owned NuGet, artifacts, CLI-home and temporary directories on the data
drive. Set `DOTNET_GENERATE_ASPNET_CERTIFICATE=false` before the first SDK call;
`DOTNET_SKIP_FIRST_TIME_EXPERIENCE` is obsolete and does not prevent certificate
creation in .NET 10. See [.NET CLI environment variables](https://learn.microsoft.com/dotnet/core/tools/dotnet-environment-variables#net-sdk-and-cli-environment-variables).
Retain verification receipts; disposable build/cache outputs have a 24-hour
post-review retention target. The local qualification budget is 512 MiB for
task-owned caches/artifacts and 2 GiB for physical test dependencies. Check measured growth
before cleanup; skip locked files and reparse points and preserve receipts.
