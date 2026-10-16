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

### Other qualification

Without `--monitoring`, PASS covers the visible packaged-window lifecycle with modeled installation
authority. It does not qualify real UAC/linked-principal installation, authenticated
GUI enrollment, monitoring freshness, renderer interaction journeys, real guest or
provider execution, or an elapsed 30-minute lease. Use the separate Electron bridge
smoke for its interaction scope. A1-A4 remain UNREVIEWED, `guiEnrollment=false` and
`launchAllowed=false`. Record the tested source SHA and actual result with each PR;
an older receipt cannot qualify changed relevant source.
