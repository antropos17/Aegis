# Packaged desktop lifecycle milestone

The acceptance boundary is a built AEGIS desktop opening a visible Observatory
window through the existing Start/Query/Stop entrypoints, writing a fresh profile,
and stopping its original process Job with zero remaining members. This extends
the native helper fixtures with the actual Electron package. Installation account,
service, journal, VM, linked-token and protection authority remain modeled by the
shared `tests/fixtures/protected-gui-process/authority-fixture.ps1` setup.

## Reproduce

Use a clean isolated Git worktree on Windows x64, Node 24, the Windows Framework
C# compiler and an interactive desktop. Install that checkout's locked dependencies
with `npm ci`, with TEMP/TMP and npm cache on a spacious data drive. Then run:

```powershell
$source = git rev-parse HEAD
node tools/development/packaged-desktop.mjs --source-sha $source --output X:/task-storage/desktop-run-1
```

Choose an existing ordinary parent and a new output leaf outside the worktree.
The command rejects dirty source, a mismatched SHA, linked dependencies/output
ancestors, the primary checkout and less than 3 GiB free on source/output volumes.
It downloads Electron if absent, builds the production renderer and native helpers
through the existing electron-builder hook, and packages an unpacked Windows app.
No installer is run and nothing is published. Complete package integrity metadata
is generated and checked again after execution; source HEAD/tree and lock/compiler
hashes bind the receipt to the tested inputs.

The probe calls the production Start/Query/Stop functions under the explicit test
authority model. It retains the original process owner while observing only that
process's visible window. The PNG uses PrintWindow with a thread-local DPI context,
without desktop capture or UI input. Blank captures fail; image content alone does
not prove renderer interactions. Inspect the image separately. The fresh profile
must contain both Chromium's code cache and AEGIS's audit-index database. The probe
checks a live multiprocess Job, Stop, a repeated Query, retained profile data and
same-epoch launch refusal. Finally it repeats Stop and requires confirmed closure.

Each child log is capped at 2 MiB. Electron setup, packaging, probe compilation and
desktop execution have respective deadlines of 240, 300, 30 and 120 seconds.
The owned process tree is terminated on command timeout/overflow; that fallback
does not count as confirmed contract cleanup or PASS. A missing desktop receipt
also fails. No automatic retry occurs. Run-local TEMP/TMP and caches stay in the
output root. Source artifacts remain in the isolated worktree. The probe retains
its stage, profile and evidence, including failures; it does not recursively clean
them. Review closed disposable diagnostics after seven days, preserving receipts
and unresolved failures. This is a manual retention policy, not automatic rotation.

`evidence/receipt.json`, `desktop.json`, the complete package manifest and the
window PNG form the local evidence. The profile and screenshot can contain local
monitoring metadata: keep them private and inspect any material before sharing.
Disk growth is not hard-capped; record actual source/output/system free space and
measure long runs before starting another batch.

## First real-package finding

The initial native helper fixtures passed, but a real Electron launch transitioned
to `cleanup-unknown` on its next package check. The EXE's bytes, creation time and
last-write time were unchanged; its NTFS ChangeTime changed and a previously absent
object ID appeared. A native regression reproduces the same failure by requesting
`FSCTL_CREATE_OR_GET_OBJECT_ID` while the original process lease is live.

Staging now creates or retrieves the shell object ID through the original newly
created EXE handle before freezing its metadata. It never assigns or replaces an
object ID, reopens a candidate to establish ownership, or refreshes metadata during
execution. Original volume/file IDs, descriptors, streams, hashes, namespace pins
and timestamps remain enforced. The regression also changes another file's
metadata after Stop and requires refusal, preventing a blanket metadata exemption.
This native regression runs in the existing hosted Windows fixture selection;
the actual desktop probe remains opt-in and requires an interactive session.
Object-ID creation must succeed; filesystems without it fail closed during GUI
staging (Microsoft documents ReFS as unsupported).

Microsoft distinguishes [ChangeTime from LastWriteTime](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_basic_info),
documents [object-ID create-or-get](https://learn.microsoft.com/en-us/windows/win32/api/winioctl/ni-winioctl-fsctl_create_or_get_object_id)
and explains [shell link tracking](https://learn.microsoft.com/en-us/windows/win32/fileio/distributed-link-tracking-and-object-identifiers).
The observed object-ID transition and native reproduction establish this failure;
they do not identify the specific shell component that issued the original request.

## Remaining boundary

### Packaged monitoring scenario

Add `--monitoring` to the command above to run a separate Playwright journey
against the built EXE with an owned disposable profile and the ordinary current
user's authority. The protected Start/Query/Stop probe still runs first with its
unchanged fixed launch contract. Playwright's debugging transport is used only
for the separate monitoring journey; it does not qualify protected enrollment.
Its visible owned window ignores native mouse input and cannot receive keyboard
focus on the shared desktop. CDP drives the controls; webPreferences, sensor
providers and timer throttling are unchanged.

The scenario compiles a short-lived process named `aider.exe` as a signature
fixture, observes it through the real class-5 snapshot sidecar and preload bridge,
and selects its OS-stamped identity in the interface. It samples freshness for
85 seconds across startup and the transition to steady scans. It then pauses
the view, exits only its own fixture through stdin, verifies a reliable backend
exit observation, and resumes to the retained selection with unavailable current
measurements. It quits through the UI and checks that observed app/helper PIDs
have exited. No provider execution, process intervention against user processes
or sensor injection occurs. The parent runner gives this journey 180 seconds.

The private `monitoring/receipt.json` and two screenshots are retained beside
the existing package evidence. The final receipt hashes the monitoring receipt
and rechecks package/source integrity. Fixture matching proves process-name
detection, rather than the authenticity of an installed Aider product. Monitoring
PASS does not qualify file/network event attribution or every sensor/provider.

During warmup the scheduler reports its longest planned process-scan gap in
`scanCadence.maxProcessGapMs`. The renderer binds it to each reliable batch and
keeps the existing ten-second delivery allowance. Stats-only updates cannot
renew a population's age or shorten the schedule attached to that batch. Missing
delivery still expires; failed population/identity and monitoring pause remain
immediately unavailable.

### Packaged file and network sensors

Add `--sensors` to run a separate bounded Playwright journey on the built EXE.
It uses an ordinary current-user process named `aider.exe`, a synthetic home
selected through the child-only `USERPROFILE`, and a separate retained profile.
It creates, modifies, deletes and recreates a synthetic `.env` file, and holds
another `.env` file and a file inside `.ssh` open. Chokidar path events must
remain unattributed; Restart Manager holding observations must carry the fixture's
PID, stamped instance and observed creation witness. A directory holding record
identifies the sensitive group, without identifying the individual open file.

The fixture opens two TCP sockets to one IPv4 address resolved for `example.com`
on port 443, plus loopback sockets as a negative control. It sends no application
payload. The two public sockets must retain distinct local ports, the same exact
fixture instance and OS TCP-owner evidence. Loopback must remain excluded. The
journey saves a two-second scan interval through Settings and requires a fresh
positive network delivery within 20 seconds. It closes the public sockets while
the process remains alive, requires a later delivered empty fixture scope and a
cleared current network table, then observes the fixture's exit.

The journey checks visible file/network evidence and retained audit metadata,
including the create/delete/recreate order and both socket identities. Synthetic
file content contains a random canary; its presence in actual sensor
deliveries or the closed retained profile fails the run. Profile inspection is
bounded to 64 MiB total and 16 MiB per file. This covers a controlled content
exclusion check, without establishing every possible export or provider path.

`sensors/receipt.json`, `files.png` and `network.png` are private evidence; the
parent hashes the receipt and rechecks the package/source manifest. The journey
has a 240-second parent deadline, a 180-second native fixture lifetime and bounded
captured metadata. It verifies observed app/helper closure. Failures retain their
profile and diagnostic screenshot under the same manual seven-day policy.

This optional scenario requires public DNS and outbound TCP access. IANA's
[example domains](https://www.iana.org/help/example-domains) are documentation
resources with best-effort services; availability is an environmental dependency,
not a required hosted CI check. Windows
[`os.homedir()`](https://nodejs.org/api/os.html#oshomedir) honors the child
`USERPROFILE`; the user's real home and global environment remain unchanged.
No live ETW, transient open/close completeness, packet contents, bandwidth,
cross-platform sensor coverage or authenticated provider acceptance is qualified.

Saving settings invalidates the previous polling lifetime. Restart now queues a
replacement network query behind a fresh annotated process observation, even
when the population did not change. An old in-flight result is still discarded;
pause, identity/outage gates and the single-flight query remain enforced.

### ETW diagnostic profile

Add `--etw` to publish the pinned ETW helper with a local .NET 10 SDK and run the
real Kernel-File provider in the packaged app. The publish is a self-contained
Windows x64 folder, avoiding a runtime installation or elevated single-file
extraction. NuGet and SDK caches use the output directory. Default builds do not
publish or enable ETW. This optional run requires an interactive same-account UAC
decision; it never automates that decision or changes privileges/session ownership.

The marked diagnostic build also requires an explicit local root argument. Its
capture lasts at most 60 seconds after ready and remains diagnostic DEGRADED.
The journey reads an owned synthetic 4 KiB file from ordinary Node, observes a
Read candidate matching its header PID/path, checks bounded retention and scope
exclusion, and observes health through the real preload bridge and Sensors view.
It exits through the actual Quit AEGIS dialog while capture is active. A read-only
main observer records the final acknowledged stop, native counters, stage totals
and normal broker exit before app exit. Missing or unmeasured final counters fail
the scenario; positive measured losses remain visible and do not establish
loss-free capture. Candidate records never enter FileEvent/audit/risk/sequence
consumers; the retained profile is checked for synthetic content leakage.

The parent gives this journey 210 seconds and retains private `etw/receipt.json`,
`shutdown.json` and `etw.png`, hashing the receipt and the complete package. The
manual seven-day retention policy applies. A failure never causes an automatic
UAC retry, session adoption, name-based session stop or elevated kill. Normal quit
has a 15-second bound; timeout cannot count as acknowledged cleanup. Independent
session absence, protected collector crash recovery, consent cancellation, actual
sleep/wake, event-time attribution, complete read coverage and the remaining
E1–E8 gates remain unqualified. This profile is not production ETW admission.

### Other qualification

Without `--monitoring`, PASS covers the visible packaged-window lifecycle with modeled installation
authority. It does not qualify real UAC/linked-principal installation, authenticated
GUI enrollment, monitoring freshness, renderer interaction journeys, real guest or
provider execution, or an elapsed 30-minute lease. Use the separate Electron bridge
smoke for its interaction scope. A1-A4 remain UNREVIEWED, `guiEnrollment=false` and
`launchAllowed=false`. Record the tested source SHA and actual result with each PR;
an older receipt cannot qualify changed relevant source.
