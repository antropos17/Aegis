# Channel and fixed-task evidence — 2026-09-28

Scope: **trusted same-principal Windows process/Job, anonymous pipes and a fixed
dummy Node/Git task**. [The contract](guest-channel-fixture.md) identifies the
remaining VM, identity, runtime and hostile-project boundaries.

Final Windows x64 verification passed **330/330 tests, no skips, eighteen files**:
104 new channel/report/oracle/native/CLI cases and 226 preceding bootstrap,
synthetic VM, inactive protocol and filesystem diagnostic cases. The new native
file makes twelve assertions across nine real process scenarios. Linux skips
those twelve assertions; portable schema/state tests cannot replace this run.

Two behavioral red controls were executed before their fixes. First, a valid
signed result was accepted before host release. Second, the local file oracle
accepted `.git` through a junction pointing at a different generated directory.
The corrected tests now refuse both paths. Twelve oracle/cleanup cases check
actual files, dishonest hashes, a project appearing in a no-work mode, parent
junctions, hard links, unexpected entries and exceeded file/size/depth budgets.
Rejected cleanup preserves the entire project and adjacent files.

The standalone CLI separately compiled all eleven pinned C# snapshots and ran
all nine cases on Windows build **26200**, Node **24.11.1**, Git
**2.52.0.windows.1**, Vitest **4.1.11**, inbox compiler **4.8.9221.0**.
The collector checked compiler, compiled image, source snapshots and Node/Git
executable hashes before/after execution. The supervisor pinned its executable
and both tools during each case. Runtime/module closure is not established.

| Mode | Dummy project observed after closure | Accepted result | Exact refusal | Held child exited / Job queried empty |
| --- | --- | --- | --- | --- |
| admit | yes; independent edit/test/diff hashes match | yes; C# frame verified in JS | none | yes / yes |
| cancel | absent | no; stopped accepted | none | yes / yes |
| bad-command | absent | no | channel-authentication | yes / yes |
| cross-epoch-command | absent | no | channel-context | yes / yes |
| wrong-direction-command | absent | no | channel-context | yes / yes |
| replay-command | absent | no | channel-sequence | yes / yes |
| bad-result | yes; independent file oracle only | no | channel-authentication | yes / yes |
| oversized-result | yes; independent file oracle only | no | frame-size | yes / yes |
| timeout | absent | no | frame-timeout | yes / yes |

Every initialized frame was independently authenticated in JS. The successful
result and two stopped frames were authenticated with their exact context,
direction, sequence and phase. The accepted result's known source/test/diff
digests match an independent Node oracle that executes no returned code or Git.
The corrupt-result cases observe local files but never claim an authenticated
task result. A stopped message by itself retains executionClosureConfirmed=false.

All nine cases confirmed the held child's exit and empty native Job accounting.
The command faults require both EOF and the worker's exact expected refusal/exit
code; unrelated startup failure or EOF fails collection. Initial accounting was
two in this run, consistent with the preceding fixture's child/conhost observation.
No complete member enumeration was performed. Native cancellation was tested
before task release; only the JS state contract covers a cancellation during work.

Development initially failed after creating its dummy Git baseline/edit. Explicit
TAP selection and minimal-environment corrections produced a successful run;
the individual cause was not independently isolated. These earlier failures are
retained separately and never counted as a successful injected denial. Two small
unconfirmed development projects remain retained for diagnosis rather than being
deleted on an assumed closure. Successful final projects were removed after the
required native accounting and bounded preinspection.

Seven CLI controls refused missing/relative/existing/wrong-extension receipts,
a VM selector, arbitrary command text and duplicate options. Existing bytes were
preserved and no extra receipt or compiler scratch appeared. Saved receipts omit
keys, raw frames, correlation bindings, executable paths, user SIDs and file data.

Final raw receipts are under `X:/tmp/aegis-enforcement-e0-20260928/receipts`:
`guest-channel-complete-windows.json/.txt`, `guest-channel-complete-cli.json/.txt`,
`guest-channel-complete-proof.json`, `guest-channel-complete-lint.json/.txt` and
`guest-channel-source-format.json/.txt`. The final review package binds their
hashes and full source/diff to the submitted commit and required hosted checks.
Earlier red/development receipts are labeled separately.

Scripts/test fixtures have no production callers and are excluded from the
application packaging list and main typecheck/coverage instrumentation. Production
modules, IPC, dependencies, workflow configuration and existing native Job code
are unchanged. No VM, service, account, registry, ACL, network, WSL or provider
settings were changed. The original dirty checkout is preserved.

The preceding native-bootstrap scoped review passed and PR #696 merged as
`2e325d0591c4011c9c4e25d7bc0522202fb96be1`. This new change awaits its own review.
Full A1 and all E1/E2 task checkmarks remain incomplete. `vmEffectsRun=false`,
`guestNodeGitQualified=false`, `launchAllowed=false` and
`nativeContainmentQualified=false` remain explicit. The
[real VM matrix](windows-vm-qualification.md), authenticated OS callers/protected
inventory, low-privilege guest/runtime closure, real socket peer, crash/reboot,
filesystem/network effects, online credentials and host export remain not-run.
