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

Implementation and offline checks are prepared. Native self-tests passed 96 cases;
319 focused JS tests passed across ten files. Effective typecheck, Svelte check,
renderer build, formatting, lint and tracked counts passed. Normal-token synthetic
transport passed. Semgrep is unavailable (`ENOENT`). Actual packaged qualification
is pending; no new live recovery PASS or production admission is claimed here.

Protected installation, loss of the custodian with the originals, actual sleep/wake,
forced real PID/TID reuse, complete I/O coverage and production/path admission
remain separate gates. Volatile custody does not survive every process or machine
failure. Private diagnostics use manual seven-day review, preserving failed
attempts and verification obligations; no automatic deletion is configured.
