# Recovery after original main, broker and three helpers exit

This page retains the temporary-custodian design and twenty-eight-capture evidence
at `6ede1763`. The current [durable-recovery follow-up](etw-durable-recovery.md)
also persists one protected reservation for loss of all six original processes;
its next-launch recovery has separate source-bound evidence.

That v9 revision added a temporary elevated custodian outside the five originals,
using the original capture elevation. It installed no service, scheduled task,
account change, machine permission or durable journal. It could not restart the
application or capture; ordinary packages kept ETW disabled. Its historical
receipts do not qualify loss of the custodian together with the originals.

## Authority before capture

Before StartTrace, the collector duplicates noninheritable query-limited plus
synchronize references to original Electron main, broker, collector, primary guard
and fallback into the custodian. These references have no terminate right. The
custodian verifies full births, image, user, logon, expected elevation and original
main/broker parent relationship. Its collector parent is mutually authenticated
through the existing restricted-pipe policy. Only fully proved local deposits are
closed; invalid imports never close caller-provided handle values.

The broker independently verifies the custodian's original identity before sending
the existing main custody prelude. The final capture authorization therefore needs
both custody acknowledgments. Original objects remain referenced after owner exit;
no exited PID is reopened. See Microsoft's [object handle lifetime](https://learn.microsoft.com/en-us/windows/win32/procthread/process-handles-and-identifiers)
and [DuplicateHandle contract](https://learn.microsoft.com/en-us/windows/win32/api/handleapi/nf-handleapi-duplicatehandle).

The custodian controls only the reserved GUID, after all five originals signal
exit. It uses the existing exact GUID query, handle recheck, handle-only stop and
absence query. EOF, a timeout or any live original authorizes no control. After
observing main exit, its original-peer wait is bounded at twenty seconds. Successful
cleanup returns a finite receipt and exit 4, with unknown stage totals and an
observation gap. There is no post-failure capture or new elevation request.

While main survives, existing main recovery keeps authority. After the other four
originals exit, the custodian only queries absence and yields with exit 0. If a
later capture owns a different GUID, it yields unverified with exit 2 and never
controls that session. On unknown/denied observation it retains custody until main
exit. Collector and broker never wait for custodian exit during their own shutdown.
Custodian loss during capture closes the collector channel and fails the sensor
through existing cleanup.

## Observation and faults

The optional normal-token `observe-custodian` witness uses a first-instance,
restricted local pipe. It authenticates the actual elevated custodian and waits
on that original process object. The elevated client uses identification SQOS;
the normal sink cannot impersonate it. No observer input is read by the custodian.
The observer receives finite phases and terminal metadata, without the reservation,
process-handle values, paths or file contents. Losing this sink never cancels
cleanup. The custodian writes no file or standard-stream diagnostic.

`--etw-orphan-recovery` plans twenty-eight captures with a forty-minute ETW deadline:
before StartTrace, before arm, main-first, elevated-triple-first, restricted-token
probe, custodian-only exit, and the [twenty-two earlier cases](etw-main-custody.md).
It plans twenty-eight capture consents and the two earlier cleanup consents;
read-only queries denied by Windows may require more consent.

For a local qualification batch, `EtwFile qualification-launcher <qualification-root>`
offers one explicit UAC consent for a temporary launch host. Its private endpoint
is passed only through the batch's process environment as `AEGIS_ETW_QUALIFICATION_HOST`.
The normal launcher owns its bootstrap connection and stdin lifetime. The host
expires after forty minutes, accepts at most 128 connections and 64 launches, and
has no service, scheduled task, persistent configuration, file writer or ETW
control path. It launches only its own executable with the existing collector or
cleanup-worker argument shapes. Each caller must be the actual normal-token
same-image, same-user/logon native child of a live normal packaged main. All pipe
peers are verified with original process handles and full birth times. Capture
fixtures must remain under the initially authorised ordinary directory tree.
The normal caller receives only a noninheritable query/synchronize child-object
reference; no remote TerminateProcess right is granted. Normal main and broker
remain unelevated. Native collector/guard/custodian validation and reservation
cleanup are unchanged; the host holds no reservation or recovery handles.

This batch qualifies activation through that temporary host, rather than thirty
separate ShellExecute consent interactions. It does not independently qualify
each ordinary UAC activation. The mutable lab package is not a protected-install
trust boundary. No Windows UAC setting, permission, account or global environment
variable changes. Closing the normal launcher ends new launch authority; the
host waits boundedly for existing children and reports any still alive without
terminating them. A failed batch must preserve its receipt and check trace/helper
closure. Internal main diagnostics expose only four original native process IDs
for existence observations across this changed parent relationship; GUID, births
and process handles remain private.

The host waits for explicit acceptance after the caller validates its deposited
query-only reference. This is necessary because
[DisconnectNamedPipe discards unread bytes](https://learn.microsoft.com/en-us/windows/win32/api/namedpipeapi/nf-namedpipeapi-disconnectnamedpipe);
an asynchronous flush alone cannot establish receipt. A real native delayed-reader
test failed with immediate disconnect and passed with acknowledgment. Selected
qualification processes retain finite failure checkpoint exit codes; no raw
exception, reservation or identity data is emitted.

Original main exits 73; broker/collector/guard/fallback deliberately exit
75/70/71/74 without cleanup in the five total-loss cases. Actual packaged main-first
loss also produced normal-broker exit 0; its cause is not established. The oracle
accepts only broker 0 or 75, while still requiring the five retained original
objects to be signaled, main 73, native triple 70/71/74, and live-session query 0
before the custodian's own control (4201 only before StartTrace). A broker that
already cleaned a running trace therefore cannot satisfy this cleanup proof.
These are coordinated
exit orders, not instruction-level simultaneous death or actual unhandled SEH.
The restricted probe must observe actual native status 5; reverting that diagnostic
thread restriction restores the already granted original token before cleanup.
It does not qualify persistent denial or request new elevation. Custodian-only
exit 76 must leave main alive, Sensors FAILED, an observation gap, verified cleanup
and no automatic restart. A separate fresh capture checks actual synchronous and
pending overlapped read attribution and acknowledged normal stop.

## Historical twenty-eight-capture evidence

The frozen runtime at `6ede1763` passed all twenty-eight real packaged captures
in one final sweep: six original-main/custodian scenarios and all twenty-two
earlier regressions. See the [bounded evidence](../recon/evidence/etw-packaged-orphan-custody.json).
Main-first and native-triple-first recovery, both pre-capture boundaries, actual
restricted-token status 5 and custodian-only exit passed. The retained original
objects, terminal cleanup, independent absence, visible failure and helper closure
were checked. Capture and application never restart automatically.

One explicit UAC consent started the temporary fixed-image host for this final
sweep. It launched twenty-eight collectors and two cleanup workers, rejected an
unowned normal CLI caller, then exited with zero live child processes. Main and
broker remained normal-token. No Windows UAC setting, service or global permission
changed. This qualifies the host activation route; thirty ordinary ShellExecute
interactions were not independently repeated. The standard profile without the
host still plans those individual consent decisions.

Both final read workloads performed 160 synchronous and 160 actually pending
overlapped reads with full issuer witnesses. Rapid-exit evidence stayed unresolved
when proof was unavailable. Collector loss retained null final totals and an
observation gap; the fresh normal capture stopped with acknowledgment and exit 0.
Loss counters and ring evictions remain measured values in the evidence, without
a loss-free or complete-I/O claim. All 40 profiles, including failed
attempts, passed bounded content and diagnostic-audit exclusion checks.

All 231 archived main/shared JS/JSON files match frozen runtime source, the
published native DLL matches the package, and no mutation fixture entered the
archive. Later changes contain documentation and evidence only. Native self-tests
passed 100 cases; 321 focused JS tests passed across ten files; all 16 protected GUI
Windows tests passed locally. Frozen-runtime hosted build, formatting/lint,
typecheck/Svelte, coverage/witness/count gates, production dependency audit and
Windows fixtures passed. Final PR-head checks are tracked in GitHub. Local
Semgrep remains unavailable (`ENOENT`).

Earlier attempts retain one expired host consent, two failed startup handshakes,
an overly strict broker-exit oracle, and a health observation before first reliable
scan. The delayed-reader test reproduced the missing-ACK pipe failure before its
fix. The warmup observation now waits for actual reliable health within thirty
seconds. Temporary diagnostics preserve existing capture exit codes after startup.
Those earlier FAIL receipts remain failures; none was rewritten into the final
PASS. Earlier hosted Windows fixtures also needed a retry after natural-exit
control 14 failed outside this patch; a later pass does not establish its cause
or a product fix.

Those historical receipts do not qualify protected installation, loss of the
custodian with the originals, actual sleep/wake, forced real PID/TID reuse,
complete I/O coverage or production/path admission. Volatile custody does not survive every process or machine
failure. Private diagnostics use manual seven-day review, preserving failed
attempts and verification obligations; no automatic deletion is configured.
