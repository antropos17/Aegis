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
AEGIS `--action-policy-hook` command refuses shell metacharacters in paths.

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
self-contained distribution and installed-package qualification remain open.

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
test launchers are intentionally refused by private IO. Actual installed Claude
hook loading, its version contract, command-shell compatibility, bypass behavior,
historical backup restoration and full W6 acceptance remain open. `launchAllowed` remains false.

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
call, it feeds two synthetic requests to the actual Electron application
`--action-policy-hook` route and requires the fixed allow/deny decisions. The
policy and provider prompt predeclare two entire Bash input objects, including
command, description and timeout. The policy defaults to deny and permits only
the first exact object. Both commands write fixed markers only in the owned
working directory. Additional or missing input metadata is never adapted into a
new permission.

Only Bash is exposed; normal settings sources are omitted, managed controls still
apply, MCP configuration is empty and strict, permission prompts have no responder,
and the single Opus session has a $0.50 limit and a 150-second deadline. The runner
does not retry or change the policy. Provider output stays bounded in memory;
private receipts contain input/cwd equality booleans, fixed result flags, byte
counts and cost rather than arguments or raw output. Passing also requires the
exact allowed marker, absence of the denied marker and the explicit AEGIS denial
in the provider's denied tool result. A final model claim is insufficient.

This mode remains unqualified until an authorized actual run passes. A mismatch
is retained as an inconclusive allow/deny result; it does not widen permission.
It does not establish real native-dialog acceptance or protection against missing
hooks, launch failures, alternate tools or bypass routes.
