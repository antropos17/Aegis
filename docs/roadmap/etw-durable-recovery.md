# ETW recovery after all six original processes exit

The next [restart-spanning qualification](etw-reboot-recovery.md) is prepared;
its actual Windows restart remains pending. It does not extend the live evidence
recorded here.

The diagnostic capture can recover a leftover session at the next explicit capture
launch after main, broker, collector, guard, fallback and custodian all exit. It
uses a protected write-ahead reservation. Recovery does not run while every
application process is absent and does not automatically resume observation.

Production ETW remains disabled. This extends the
[temporary custodian](etw-orphan-recovery.md) mechanism;
earlier receipts keep their original, narrower scope.

## Persistent authority

The authenticated elevated custodian writes one reservation before acknowledging
setup. Collector cannot call StartTrace before that acknowledgment. The record
contains six original PID/full-FILETIME birth pairs, the random reserved GUID,
and user SID, logon SID and helper image scope. No process handles, monitored
contents, credentials or arbitrary cleanup target are persisted.

The fixed 64-bit HKLM application-state key is
`SOFTWARE\AEGIS.EtwFileRecovery.v1`; its only value is `Reservation`, binary JSON
bounded to 8192 bytes. Creation supplies a protected DACL allowing only SYSTEM
and Administrators. Existing state must have that exact two-ACE DACL and an
administrator/SYSTEM owner; an unsafe key is refused without repairing its ACL.
Opening uses OPEN_LINK, and links, subkeys, extra values, duplicate fields and
invalid shapes are refused. RegFlushKey completes before the acknowledgment.
Flush is limited to reservation and retirement, outside event processing.
Microsoft documents its [hive-wide I/O cost](https://learn.microsoft.com/en-us/windows/win32/api/winreg/nf-winreg-regflushkey); no startup-latency or power-loss
qualification is inferred from flushing this bounded record.
The named mutex serializes writers; the key's DACL is the privilege boundary.
Normal-token qualification observes an actual access-denied result when requesting
write access. No existing Windows permission or UAC policy is weakened.

After all six processes exit, a newly consented collector creates its own
recovery cohort. Its custodian reads the protected previous record before allowing
the next StartTrace. Every original identity must be proved gone: a signaled
query/synchronize process object, an absent PID, or a different full birth for a
reused PID. A live identity or failed observation blocks capture. Reopened PIDs
grant observation only; no remote handles are imported or closed, and no process
is terminated. Recovery authority comes from the protected reservation.

Actual control also requires the same user, logon and helper image path. The
fixed-name query only discovers the session; the stored random GUID must match,
and the ETW handle is queried again before handle-based stop. Independent status
4201 is required afterward. Foreign sessions and access denial stay unverified.
Foreign-scope metadata may be retired only after independent absence and six
proved exits; that branch performs no ETW control. It avoids retaining an absent
reservation after a package/logon change. Live recovery across those changes is
not qualified.

The next reservation replaces the previous one only after verified recovery.
Ordinary completion retires only the matching record after independent absence.
One small empty protected key can remain; no history grows in it. Corruption,
unknown identities, scope mismatch with a live session, failed persistence or
unverified control blocks new capture. The recovery receipt explicitly marks an
observation gap and null prior final
totals; it cannot reconstruct events lost with the original processes or supply
an old terminal frame. A fresh capture has its own counters.

## Qualification and evidence

The frozen runtime and harness at `35882984` passed one complete sweep: all four
new loss/relaunch cases, the overlapping live-owner rejection, and all twenty-eight
earlier captures. The host launched thirty-seven collectors and two cleanup workers,
then closed with zero live children. The final sweep used one manual UAC consent;
the two retained earlier failed attempts used one each. See the
[bounded evidence](../recon/evidence/etw-packaged-durable-recovery.json).

All 231 archived main/shared JS/JSON files match frozen runtime source and the
native DLL matches its published package. Native self-tests passed 107 cases;
393 focused JS tests passed across thirteen files. All 39 retained profiles,
including failed attempts, passed content and diagnostic-audit exclusion within
the 16/64-MiB inspection budgets. The two read workloads again performed 160
synchronous and 160 actually pending overlapped reads each. Native loss counters,
mapping uncertainty and ring eviction remain measured limits. The frozen-runtime
CI contexts passed; final PR-head CI is tracked separately in GitHub.

The four target cases cover loss before StartTrace, after StartTrace/before guard
arm, during capture, and real restricted-token status 5 during recovery. An
overlapping packaged launch must refuse a live original owner while that owner's
capture keeps running. Original native fault modes exit themselves; the harness
exits only its owned normal main. A normal-token witness authenticates the
custodian and retains read-only references to the five originals before faulting.
It observes all six exit codes and exits before the recovery main starts. It has
no cleanup authority. The temporary qualification host holds no reserved GUID or
ETW recovery handles and launches a fresh helper only for an authenticated new
packaged main. The fresh custodian must report journal recovery while paused
before its own StartTrace; a separate query must observe absence there.

All earlier twenty-eight captures are required afterward, including real
synchronous and pending-overlapped read attribution and acknowledged normal stop.
The successful combined profile has thirty-seven collector launches (including relaunches
and live-owner rejection) and two existing cleanup workers. It uses the temporary
fixed-image one-consent host. The ordinary ShellExecute route still prompts for
its individual launches and is not independently requalified by this host run.

Earlier failed attempts remain failed. The first new harness read diagnostics
inside a synchronous startup/module-loading stack; it now yields to the next
event-loop turn before reading exports. A second attempt reached protected
reservation and original-object observation but ended without the expected
custodian-fault receipt. Review found that the diagnostic all-six mode could
take ordinary pre-start absence/retirement while main was still closing. That
fault mode now waits for actual main-object exit and self-exits without retiring
the reservation. These are qualification changes, without a claim that an
application startup failure or ordinary cleanup defect was fixed.

## Boundaries

This is a mutable local diagnostic package. It grants no protected installation,
service, VM/provider, path admission or release acceptance. No seventh resident
watchdog, scheduled task, autostart or automatic re-elevation is installed. The
temporary qualification host is closed and its children accounted for after the
batch. Active-session recovery across reboot, logon changes or installation
paths, persistent access denial, power loss during persistence, instruction-level
simultaneous death, sleep/wake, forced live PID/TID reuse and complete I/O coverage
remain unqualified. Native tests cover conservative PID-birth comparisons and
absent foreign-scope metadata retirement; those are not live reboot evidence.

Private logs use a two-MiB child-output cap. Profile inspection requires at most
16 MiB per file and 64 MiB per profile and excludes synthetic contents and
diagnostic ETW/file-access audit rows. Review disposable closed diagnostics after
seven days; preserve failed attempts and receipts. No automatic deletion is
configured. No normal application data, global cache, user work or database was
cleaned to make the checks pass.

The Windows API contracts used here are documented by Microsoft:
[new-object security descriptors](https://learn.microsoft.com/en-us/windows/win32/secauthz/security-descriptors-for-new-objects),
[RegCreateKeyExW](https://learn.microsoft.com/en-us/windows/win32/api/winreg/nf-winreg-regcreatekeyexw),
[RegFlushKey](https://learn.microsoft.com/en-us/windows/win32/api/winreg/nf-winreg-regflushkey),
[process handles and identifiers](https://learn.microsoft.com/en-us/windows/win32/procthread/process-handles-and-identifiers),
and [ControlTraceW](https://learn.microsoft.com/en-us/windows/win32/api/evntrace/nf-evntrace-controltracew).
