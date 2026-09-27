# Selected Windows AppContainer launch

`--action-exec-appcontainer-confirm <policy.json> <request.json>` runs one
explicitly reviewed action inside a Windows AppContainer with zero capabilities
and an atomic Windows Job assignment. It is an offline, bounded CLI route.
Ordinary agents, desktop permission choices and watched processes do not enter
this route automatically.

Action control can run a preflight for this route: choose **Single action**, then
**Windows AppContainer CLI**, and select the policy and request JSON files. The
captured report checks the selected policy decision and current AEGIS process's
Windows runtime, interactive terminal and presence of the native helper at the
same path the CLI uses. A valid policy decision does not mean the route is ready:
the desktop process normally has no interactive terminal, while the separate CLI
may have one. An unavailable terminal or missing helper prevents a readiness
result for the checking process. File presence
does not verify the helper's protocol or integrity. The preflight does not launch
the action, create its workspace, verify AppContainer isolation, test installed
provider compatibility, or authorize later execution. It does not show private
file paths or the effective launch command in the desktop renderer. Recheck in
the intended terminal before using the separate CLI route.

## Select the action

Use the exact [execution policy](ACTION-EXECUTION.md) schemas: a schema 1 request
and schema 2 or 3 policy. Deny remains final. Allow and ask both require the
[terminal challenge](ACTION-CONFIRMATION.md) for this route. Refusal, expired
review, terminal loss and changed selected files prevent launch.

The absolute `cwd` must name a **new, nonexistent directory** on a local drive.
Its parent must exist. Existing directories, UNC/device paths, reparse ancestors
and ambiguous path components are refused. The helper creates the workspace
exclusively, grants its random sandbox SID access, and pins the directory during
execution. It never changes permissions on an existing project or installed
runtime. The workspace remains after the action stops; choose a fresh path for
every subsequent launch and inspect retained files before opening them.

Example request, with paths adjusted to your machine:

```json
{
  "schemaVersion": 1,
  "action": {
    "executable": "C:\\Windows\\System32\\whoami.exe",
    "cwd": "X:\\work\\aegis-new-run-1",
    "args": [],
    "env": {
      "SYSTEMROOT": "C:\\Windows",
      "WINDIR": "C:\\Windows",
      "TEMP": "X:\\work\\aegis-new-run-1",
      "TMP": "X:\\work\\aegis-new-run-1",
      "LOCALAPPDATA": "X:\\work\\aegis-new-run-1",
      "USERPROFILE": "X:\\work\\aegis-new-run-1"
    }
  }
}
```

Put the same complete action in the selected policy's `rules` with decision
`ask`. The environment above is explicit: `TEMP`, `TMP`, `LOCALAPPDATA` and
`USERPROFILE` must equal the new `cwd`; `SYSTEMROOT` and `WINDIR` identify the
Windows installation. The helper refuses inconsistent values. AEGIS does not
copy the parent environment, inject provider credentials, or silently rewrite
the approved action. The sample exits after inspecting its restricted identity; output contents are
discarded. Programs must accept standard Windows CRT argument quoting;
`cmd.exe` command parsing is not a supported example.

From a real terminal in a source checkout with dependencies installed:

```powershell
npm run build:sidecar
node src/main/main.js --action-exec-appcontainer-confirm X:\work\policy.json X:\work\request.json
```

To opt in to one exact local file snapshot, use the separate import route:

```powershell
node src/main/main.js --action-exec-appcontainer-import-confirm X:\work\policy.json X:\work\request.json X:\private\selected.bin
```

The terminal preview includes the selected path, byte count and copy operation
alongside the exact action. A private SHA-256 digest binds the snapshot to this
one launch and is not printed.
The native owner reopens the source with write/delete sharing denied, rejects
reparse points, UNC/device paths, alternate data streams, changed bytes and files
over 64 KiB, and copies the approved bytes as `input.bin` into the new workspace
before the child resumes. The source stays in place; its ACL is unchanged. The
import broker injects no source path or handle into the child; an operator could
still include the path in the separately approved action arguments. Other host
files remain subject to the same AppContainer access checks. This is a short offline action with one imported
file, not an interactive agent session or general filesystem broker.

The preview includes the exact effective action and explains workspace creation
and retention. Enter the displayed `RUN <challenge>` once. Piped input is refused.
No desktop IPC or automatic application update is added by this feature.

## Native boundary and receipt

The helper registers a fresh random AppContainer profile with zero capabilities.
Before resuming the selected process, it verifies `TokenIsAppContainer`, the
exact AppContainer SID and an empty token capability list. The Job and handle
allowlist are supplied during suspended process creation. Setup failure never
falls back to ordinary execution. An older Job helper cannot satisfy the distinct
isolated readiness and final receipt protocol.

Windows enforces AppContainer access checks for the process and ordinary
children. Private files without applicable sandbox grants are inaccessible;
resources granted to `ALL APPLICATION PACKAGES` can remain readable. This is
standard AppContainer, not LPAC. The profile also has temporary Windows-managed
storage. No network capabilities or loopback exemption are granted. Existing
system-wide exemptions, publicly granted resources and trusted external brokers
remain OS policy boundaries; this does not guarantee every host object is hidden.
See Microsoft's [AppContainer isolation](https://learn.microsoft.com/en-us/windows/win32/secauthz/appcontainer-isolation)
and [implementation guidance](https://learn.microsoft.com/en-us/windows/win32/secauthz/implementing-an-appcontainer).

Isolated startup has a ten-second bound. After native readiness the action has
five seconds, 64 KiB combined output accounting, and bounded cleanup. Output contents are
discarded. Cancellation and exit terminate Job members; workspace files remain
for inspection. This retention does not undo prior effects or move original
user files into quarantine.

The redacted report uses `control: "windows-appcontainer-job"` and separates:

- `descendantControl`: Job cleanup confirmed, unconfirmed, or not started.
- `isolation.state`: verified, unknown, or not started.
- `isolation.workspace`: retained, unknown, or not created.
- `isolation.profileCleanup`: confirmed, unconfirmed, or not required.
- `input`: imported, not-imported, or unknown. No source path, digest or bytes.

For the import route, `not-imported` means the request stopped before the
native owner attempted setup; `unknown` preserves uncertainty after helper or
cleanup failure. A successful receipt requires `imported`.
If cancellation is observed after copying but before process creation, the
native owner removes only its pinned `input.bin` and leaves the workspace.
An abort racing the final control-pipe check and `ResumeThread` may briefly
start the child before Job cleanup; that outcome has an unknown receipt.
Broader helper failure can leave workspace contents for inspection.

CLI exit zero requires child exit zero, complete output accounting, confirmed
Job cleanup, verified isolation, retained workspace and confirmed profile
cleanup. Helper loss or an incomplete receipt returns a nonzero outcome with
uncertainty preserved. Paths, arguments, credentials and file contents are absent
from that report. The private terminal preview and retained workspace can contain
operator-supplied data.

The boundary assumes the selected child is untrusted; it does not defend against
another process already holding the operator's full account authority. Executable
bytes and policy file paths are not immutable. Directory creation and opening the
new leaf handle are separate Win32 calls, leaving a same-account replacement
window before the leaf is pinned. The selected child has not started at that point.
Reparse ancestors and leaves are refused, and the pinned leaf identity is checked
again before reporting retention.

## Profile recovery and compatibility

Before profile creation, the native owner flushes a marker to a private journal
under the operator's Local AppData AEGIS directory. The owner holds a journal
lock through cleanup. Another simultaneous isolated launch is refused. A later
isolated launch retries cleanup of owned interrupted profile markers before
creating its own profile. Recovery is bounded to sixteen pending markers;
malformed profile markers or unsafe journal paths fail closed. Failed cleanup retains its
marker and cannot produce a successful receipt. No automatic workspace deletion
is performed; retained output needs deliberate operator retention management.

The selected runtime must already be accessible under Windows AppContainer
access checks. AEGIS does not grant installed software broader permissions to
make it run. Native checks cover `whoami.exe`, installed Node, and an explicitly
granted disposable test runtime. A local listener accepted an unrestricted
connection while the restricted probe timed out without connecting; this is a
bounded loopback observation, not an independent public-network denial test.
Compatibility with installed AI agents must be tested individually.
This slice has no authenticated provider network broker, arbitrary file broker,
long-running agent session or desktop launch control. Those remain in the
[protected-launch plan](roadmap/protected-launch.md).
