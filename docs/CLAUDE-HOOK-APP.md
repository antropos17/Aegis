# Application review of a separate Claude hook profile

Action control contains **Separate Claude hook profile**. On Windows with the
prepared native assets and matching installed runtime, the application can
review an existing schema-1 Bash policy, install its hook into an app-owned
settings profile, and separately review removal. After restart or native session
expiry, a fresh review can remove one exactly recognized current AEGIS Bash hook.
The profile is used only by a Claude launch explicitly selecting `--settings`.
Configuration presence does not establish provider observation or blocking.

## Paths and authority

The sole target is `app.getPath('userData')/claude-hook-profile/settings.json`.
Preparing an installation creates an empty private draft when that file does not
exist, plus a new bounded backup directory. The application never searches for
or edits personal Claude settings. Selecting a different policy cannot append
another hook to an old unowned profile. A fresh removal recognizes only the
current fixed AEGIS executable/application route, one Bash command hook with
timeout five, and an unambiguous supported structure. It removes that entry and
its adjacent comma; all unrelated bytes remain exact. Changed routes, additional
fields, mixed commands or duplicate matching entries are refused.

`claude-hook:review` admits only `status`, `install`, `remove` and `open-profile`
from the current owned top-level renderer. The renderer supplies no path,
command, config bytes, review ID, backup reference or confirmation decision.
The selected policy comes from the main-process native file dialog. The fixed
AEGIS `--action-policy-hook` command quotes its fixed absolute paths. Literal
ampersands stay inside those quotes; expansion, quote, control and other
unsupported shell syntax remains refused.

The real owner-review capability shows only the exact target and changed
fragments with line/column positions in a native Cancel-default dialog. Native
confirmation must refer to that prepared transaction and arrive before its
90-second expiry. A fresh observed removal is new human authority over current
bytes. It imports no historical reference, asserts no previous installation
ownership and performs no historical rollback. The existing live owned-removal
path retains its original rollback contract. Cancellation or navigation cannot admit a new write. An
already admitted write retains its actual result during shutdown; it is not
relabelled cancelled. The existing guarded C# IO retains a private backup before
writing and verifies exact postwrite bytes. Fixed public outcome codes and
capability booleans are the only setup data returned over IPC. `canRemove` still
describes live session ownership; `canReviewExisting` offers a fresh review and
does not assert ownership. Status reads only bounded file metadata and creates
no draft, backup directory or native session.

The folder action reveals only this fixed target and still requires the owned
renderer. Missing helper assets do not block access to a retained draft folder.

## Offline asset preparation

Use the already installed Windows .NET SDK 10.0.302 and runtime 10.0.10:

```powershell
node scripts/build-hook-review-assets.cjs
```

The script restores solely from an empty local NuGet source and builds the
existing framework-only native projects. It requires a fresh output directory,
prepares the exact five host files and pinned descriptor, and verifies them
through the existing private asset qualifier. It does not install or download a
runtime. A different existing runtime installation can be selected with
`--runtime-root`; a fresh output can be selected with `--output`.

Development consumes `build/hook-review/assets.json` and `build/hook-review/host`.
The Windows packaging resources copy that directory to `resources/hook-review`.
Both host files and the selected installed .NET files must match their pins;
missing, altered or unsupported assets produce unavailable setup. The manifest
binds the prepared machine's absolute runtime path. Portable runtime discovery,
self-contained distribution and installed-package native review/transaction
qualification remain open.

Native build intermediates stay in `out/development/hook-review-build-<pid>`.
Review closed disposable diagnostics after seven days; preserve verification
receipts and retained private recovery records. No automatic deletion is added.

## Session, recovery and acceptance limits

Native IO admission lasts at most three minutes. Removal ownership and private
backup references live only in that process session. An expired native session
must report confirmed native shutdown before a new explicit operation opens fresh guarded IO. An unconfirmed release blocks another write. Restart and
expiry permit a new targeted review; saved files never restore old approvals.
An uncertain write still blocks further writes in that application session.
The panel cannot import references or recover historical ownership. It never
deletes private backups. A maximum of
four retained session directories prevents unbounded setup storage; reaching it
refuses another setup. Each native store also retains its existing eight-record,
2 MiB bound. Readback uncertainty blocks further writes.

The reproducible disposable-profile qualification uses:

```powershell
node scripts/qualification/claude-hook-app.cjs X:/tmp/new-owned-profile-receipt
```

It exercises real Windows IO with scripted dialog callbacks: installation setup,
service and native-session recreation, fresh cancellation and targeted removal preserving
unrelated bytes, encrypted retained records and confirmed native-session release. It does
not prove a full Electron process restart or that a human accepted a real desktop dialog. A plain Electron launch
with a disposable profile has mounted this panel and opened its native policy
picker. OS input was unavailable (`GetCursorPos`, access denied). A current official
input attempt on the recovery build also failed at navigation with the same
error; its disposable target stayed byte-identical and the owned process was
closed. No alternate input was attempted. The actual native confirmation
journey remains unqualified. Main-process inspector-based
test launchers are intentionally refused by private IO. The installed-Claude
source-run result below covers one version and command shell. Other versions,
bypass behavior, historical backup restoration, the installed-package owner-review journey
and full W6 acceptance remain open. `launchAllowed` remains false.

### Explicit installed-Claude qualification

The same qualification script also has an opt-in `--claude` mode. This runs one
paid provider session and requires explicit authorization for that attempt:

```powershell
node scripts/qualification/claude-hook-app.cjs X:/tmp/fresh-owned-claude --claude X:/tmp/owned-shell-preflight/receipt.json
```

The shell receipt must identify an already tested Git Bash executable, its
unchanged SHA-256, a successful single `--noprofile --norc` fixed `printf` run in
an owned directory and the exact retained output bytes. The script never invokes
bare `bash`, WSL or an installer. It selects this verified executable only in the
child's environment. Managed Claude controls and the configured Opus model remain
in force; the runner refuses a different configured model.

The mode creates and installs a separate fixture profile using actual guarded IO
with scripted confirmation, then closes that native session. Before any provider
call, it feeds two synthetic requests through verified Git Bash using the exact
read-back generated application command and requires the fixed allow/deny decisions. The
policy and provider prompt predeclare two entire Bash input objects, including
command, description and timeout. The policy defaults to deny and permits only
the first exact object. Both commands write fixed markers only in the owned
working directory. Additional or missing input metadata is never adapted into a
new permission.

Only Bash is exposed; normal settings sources are omitted, managed controls still
apply, MCP configuration is empty and strict, permission prompts have no responder,
and the single Opus session has a $0.50 limit and a 150-second deadline. Cleanup
settlement has a five-second guard after termination starts. Unconfirmed cleanup
retains the owned PID and fixed `CHILD_CLEANUP_UNCONFIRMED` failure before the
runner exits unsuccessfully; it never claims the child was released. The runner
does not retry or change the policy. Provider output stays bounded in memory;
private receipts contain input/cwd equality booleans, fixed result flags, byte
counts and cost rather than arguments or raw output. Passing also requires the
exact allowed marker, absence of the denied marker and the explicit AEGIS denial
in the provider's denied tool result. A final model claim is insufficient.

On 2026-10-26, this mode passed once on source revision
`57f614731067b99aced701a361810029a3fadb8e`, with installed Claude Code file product
version `2.1.292.0` and verified Git Bash. The existing configured Opus model was
preserved and observed in the provider result. Reported cost was **$0.047539**.
The exact two whole Bash inputs and working directory matched the predeclared
policy. The allowed tool result succeeded and created the exact marker; the
denied result carried the explicit AEGIS denial and created no denied marker.
Profile and policy hashes stayed unchanged. Claude exited with code zero,
confirmed cleanup and no forced termination. The final documentation update
preserves the qualified runtime and runner sources.

Any future mismatch is retained as an inconclusive allow/deny result and never
widens permission. This bounded source-run result leaves real native-dialog
acceptance, genuine-agent use of the packaged route, other versions, missing hooks, launch
failures, alternate tools and bypass routes open.

### Windows inherited input

Electron 45 [replaces `process.stdin` with an ended stream on Windows](https://github.com/electron/electron/blob/v45.0.0/lib/common/init.ts#L56-L67).
The action-policy hook therefore wraps inherited descriptor zero as a read-only
`net.Socket`, matching [Node 24.22's pipe-input bootstrap](https://github.com/nodejs/node/blob/v24.22.0/lib/internal/bootstrap/switches/is_main_thread.js#L199-L220).
It creates no connection or listening endpoint. The existing 64 KiB input limit,
1.5-second deadline and fixed denial responses remain in force. Ordinary Node,
other operating systems and the other CLI routes keep their existing inputs.

The first filesystem-stream candidate delivered allow/deny correctly but could
not cancel a pending held-open read; it required the outer supervisor to kill the
owned process and failed qualification. The final pipe wrapper passed the four
native cases through the exact generated Git Bash command: allow, deny, malformed
input and held-open deadline with actual process exit. No environment prefix,
console switch or fuse change is needed. This table qualifies native transport;
the separate provider result above covers the installed-Claude source run.
Real-dialog acceptance remains open.

### Private unpacked-ASAR qualification

On 2026-10-26 UTC, a normal private Windows unpacked build from
`7725f734942e36efc1189f187b1f8f3b8d83fb77` passed 16 of 16 scoped checks.
The normal build and asset gates completed. The default executable name,
`AEGIS - AI Monitoring & Threat Detection.exe`, retained its spaces and ampersand;
the executable and archive were unchanged throughout qualification:

| Artifact | SHA-256 |
| --- | --- |
| Default executable | `c3f4b6d964a3b58adb8570a3e150a742829e3e173a704927a936d1d0c892bd7f` |
| `resources/app.asar` | `5e107600f64b448af5576a54b9f903da11a2328231bc49f279760ec4f040b8e5` |

The real application reported `isPackaged: true`, the expected ASAR/EXE paths and
the isolated disposable user-data directory. Automatic updates remained off and
idle. The read-only Guard status reported `READY` and available assets, while
creating no draft or native IO session. This advisory result does not establish
native installation or owner consent. Fresh host data and the actual Coverage
DOM reported project changes **Not observed** with no selected project. The
existing settings action focused Monitoring without selecting a folder.

An archive-matched production command generator wrote a separate producer fixture;
the fixture was read back before verified Git Bash invoked that exact command.
No profile installation or provider was involved. The four inherited-input cases
returned complete fixed provider JSON and closed without forced termination:

| Input | Decision / exit | Observed duration |
| --- | --- | --- |
| Exact allowed request, EOF | allow / 0 | 417 ms |
| Exact denied request, EOF | deny / 0 | 261 ms |
| Complete JSON with invalid request fields, EOF | deny / 0 | 265 ms |
| Valid request with input held open | deny / 2 | 1,729 ms |

The internal input deadline remained 1.5 seconds. Both tool-output markers stayed
absent: these cases evaluated requests without executing their tool commands.
Source, archive, executable, policy and fixture-setting hashes stayed unchanged.
No environment prefix, executable rename, archive patch or fuse change was used.

Windows Playwright owns a command-shell launcher rather than Electron's main PID.
The retained initial attempt refused an invalid PID-equality assumption before
the UI and hook cases. The corrected qualification independently checked exactly
the launcher/main images, parent relation and coherent birth records, retaining
the main process handle. Cleanup confirmed wrapper exit 0 and drained close,
plus disappearance of that held main generation after application quit. The
Electron main exit code was unavailable and is not inferred from the wrapper.
Both attempt receipts remain retained.

A genuine packaged-Claude caller was initially held because of host memory/commit
pressure. After headroom recovered, one Claude CLI `2.1.292` qualification using
the configured Opus model passed with the same packaged command, producer-fixture
settings, policy and working directory. Exactly two Bash requests matched their
full expected inputs and corresponding results. The allowed request wrote exactly
17 bytes, `AEGIS_W6_ALLOWED` followed by LF; the denied request returned an explicit
policy denial and created no denied output file. Reported cost was $0.0470262 and
total elapsed time was 19.951 seconds. The CLI exited 0 with confirmed cleanup and
no forced termination; captured raw buffers were wiped. Source/package `7725f734`
and fixture hashes stayed unchanged. The earlier 16-check ASAR/input qualification
remains a separate provider-free result. Native dialogs, installation, portable
runtime discovery and wider bypass coverage remain open. These fixture-based
results do not establish full Guard acceptance or authorize a Blocking verified
label. The separate
native-read candidate `e456` failed its visibility precondition (expected true,
observed false); its heading stage was not reached. That failure establishes no
renderer, VM boot or cadence diagnosis and no native-read acceptance.
