# Recovery after original main, broker and three helpers exit

Protocol `etw-file/9` adds a temporary elevated custodian outside the five original
processes. The collector starts it using the original capture elevation. No service,
scheduled task, account change, machine permission or durable journal is installed.
It cannot restart the application or capture. Ordinary packages keep ETW disabled.
Loss of this custodian together with the five originals remains unqualified.

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
75/70/71/74 without cleanup in the five total-loss cases. These are coordinated
exit orders, not instruction-level simultaneous death or actual unhandled SEH.
The restricted probe must observe actual native status 5; reverting that diagnostic
thread restriction restores the already granted original token before cleanup.
It does not qualify persistent denial or request new elevation. Custodian-only
exit 76 must leave main alive, Sensors FAILED, an observation gap, verified cleanup
and no automatic restart. A separate fresh capture checks actual synchronous and
pending overlapped read attribution and acknowledged normal stop.

## Current evidence

Implementation and offline checks are prepared. Native self-tests passed 99 cases;
320 focused JS tests passed across ten files, and all 16 protected GUI Windows
tests passed locally. Effective typecheck, Svelte check, renderer build,
formatting, lint and tracked counts passed for the earlier revision. Its six
hosted contexts passed; Windows fixtures required a retry after a natural-exit
observation failure outside this patch. Current-head checks must be refreshed.
Normal-token synthetic transport passed. Semgrep is unavailable (`ENOENT`).
One host consent expired; two approved host batches failed before reservation,
with actual session absence and zero remaining launch-host children recorded.
These attempts are retained. The latter exposed the unread-pipe race above.
Packaged qualification of its correction is pending; no new live recovery PASS
or production admission is claimed here.

Protected installation, loss of the custodian with the originals, actual sleep/wake,
forced real PID/TID reuse, complete I/O coverage and production/path admission
remain separate gates. Volatile custody does not survive every process or machine
failure. Private diagnostics use manual seven-day review, preserving failed
attempts and verification obligations; no automatic deletion is configured.
