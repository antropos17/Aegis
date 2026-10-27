# Windows 0.21.0-beta candidate qualification preparation

Prepared on 2026-10-27 for release PR #1048. The owner subsequently authorized
committing/pushing the preparation, installing the workflow and running the
candidate qualification. Merge and release publication remain excluded.
Run outcomes are recorded in the task's private receipt and Actions artifacts;
this procedure alone does not establish a passing native result.

## Frozen inputs and existing evidence

Candidate source: `5526376f39d01305f98e707e8e2ea9807f68a33b`, tree
`0a704c1c2843c7d1ebde9c2eae073ec80d301b3a`, version `0.21.0-beta`.
The five required PR checks passed at this revision in
[CI run 40443429925](https://github.com/antropos17/Aegis/actions/runs/40443429925).
Reuse those source checks; this lane adds installer evidence. A changed release
head requires a new input review rather than silently moving these pins.

Baseline: `aegis-v0.20.1-beta`, commit
`274d65711ac858c9d309c73f1f7c9c4e52872ed1`, published installer
`AEGIS.-.AI.Monitoring.Threat.Detection.Setup.0.20.1-beta.exe`,
149653092 bytes, SHA-256
`6234da8b7fb3c090fb1a2302d170ae20d56994bc5c73c00b7a15b6c4fc04e339`.
Download its `manifest.json` and `manifest.json.sig` with the installer and verify
them using `scripts/release-verify.js` and the pinned repository public key.
The public-key PEM file SHA-256 is
`47443c63b174c5884e8cac5fa1bf67141de3baf7b5582fa22f96da919c8d6849`;
this is a file digest, not an independent publisher identity assertion.

Harness/process-policy baseline: master commit
`55881bc391b9b88b8d1751f6453e5c94e13f7cc9` plus the reviewed preparation
diff. Record the eventual harness commit separately from candidate source.
The candidate is built from the untouched pinned release source. Record its
actual filename, byte size, SHA-256, source/tree, producing run and attempt in
`candidate.json` before installation. Those artifact values are unavailable
until the build runs; no candidate binary or signing result is claimed here.

## Execution package

The [candidate workflow](../../.github/workflows/windows-candidate-021.yml) builds an unpublished
x64 installer once, then runs the existing lifecycle driver in two independent
disposable Windows Server x64 jobs. It uses `--publish never`, read-only repository
permissions and no release signing secret. Artifact download is limited to that
run/attempt. `-Pr1048Candidate` rejects other candidate versions, source/tree
identities, scenario modes and baseline pins. Existing historical driver modes
retain their defaults.

Dispatch the registered `windows-installer-lifecycle.yml` on the reviewed
preparation branch with `candidate=pr1048` and `target=server-silent`. This calls
the new reusable workflow from that same branch without merging it to master.
Legacy build/installer jobs skip in this mode. The candidate lane receives only
read access to repository contents and PR metadata, with no inherited secrets.
Record the immutable harness SHA and returned run ID before observing results.

| Scenario | Required independent observations |
| --- | --- |
| Fresh | Clean profile/registry/shortcuts; install candidate; exact installed/app version; real packaged Monitoring window and preload; save test settings; close and relaunch with settings and sentinel intact |
| Upgrade | Install verified 0.20.1 baseline; seed and verify test settings/data across restart; install candidate over the same installation; observe 0.21.0 and unchanged settings/sentinel across restart |
| Removal and reinstall, both jobs | Close owned app/helpers; uninstall; installation directory, registry entry and shortcuts absent; retained settings and sentinel hashes unchanged; reinstall the same candidate; verify retained values after launch/restart; final uninstall with the same checks |

Settings expectations are explicit in `windows-installer-profile.cjs` and do not
come from the installed candidate. Installed payload hashes must match between
initial install and reinstall. This does not independently compare every installed
file to the original installer payload. Preserve profile receipts, actual app
version/architecture, screenshots, payload digests, candidate receipt, OS build,
Node/tool versions, free-space samples and the lifecycle result. A failure or
missing phase is not PASS. Do not automatically retry a failed scenario; preserve
its first evidence and name the changed input before another run.

## Isolation, storage and limits

Run only on clean disposable GitHub-hosted Windows x64 runners. Never set hosted
runner environment flags on a personal machine to bypass the driver's guard.
Existing profiles, registrations and shortcuts cause refusal. The profile data
are synthetic settings plus a sentinel; credentials, real projects, historical
audit/token databases and every possible migration are outside this check.
The first lane is silent current-user installation on Windows Server. It does
not qualify Windows 11 wizard interaction, UAC/all-users setup, automatic update
discovery, Authenticode, ETW, external agents, provider execution or full W10.

Build/setup caches and TEMP/TMP are job-local. Require at least 8 GiB free before
build and 2 GiB during lifecycle sampling; record space before and after jobs.
Use 20-minute job and five-minute dependency deadlines, existing installer/process
deadlines and the driver's 32 MiB evidence limit. The existing per-stream 8 MiB
log check occurs after process exit; it is not live rotation. Disposable job
storage and deadlines limit lifetime, not all possible instantaneous growth.
Upload candidate/evidence with seven-day retention. Preserve verification receipts
needed for the release decision before expiry. Local downloaded baseline assets
are private task evidence; review disposable copies after seven days and delete
only exact validated, closed task paths, preserving receipts and unresolved failures.

## Readiness decision

Preparation validation covers script syntax, workflow structure, source pins,
non-host refusal and baseline signature/hash checks. Run the import-boundary
regression with a new task-local directory:

```powershell
./scripts/qualification/test-windows-candidate-021.ps1 -Scratch X:/task-storage/new-import-check
```

It uses inert fixture bytes and never runs an installer. Nine negative cases cover
wrong version, source/tree, run/attempt, hash/length and signing/publication flags.
Native installer scenarios
remain NOT RUN until the prepared lane executes. Review all scenario receipts
and limits before accepting the candidate. Qualification of this unpublished
artifact does not qualify a different later published installer. Verify the final
published installer and its signed manifest separately after an authorized release.
