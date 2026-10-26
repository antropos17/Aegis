# Application review of a separate Claude hook profile

Action control contains **Separate Claude hook profile**. On Windows with the
prepared native assets and matching installed runtime, the application can
review an existing schema-1 Bash policy, install its hook into an app-owned
settings profile, then separately review removal during the same setup session.
The profile is used only by a Claude launch explicitly selecting `--settings`.
Configuration presence does not establish provider observation or blocking.

## Paths and authority

The sole target is `app.getPath('userData')/claude-hook-profile/settings.json`.
Preparing an installation creates an empty private draft when that file does not
exist, plus a new bounded backup directory. The application never searches for
or edits personal Claude settings. Existing nonempty PreToolUse profiles require
a separate ownership recovery review; selecting a different policy cannot append
another hook to an old unowned profile. Other settings bytes remain preserved.

`claude-hook:review` admits only `status`, `install`, `remove` and `open-profile`
from the current owned top-level renderer. The renderer supplies no path,
command, config bytes, review ID, backup reference or confirmation decision.
The selected policy comes from the main-process native file dialog. The fixed
AEGIS `--action-policy-hook` command refuses shell metacharacters in paths.

The real owner-review capability shows only the exact target and changed
fragments with line/column positions in a native Cancel-default dialog. Native
confirmation must refer to that prepared transaction and arrive before its
90-second expiry. Cancellation or navigation cannot admit a new write. An
already admitted write retains its actual result during shutdown; it is not
relabelled cancelled. The existing guarded C# IO retains a private backup before
writing and verifies exact postwrite bytes. Fixed public outcome codes and
capability booleans are the only setup data returned over IPC.

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
backup references live only in that process session. Restart, expiry or an
uncertain write requires a separate recovery review; this panel cannot import
references or recover ownership. It never deletes private backups. A maximum of
four retained session directories prevents unbounded setup storage; reaching it
refuses another setup. Each native store also retains its existing eight-record,
2 MiB bound. Readback uncertainty blocks further writes.

The reproducible disposable-profile qualification uses:

```powershell
node scripts/qualification/claude-hook-app.cjs X:/tmp/new-owned-profile-receipt
```

It exercises real Windows IO with scripted dialog callbacks: exact cancellation,
installation/readback, the actual Electron decision-hook route, exact rollback
and encrypted retained records. It does
not prove that a human accepted a real desktop dialog. A plain Electron launch
with a disposable profile has mounted this panel and opened its native policy
picker. OS input was unavailable (`GetCursorPos`, access denied), so the actual
native confirmation journey remains unqualified. Main-process inspector-based
test launchers are intentionally refused by private IO. Actual installed Claude
hook loading, its version contract, command-shell compatibility, bypass behavior,
persistent removal and full W6 acceptance remain open. `launchAllowed` remains false.
