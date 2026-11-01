# Application review of a separate Claude hook profile

Action control contains **Separate Claude hook profile**. On Windows with the
prepared portable native assets, the application can
review an existing schema-1 Bash policy, install its hooks into an app-owned
settings profile, and separately review removal. After restart or native session
expiry, a fresh review can remove an exactly recognized current AEGIS Bash hook
group or the earlier pre-only hook.
An earlier unredirected three-hook profile remains removable and can still use
the pre-hook launch, but after-hook configuration is shown as unverified; remove
and reinstall it to review the redirected route.
The profile is used only by a Claude launch explicitly selecting `--settings`.
Configuration presence does not establish provider observation or blocking.

New Windows installations generate all three hook commands with one canonical
`--user-data-dir` argument pointing to a fresh `native-<server-token>` directory
inside the separate profile. The existing native confirmation shows that exact
path and explains Electron's native state/cache writes and retention. Preview
does not create this directory. Confirmed installation reserves it exclusively;
an existing directory or link is refused. Created native data remains after
failed installation and hook removal, and reinstall selects a new path. Native
identity checks detect observed replacement; they do not provide filesystem
isolation or eliminate changes after verification. Exact older commands remain
recognized for removal and admission. The dated package receipts below qualify
only their exact recorded candidate bytes.

## Paths and authority

The sole target is `app.getPath('userData')/claude-hook-profile/settings.json`.
Preparing an installation creates an empty private draft when that file does not
exist, plus a new bounded backup directory. The application never searches for
or edits personal Claude settings. Selecting a different policy cannot append
another hook to an old unowned profile. A fresh removal recognizes only the
current fixed AEGIS executable/application route, the supported Bash command hooks
with timeout five, and an unambiguous supported structure. It removes the recognized
entries; all unrelated bytes remain exact. Changed routes, additional
fields, mixed commands or duplicate matching entries are refused.

`claude-hook:review` admits only `status`, `install`, `install-project-policy`,
`remove`, `open-profile`, `guard-start`, `guard-start-snapshot` and `guard-stop`
from the current owned top-level renderer. The renderer supplies no path,
command, config bytes, review ID, backup reference or confirmation decision.
The selected policy comes from the main-process native file dialog. The fixed
AEGIS pre- and after-hook commands quote their fixed absolute paths. The
after-hook command ends with the exact Git Bash redirection `> /dev/null` to
discard its stdout. A redirection or hook failure can leave delivery unknown.
When Git Bash starts the hook, stderr and its exit status are preserved. The
pre-hook retains stdout for the provider decision. Literal
ampersands stay inside quoted paths; expansion, quote, control and arbitrary
shell syntax remain refused. The redirected route requires Git Bash; behavior
with other command shells has not been qualified.

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
capability booleans are the only setup data returned over IPC. Optional terminal
session status also returns a bounded in-memory list of fixed decision categories and,
when an exact correlated callback is received, a claimed provider result. Sender
identity, delivery coverage and action effects remain unknown. `canRemove` still
describes live session ownership; `canReviewExisting` offers a fresh review and
does not assert ownership. Status reads only bounded file metadata and creates
no draft, backup directory or native session.

The optional snapshot-checked terminal launch asks for an existing accepted
project inventory snapshot after selecting the working folder. For snapshots
that include an offline tool catalog it also asks for that same catalog. The
main process freshly compares the selected project and verifies the snapshot
again after the owner's native review, at terminal confirmation and immediately
before broker start. A changed, incomplete, incompatible, unaccepted or
unavailable snapshot refuses this route. Use Local security to review and
explicitly accept a complete snapshot first. The ordinary terminal launch is
still available and does not check a snapshot.

This check covers only the recognized inventory layouts, and a local accepted
snapshot is not authenticated. It does not establish effective Claude settings,
complete project contents, provider blocking, or that the project cannot change
between the check and use. A timed-out filesystem capture may continue in the
background; the launcher refuses new checks until it has actually finished.

The folder action reveals only this fixed target and still requires the owned
renderer. Missing helper assets do not block access to a retained draft folder.

The new profile reviews `PreToolUse`, `PostToolUse`, and `PostToolUseFailure`
as one transaction. An earlier pre-only profile remains usable and removable;
remove and reinstall it to review the new hooks. The observer correlates bounded
callbacks to the exact attempt using a private per-session keyed fingerprint; it
retains neither provider identifiers nor raw command, input, response, or error.
When the loss signal or an invalid report reaches the receiver, malformed,
oversized, duplicate, unmatched or out-of-order callbacks mark loss and do not
establish a result; loss of the signal itself can go undetected. A holder of the session capability can send a claim,
so neither the sender nor filesystem/process effects are independently verified.
Missing callbacks leave the result unknown, including when permission is denied
or a provider session is cancelled. The event names and reported completion or
failure semantics follow the [Claude Code hook reference](https://code.claude.com/docs/en/hooks#posttooluse).
These after-hook changes have not been exercised in a Claude client version; the
historical provider qualification below covers its stated version and pre-hook only.
Electron 45.0.0's Windows browser-process startup writes a newline before app
code ([upstream source](https://github.com/electron/electron/blob/v45.0.0/shell/app/electron_main_delegate.cc)).
The fixed post-hook redirection keeps that bootstrap output out of the supported
Git Bash hook route; it does not establish how a Claude client interprets output.

## Portable asset preparation

Ordinary x64 Windows packaging runs `scripts/build-hook-review-assets.cjs` before
assembling the application. It builds the five host files and copies the selected
framework runtime into the package, with a descriptor containing hashes for the
host, runtime, hostfxr and executable. The build requires an existing .NET 10 SDK
version 10.0.302 or later and the supported Windows x64 runtime 10.0.14 or 10.0.10;
the newest available supported runtime is selected. It restores framework-only
projects from an empty local NuGet source and does not download a runtime. Missing
or invalid assets stop packaging.

Development can prepare a fresh `build/hook-review` with:

```powershell
node scripts/build-hook-review-assets.cjs
```

The script selects an explicit `--runtime-root`, then `DOTNET_INSTALL_DIR`, then
`DOTNET_ROOT`, and finally the standard Program Files installation. It never
searches `PATH` and refuses an invalid selected root rather than falling back.
`--output` selects another fresh directory. Packaging uses `--replace` to rebuild the
fixed output; it removes only a previously qualified, structurally exact generated
asset directory. Unexpected or altered contents stop replacement for inspection.
An interrupted copy has no descriptor and cannot be loaded. If a later build
reports an incomplete output, retain the failed staging and inspect the exact
`build/hook-review` directory. Remove only confirmed disposable, closed build
files after verifying that the directory contains no reparse points; preserve
verification receipts and any unexpected or user-owned files. Then retry.

The application derives the runtime path from its own `resources/hook-review`
directory rather than from a build-machine path. It checks the exact bounded file
set and hashes, rejects linked paths, disables framework roll-forward and starts
the copied executable with a restricted environment. These checks assume trusted,
stable installation files: the descriptor and assets share a trust boundary and
are not an independent signature. Relocation or a passing asset check does not
establish a native owner-dialog journey or full Guard acceptance.
Windows packaging excludes the copied `dotnet.exe` and the supported runtimes'
`createdump.exe` files from electron-builder's extra-file signing so their pinned
bytes remain intact. The application and other helpers keep their signing path.
The build refuses an unexpected runtime executable until its handling is reviewed.

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
node scripts/qualification/claude-hook-app.cjs X:/AEGIS-evidence/example/new-owned-profile-receipt
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
journey was unqualified in that record. The later local unpacked-package journey
is recorded below. Main-process inspector-based
test launchers are intentionally refused by private IO. The installed-Claude
source-run result below covers one version and command shell. Other versions,
bypass behavior, historical backup restoration, the installed-package owner-review journey
and full W6 acceptance remain open. `launchAllowed` remains false.

### Real owner-dialog journey procedure

This procedure requires explicit GUI/provider authorization and does not grant
another attempt. The unchanged
`fb16bc01389ba203b0f99c632f9719bc7dadaf0d` unpacked candidate can be reused for a
packaged owner-dialog journey without installing it. Its clean installed receipt
below came from a completed disposable hosted job; that desktop is not a retained
target. A real installed owner-dialog journey needs a separately identified
installed interactive target. Do not repeat the consumed installer attempt.

The prepared local option uses the existing Windows 11 Home build 26200 x64
desktop and the owner's physical input, with zero installers or VMs. The owner
receives step-by-step guidance; they do not need to choose infrastructure. Before
starting, agree the human operator, unchanged candidate executable and fresh owned
suite. The earlier `GetCursorPos` failure remains unresolved; interactive-session
metadata is not proof of automated input. Do not probe or substitute another
automated input route.
Before launching, require the recorded executable SHA-256
`8c67ceb62732b6f4d77acb878ebb11a743d3ed3804ce66976933fce38aed7e0b`
and ASAR SHA-256 `636f9d2a55959d2ae49cddcbeeae0f7348c47209dec47c7bedee74a42fa6de4b`.

Use the agreed suite layout: `gui-app-data/claude-hook-profile/settings.json`,
`policy.json`, `workspace/` and a fresh `provider-receipt/`. The workspace is the
policy's exact working directory; the provider receipt directory is not a project
directory. Before launch, create only the fresh suite-owned GUI storage/home/temp
directories, including `gui-home/AppData/Roaming`, `gui-home/AppData/Local` and
`gui-home/Desktop`. Align the child's `APPDATA` and `LOCALAPPDATA` with those nested
paths. Creating sibling directories alone did not satisfy Electron's Windows
known-folder lookup in the local attempt recorded below. Seed
`gui-app-data/settings.json` with
`notificationsEnabled: false`, `automaticUpdatesEnabled: false` and
`autoStartWithWindows: false`. Do not overwrite an existing profile or copy secrets.
From the checkout containing the existing-profile qualification mode, prepare
the schema-1 policy using its inert exported request builder. Its only allow rule
is `{ tool: 'Bash', input: qualificationRequests(true)[0], decision: 'allow' }`;
use `defaultDecision: 'deny'` and the canonical `workspace` path as `cwd`. No
declared command is executed by constructing this JSON. The allowed request
appends one fixed `AEGIS_W6_ALLOWED` line to `aegis-w6-allowed.txt`; the separately
declared denied request targets `aegis-w6-denied.txt`. Both markers must initially
be absent. Preserve the resulting policy bytes/hash through setup and collection.

The packaged GUI uses one canonical native argument, without an ASAR spacer or
the separate `--aegis-owned-gui-profile` selector. Electron 45
[applies this native override before application startup](https://github.com/electron/electron/blob/v45.0.0/shell/app/electron_main_delegate.cc#L230-L239).
In PowerShell 7, prepare the child environment independently of the
parent/Codex/provider:

```powershell
$ownedApplicationData = [IO.Path]::GetFullPath((Join-Path $suite 'gui-app-data'))
$ownedHome = [IO.Path]::GetFullPath((Join-Path $suite 'gui-home'))
$ownedRoaming = Join-Path $ownedHome 'AppData/Roaming'
$ownedLocal = Join-Path $ownedHome 'AppData/Local'
foreach ($directory in @($ownedRoaming, $ownedLocal, (Join-Path $ownedHome 'Desktop'))) {
  [IO.Directory]::CreateDirectory($directory) | Out-Null
}
$launch = [Diagnostics.ProcessStartInfo]::new()
$launch.FileName = $candidate
$launch.UseShellExecute = $false
$launch.RedirectStandardOutput = $true
$launch.RedirectStandardError = $true
$launch.WorkingDirectory = Join-Path $suite 'workspace'
$launch.ArgumentList.Add("--user-data-dir=$ownedApplicationData")
$launch.Environment.Clear()
foreach ($name in @('SystemRoot', 'windir', 'COMSPEC', 'PATHEXT', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramData')) {
  $value = [Environment]::GetEnvironmentVariable($name)
  if ($value) { $launch.Environment[$name] = $value }
}
$launch.Environment['PATH'] = Join-Path $launch.Environment['SystemRoot'] 'System32'
$launch.Environment['USERPROFILE'] = $ownedHome
$launch.Environment['HOME'] = $launch.Environment['USERPROFILE']
$launch.Environment['APPDATA'] = $ownedRoaming
$launch.Environment['LOCALAPPDATA'] = $ownedLocal
$launch.Environment['TEMP'] = Join-Path $suite 'gui-temp'
$launch.Environment['TMP'] = $launch.Environment['TEMP']
$launch.Environment['DOTNET_CLI_HOME'] = Join-Path $suite 'gui-dotnet-home'
$launch.Environment['DOTNET_GENERATE_ASPNET_CERTIFICATE'] = 'false'
$launch.Environment['DOTNET_SKIP_FIRST_TIME_EXPERIENCE'] = '1'
$launch.Environment['DOTNET_CLI_TELEMETRY_OPTOUT'] = '1'
# Pass this configuration to a persistent supervisor that drains both pipes.
```

This example prepares the child configuration; it does not start the application.
Before an automated launch, provide a supervisor that remains alive until GUI
exit and continuously drains both redirected streams, with retained output
bounded to 2 MiB per stream. Continue draining after the retention cap or a log
write failure, and record truncation/write failure. Inheriting a short-lived tool
pipe caused repeated `EPIPE` startup dialogs in the first local attempt. Simply
redirecting streams without draining them can also block the child. Preserve
normal quit and confirm owned-process exit; the sample is not a standalone
launch command.

Prepare the GUI directories and seed settings once, before the first authorized
launch, using fresh ordinary suite-owned paths. The second launch reuses the same
paths and child environment without reseeding settings. The Claude transcript
adapter, home file watchers and IDE detector use `os.homedir()`, which
[honors the child's `USERPROFILE` on Windows](https://nodejs.org/api/os.html#oshomedir).
Application settings/logs/history use the selected user-data root. This is not an
OS account or filesystem sandbox: desktop/process observations, Windows known
folders and native dialog history are outside that storage boundary. Startup
sets the process's application identity and registers a shortcut until quit;
no application autostart/protocol setter is invoked. The seeded settings prevent
automatic updates and app notifications. Do not use an inspector, Playwright
launcher or scripted dialog callback; private IO refuses inspector launches.
The separate provider child retains its normal authenticated environment. The
bounded test explicitly requests Haiku without changing the personal configured
model or settings. Never copy its credentials into the GUI environment.

The bounded journey has two ordinary application launches, two policy-file
selections, four native reviews and two committed hook changes:

1. On the first launch, open **Action control → Separate Claude hook profile**.
   Choose **Choose policy and review install**, selecting the agreed immutable
   policy. In **Review Claude hook profile**, retain the exact target/fragments,
   reviewed hook-target baseline and proposed native directory. This target is
   `gui-app-data/claude-hook-profile/settings.json`, distinct from the GUI startup
   seed `gui-app-data/settings.json`. Capture its baseline after preparation has
   created the empty `{}\n` draft. The human chooses **Cancel**. Verify that this
   hook target's bytes are unchanged and the proposed native directory is absent.
   Preparation can already have created the draft and backup directories;
   cancellation does not promise an empty filesystem.
2. Start a fresh install review and select the same policy. Compare its current
   target, three Bash hook changes and fresh native directory. The human chooses
   **Install profile** before the 90-second review expires. Require **Separate
   profile configured. Blocking is not verified.** and exact readback of the
   displayed planned bytes: one
   `PreToolUse`, `PostToolUse` and `PostToolUseFailure` hook, timeout five, the
   selected policy, one identical native-directory argument in each command,
   and the supported after-hook stdout redirection.
3. Quit AEGIS normally and confirm application/native-helper exit before any
   next launch. If separately authorized, the existing-profile provider
   qualification belongs here with the application closed. Its authority and
   effect receipt remain separate from the human's setup confirmation.
4. Relaunch with the same owned directory. Choose **Review AEGIS hook removal**;
   the restarted process requires a fresh review of current bytes. The human
   chooses **Cancel** and verifies the reviewed hook-target digest is unchanged.
   Start one fresh removal review, compare the exact current removal fragments,
   and let the human choose **Remove hook**. Require **The recognized AEGIS hook
   was removed after a fresh review. Unrelated settings were preserved.**, exact
   planned readback, preserved unrelated bytes and no recognized AEGIS hooks.
   Fresh removal does not promise historical rollback to the initial draft.
5. Quit and confirm exit. Retain policy, private backups and the native directory;
   hook removal does not delete them. Preserve the four review/result records
   and file-integrity evidence within the owned workspace.

Stop on unavailable input, expired review, integrity mismatch, uncertain write,
unconfirmed cleanup or an unexpected dialog. Preserve the first result; do not
retry, repair permissions, change policy or substitute another launcher. A human
must actually review and operate the confirmation buttons to establish human
consent. Chat approval or an automated callback cannot supply that observation.
This journey alone establishes no provider/tool effect, reliable scanning or
`Blocking verified` status.

During step 3, separately authorized provider qualification uses the implemented
existing-profile mode from the checkout root:

```powershell
node scripts/qualification/claude-hook-app.cjs `
  (Join-Path $suite 'provider-receipt') --claude-existing-profile `
  (Join-Path $suite 'shell-preflight/receipt.json') `
  (Join-Path $suite 'gui-app-data/claude-hook-profile/settings.json') `
  (Join-Path $suite 'policy.json') $candidate
```

All arguments must be absolute canonical paths. This mode reads the GUI-created
profile and policy; it does not install, confirm or remove a profile and does not
infer human consent from file presence. The app must already have exited. The
paid child's working directory is `workspace`; its receipt directory stays
separate. The mode requires exactly the current candidate's three canonical Bash
hook commands with timeout five and their shared native-profile argument.

For a newly authorized run, permission must include one fixed Git Bash
`printf 'AEGIS_W6_SHELL_OK\n'` preflight,
using `--noprofile --norc`, a fresh `shell-preflight` directory, a five-second
deadline and the existing `boundedHeldChild` cleanup boundary. Clear shell startup
overrides such as `BASH_ENV`, `ENV` and `NODE_OPTIONS` only from that child's
environment. Require exit zero, confirmed unforced cleanup, zero stderr and the
exact 18 stdout bytes. Retain those bytes as `shell-preflight.txt` and an exclusive
`receipt.json` with schema `aegis-w6-shell-preflight/1`, `attempts: 1`,
`exitCode: 0`, `exitConfirmed: true`, exact `actualBytesHex`, canonical `cwd` and
`shellPath`, and matching `shellSha256`/`outputSha256`. The collector rechecks the
retained bytes and hashes; do not relabel another receipt's different challenge.

The bounded count is one shell preflight, two JSON-only packaged hook
preflights and one Haiku invocation with two predeclared Bash marker attempts.
The JSON probes execute no declared commands. The paid invocation has a
150-second deadline, five-second cleanup settlement, three agentic turns and a client-estimated
USD 0.50 budget. This is not a hard billing cap. Haiku is requested and observed
init/final model data is checked; detecting a mismatch does not prove that no
effect occurred beforehand. Require exactly one allowed marker line and no denied
marker; counts detect duplicate effects, they do not prevent them. On a failed
prerequisite, mismatch or unknown result, retain evidence and stop without paid
fallback, policy widening or retry. This procedure alone supplies no provider or
human-consent receipt. The consumed local attempt below is a separate record.

### Local owner journey and failed Haiku baseline, 2026-11-01 (Asia/Baku)

The unchanged unpacked Windows x64 candidate
`fb16bc01389ba203b0f99c632f9719bc7dadaf0d` was exercised on the owner's Windows 11
Home build 26200 desktop with guided physical input. Its executable and ASAR
matched the pins above. No installer or VM was run for this journey. Four GUI
launch attempts were consumed: two preparation failures, followed by two ordinary
GUI lifetimes after separately authorized corrections. The first failure was
`EPIPE` from an inherited short-lived console pipe; the second was
`Failed to get 'appData' path` with the incomplete owned-home layout. Persistent
bounded stream draining and the nested Roaming/Local/Desktop directories corrected
those launch inputs. Both later lifetimes ended through normal quit with exit
code zero and zero remaining owned processes.

The native setup Cancel result left the prepared `{}\n` hook target unchanged
and the proposed native directory absent. A fresh native install review and the
owner's confirmation produced exactly the retained displayed insertion bytes:
one Bash hook for each of `PreToolUse`, `PostToolUse` and `PostToolUseFailure`,
with the selected immutable policy and shared native-directory argument. After
restart, AEGIS recognized that profile. The removal cancellation result was
observed in the UI and the target stayed byte-identical; the exact physical
Cancel button press was not independently captured. The first removal
confirmation returned the expired-approval status and changed no bytes. A fresh
review and the owner's reported **Remove hook** confirmation produced the success
UI and bytes matching the retained displayed removal spans. The fresh dialog's
full text was not independently retained. All three hook arrays were empty afterward; unrelated
bytes, private backups and the native directory were preserved. Personal Claude
settings were unchanged.

Between the two successful GUI lifetimes, one retained fixed 18-byte shell
preflight and two JSON-only packaged-hook preflights passed. The JSON probes
executed no declared tool commands. The existing-profile controller at
`6ad179d72ce388dc64aa6cea6cc4526b463c57ec` (merged by
[#1202](https://github.com/antropos17/Aegis/pull/1202)) then made its sole authorized
Claude CLI `2.1.312.0` invocation with Haiku requested, a 150-second deadline,
three-turn limit and client-estimated USD 0.50 budget. Init reported
`claude-haiku-5-5`; the personal configured Sonnet model and full settings digest
remained unchanged. The CLI exited 1 with confirmed unforced cleanup, zero
observed `tool_use` attempts and both marker files absent. The reported cost was
zero; this is not a billing guarantee.

This provider baseline failed. The underlying cause remains unknown: the
collector did not retain provider error fields or raw stdout, and no matching
debug log was present for that attempt. A later diagnostic collector change does
not recover those discarded details or change this failed receipt. No paid retry
was made. Absent marker files and no observed tool attempts do not establish a
successful deny, an allowed effect or provider fail-closed behavior.

The retained private receipts have these SHA-256 digests; their contents and
screenshots are not published because they contain host-specific details:

| Receipt | SHA-256 |
| --- | --- |
| Setup insertion readback | `ad1e38ba5309ccc3d3ff3175b1f640d919c0483b0b99e0b0c94f5a2e1f52f552` |
| Final removal | `7101e857956b2e5b63d1b5b27d3fbb76a6596f47ca2ad9a0396601d91edd8e68` |
| Failed provider baseline | `6965123a47da957aa60caecdbacf2c2b5420b84887f630a9f95e40361ae48b8c` |
| Successful GUI lifetime 1 | `ba89a71eb0cde3e1b2c0bda4019c039832046499dc3d8b970351aa76f516917f` |
| Successful GUI lifetime 2 | `7298814c8dcbf1814a63fd30e952cb625207eee96be054a112c79f5fc8c45059` |

This adds local unpacked-package native setup/removal evidence only. Installed
owner-dialog acceptance, reliable sensors, provider allow/deny effects, retry
behavior, full G1 and `Blocking verified` remain open. `launchAllowed` remains
false. Repeating any GUI or paid-provider attempt requires fresh authorization.

### Second local owner journey, 2026-11-01 (Asia/Baku)

A separately authorized second journey reused the unchanged unpacked `fb16bc01`
candidate and Claude CLI `2.1.312.0`. Both ordinary GUI launches ended through
normal quit with exit code zero; zero candidate processes remained. The initial
install review returned the expired-approval status and left the `{}\n` draft
unchanged. A fresh review and the owner's reported install confirmation produced
bytes matching the captured native insertion, SHA-256
`83725a251d90a3ef0113eac283c23a2e5fb0c17e2dcd105e5b681dda0d080dd9`.

With AEGIS closed, the matching retained shell receipt was reused and two JSON-only
packaged-hook preflights passed. One paid invocation used the frozen controller
`5f91373d39e9108721298f4e3fe011cae1333d0e`, SHA-256
`b6858e0b3edcf5599d0722e4894a804135e92346d6cfb4c0caa739684655d913`, with the same
150-second deadline, three-turn limit and estimated USD 0.50 budget. Init reported
`claude-haiku-5-5`. The CLI exited 1 with confirmed unforced cleanup, no observed
tool attempts and both marker files absent. Its retained summary had
`resultCount: 1`, `resultSubtype: success`, `providerReportedError: true`,
`errorCount: 0` and `resultMetadataValid: false`. This invalid metadata leaves the
provider result inconclusive; the underlying cause remains unknown. Reported cost
zero does not establish the billed cost. No automatic retry was made, and the
earlier failed receipt remains unchanged.

The second GUI recognized the installed separate profile after restart. The
owner reported confirming **Remove hook** promptly; the full native removal
dialog was not captured. Application success and exact readback independently
showed three empty hook arrays, with the same final profile digest as the first
journey. Two DPAPI-protected backup records were retained and hashed without
decryption; backup restoration was not qualified. The native directory was
retained, and the full personal Claude settings digest stayed unchanged, including
the configured Sonnet model. Provider collection does not establish human
consent; the separate GUI
observations above have their own limits.

| Retained private receipt | SHA-256 |
| --- | --- |
| Second failed provider baseline | `df136a30dc726e78b14a7e5799c9f36d484c7ad6b7c5777c6aeab244bfa2fc3e` |
| Second removal readback | `00f963cdcd955bdf8a446b6b4e6d71e17e6378b986a00b5588a8b4e9250f9d48` |
| Second journey's final GUI lifetime | `24fd44d15e6d5bccab03818925512df295522e52c0baf9e5d97e4e29cc92108a` |

No installer or VM ran in this journey. Installed owner-dialog acceptance,
reliable sensors, provider allow/deny effects, retry behavior, full G1 and
`Blocking verified` remain unqualified. Further live attempts require fresh
authorization.

### Explicit installed-Claude qualification

The same qualification script also has an opt-in `--claude` mode. This runs one
paid provider session and requires explicit authorization for that attempt:

```powershell
node scripts/qualification/claude-hook-app.cjs X:/AEGIS-evidence/example/fresh-owned-claude --claude X:/AEGIS-evidence/example/owned-shell-preflight/receipt.json
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

On 2026-10-27, a provider-free Windows x64 unpacked build from source
`ceb28b7f0857002017df540a9d1c8f687a51e082` exercised the generated PowerShell
terminal broker command. The executable SHA-256 was
`28057cb48a52e5509c5dcf9c0e15ce675a90220804a5e5ee334eee2137f05cbf`; the
`app.asar` SHA-256 was
`5499ad85497aa002e7e706c21554c8aac7ca39a2e60f63c8cc8c79088b97d7a4`.
An owned terminal fixture used a fake HMAC receiver with scripted admission and
an inert native console child. It observed claim, start and finish, console
handles for the child and an unforced broker exit of zero. The PTY operator
observed no synthetic-key echo; the automated receipt did not inspect the
terminal transcript. The shell, child and independently witnessed broker
generation settled. This result does
not qualify a real owner dialog, Claude provider session, clean-machine
installation or actual action effects.

On 2026-10-27, a provider-free Windows x64 unpacked candidate built from source
`9e907be27bf41bdf68148576c2bab514bb8569cb` exercised the packaged executable
and its portable hook-review resources. The executable SHA-256 was
`be255f4cdd6a9797faac56e72b1253f22714fbe257c1e0c9d8b4cf0a71a036c8`; the
`app.asar` SHA-256 was
`27326ffc14718e3c4ec4a421eddddfc5f1d3dc0e19e489e0c9e434b4cc1a4d77`.
The archive-matched source service installed and removed a disposable profile
using the packaged native resources and scripted confirmation, including a
lowercase drive-letter path. The generated command delivered the expected
allow, deny, malformed-request and held-open-input results through the actual
packaged executable. The native session and owned children closed; no tool
command was executed. This is not a clean-machine installation, a real owner
dialog, or a provider acceptance result. The earlier ASAR path lookup failure
and the first packaging rename failure were retained separately.

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

### Current generated native-profile candidate, 2026-10-28

One ordinary Windows x64 NSIS package was built from source
`b35f39764c56b74a0799737561b69003e5e29e91`, without publication. Its identities are:

| Artifact | Bytes | SHA-256 |
| --- | --- | --- |
| Installer | 188,066,691 | `51dd99793ebdd3f36ce3d52f654f8d4d99d5bd9230d44734f6889d5c2670ff48` |
| `resources/app.asar` | 28,581,878 | `b7b6157dec7e402b0a3cda16832563b29eb1909c5ffb88c6987a83092822e4cd` |
| `resources/hook-review/assets.json` | 27,766 | `40e1c92fb6a6529a8bef12b7791759588dd5820c15e41c28e39b196b10678b48` |

One provider-free ten-case matrix passed. It executed the newly generated
native-profile hook commands unchanged, alongside Node and direct controls:
allow, deny, invalid request, held-open input, and correlated `PostToolUse` and
`PostToolUseFailure` observations. The archive-matched source service used the
packaged portable assets for real Windows IO with scripted setup/removal
confirmation. Native admission closed with confirmed exit and stream cleanup;
no case required forced termination. Candidate, policy and asset hashes stayed
unchanged, and both tool-output markers remained absent.

Separately, one offline installer extraction confirmed that all 199 selected
files (the executable, ASAR and complete hook-review subtree) matched the unpacked
candidate by relative file set, byte length and hash. The installer stayed
unchanged; neither it nor the extracted application was executed by that check.
The standalone `-G1ACandidate` installer runner bound these pins at this checkpoint;
the current binding advances to the candidate below. Installation of this earlier
candidate was not run. This evidence does not establish actual owner dialogs,
provider action effects, clean-installed acceptance or full G1 acceptance; `launchAllowed`
remains false.

### Candidate after device-policy and Guard closure updates, 2026-10-28

One new ordinary Windows x64 NSIS build packages source
`fb16bc01389ba203b0f99c632f9719bc7dadaf0d`, including the merged reserved-device
policy and Guard reporting-loss/closure changes. No second build was attempted.

| Artifact | Bytes | SHA-256 |
| --- | --- | --- |
| Installer | 188,066,953 | `5a3b05554273f6f6ba2eb4621c6f1b44e0134e2dee4bb823029f1f5c9f494952` |
| `resources/app.asar` | 28,583,525 | `636f9d2a55959d2ae49cddcbeeae0f7348c47209dec47c7bedee74a42fa6de4b` |
| `resources/hook-review/assets.json` | 27,766 | `e5d68c0d75115c00914aff50c7d2c00fe0bbf570a7958734eeadba87db9d7b59` |

One provider-free ten-case generated-command matrix passed with unchanged command
strings, real packaged portable IO, scripted profile setup/removal confirmation,
confirmed cleanup and no forced termination. Three separate schema-2 JSON-only
hook API probes returned `ask` for an ordinary `README.md` read, `deny` with the
unsupported-input reason for `NUL.txt`, and `deny` with the sensitive-filename
reason for `credentials.json`. These probes executed no declared commands.
Source, package, assets and policy inputs remained unchanged.

One separate offline extraction again matched all 199 selected installer files
to the unpacked candidate by relative file set, bytes and hash; the installer
remained unchanged and was not executed. The standalone G1 candidate selector
now binds the identities above. Build output reported Electron download progress
despite cache reuse, so this record does not establish an offline build.
The subsequent clean installation receipt below adds its recorded scope. The
local unpacked owner journey above adds its separately recorded scope. Installed
owner dialogs, provider action effects, packaged interactive broker cleanup scenarios
and full G1 acceptance remain unqualified; `launchAllowed` remains false.

### Clean Windows installation, 2026-10-28 UTC

[Hosted run 40764302602](https://github.com/antropos17/Aegis/actions/runs/40764302602),
attempt 1, passed on Windows Server 2025 Datacenter build 26100 with native x64 OS
and driver. Qualification source was `a65c7f5b5f781f374aac978c530cba5ac5510732`;
the unchanged application candidate was
`fb16bc01389ba203b0f99c632f9719bc7dadaf0d`. Its 188,066,953-byte installer had
SHA-256 `5a3b05554273f6f6ba2eb4621c6f1b44e0134e2dee4bb823029f1f5c9f494952`.

The receipt's five phases were `preflight`, `before-install-0.21.0-beta`,
`installed-0.21.0-beta`, `first-uninstall` and `complete`: one silent current-user
installation, one `fresh` installed-profile check and one uninstall. The packaged
application launched, saved synthetic settings and relaunched with those settings
and the sentinel retained; no renderer errors were recorded. Installed executable,
ASAR and process-snapshot helper hashes matched the retained candidate. Portable
asset validation matched the descriptor in the preceding table and runtime
`10.0.10`. Uninstall removed the application, install directory, registration and
shortcuts, retained settings and the sentinel, and left zero installed processes.

The captured Monitoring screen showed `Starting AEGIS`,
`Observation unavailable / stale` and `No reliable scan yet`. This receipt does
not establish sensor health or reliable scanning. Actual Guard owner consent,
installed hook IO, provider/tool effects, `Blocking verified`, reinstall, upgrade,
Windows 11 and signing remain unqualified. This was the single authorized installer
attempt; no retry or reinstall was performed, and full G1 acceptance remains open.
