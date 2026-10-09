# Cloud stdio retained-member exit observation

This local change addresses a reproduced exit-observation race in the qualification-only stdio phase. It preserves independent retained-process exit confirmation and refuses failed waits. At worker verification, no new cloud run had been executed. Production, standard-user, E2, E3 and launch qualification remain false.

## Sources and original cloud failure

The implementation checkout is `codex/cloud-stdio-retained-exit-20261009`, based on `888d946e0dc880071dc04c08380aaf31e4eb416d`. The source and original worker receipts were frozen separately for independent review. The following sections record original worker verification; the final hosted follow-up records later coordinator evidence.

Cloud run `37869177286`, attempt 1, job `113623015652`, tested source `ccbdee3abfe54bf6f65ed88ee89a9e83b1afe7f6` on `codex/cloud-stdio-cancel-readiness-20261008`. Its retained [raw receipt](evidence/20261007/37869177286.json) is 254851 bytes, SHA256 `e7838b359dde3fc6de279d6881b7043706062246f6755935a928d9d61df0fef4`. The original receipt remains failed: `cloud-stdio-controls-refused`, stage `fixed-cloud-stdio`. Cases 1–4 passed their existing predicates; case 5 reported `Cancelled`, exit 137, root exit and Job closure confirmed, but `stdioRetainedMembersExitObserved=false`. Readiness and held-payload identity predicates passed.

The receipt's ready-member count 6 and observed-member count 4 have different snapshot times. `Execute` writes the observed count after `Discover`; the readiness callback and post-cancellation census subsequently append retained members. The difference does not establish that only four handles existed. The original receipt did not identify which member failed its instant wait or distinguish timeout from wait failure.

The original VM was observed off and removed, with settlement `settled-and-exact-vm-absent` and no cleanup failure. Task, stdio, cancellation and removal canaries passed. The owner phase was unobserved. These original facts are unchanged.

## Native diagnosis before implementation

The external diagnosis packet at `X:/tmp/aegis-cloud-stdio-retained-exit-evidence-20261009/diagnosis` compiled the original phase and the existing same-principal native readiness fixture with its pre-observation member waits removed. It ran case 5 twenty times. One run returned false from the original instant closure observation; all twenty independently observed retained processes eventually exited. In zero-based attempt 15, retained PID 34420 returned `WAIT_TIMEOUT` (258) from an immediate native wait after inventory/Job closure and later returned `WAIT_OBJECT_0` from an independent native wait. No native wait failure was observed in this diagnosis.

The original phase SHA256 was `070b79fa4f3943908652b5b56e71382d09ea2101008ac509b4f07ef6119033e6`; original owner source SHA256 was `a1b5221e0b0cc04ec338d807532c231e0600bed0211a2b02c6b789e22a301a33`. Receipt `2026-10-09T01-45-10-942Z-stdio-retained-exit-native-diagnosis.json` records the bounded command and output. This establishes a local timing defect in the original observation strategy. It does not identify the exact hosted failing process or prove that its failure had the same cause.

Windows documents that [a zero-time process wait returns immediately](https://learn.microsoft.com/en-us/windows/win32/api/synchapi/nf-synchapi-waitforsingleobject), and that [process termination can require an explicit wait for completion](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-terminateprocess). The local native observation supplies the specific evidence for this Job/inventory ordering.

## Change and bounded refusal behavior

`CloudGuestProcess` starts one monotonic closure clock immediately before stdio Job termination. Root exit, initial inventory/Job closure and all retained stdio-member exit observations consume that same 2000 ms deadline. The phase receives the same running clock; it cannot restart an exhausted budget. Non-stdio cleanup retains its existing two-argument root-exit helper and behavior.

`CloudGuestStdioPhase` polls actual retained process handles with zero-time waits. It retries only `WAIT_TIMEOUT` while the shared deadline remains, sleeping at most two milliseconds per retry. `WAIT_FAILED` and every other unexpected wait result permanently refuse confirmation. Success requires all held members signaled before the deadline. Scheduler overhead can make return occur slightly after the deadline; no blocking native wait receives an additional budget.

The receipt records one final wait result per held record, its immediate Win32 error for failed waits, retained PID, birth time, image observed while alive, and original/observed source. Census limits and retention sources are unchanged. Duplicate held records remain distinct; diagnostic record counts do not imply unique process counts. An exhausted deadline leaves wait result/error null, preserving the absence of an observation. No watched file content or credentials are added.

The change does not modify launch/release authority, live identity checks, readiness predicates, production flags, stdio transport limits, compiler/transfer size caps or the historical baseline fixture. The existing readiness baseline's interface is adapted only in its generated local compilation.

## Regression and verification

The new fixture uses actual Job-owned processes, standard handles and independent retained-process waits. Its closure-visibility schedule is explicitly synthetic. It removes the old pre-observation member waits that masked the race. A transient 80 ms timeout must settle within the owner's remaining deadline; an actual invalid native handle produces `WAIT_FAILED` and error 6 and must remain refused even though later native process waits succeed. Persistent timeout and an already exhausted clock must remain refused. Every control independently confirms actual retained-process exit.

The first regression failed against the original instant-wait source with `transient-retained-exit-timeout-must-settle-within-owner-budget`; receipts `2026-10-09T01-47-49-363Z-stdio-retained-exit-red.json` and `2026-10-09T01-50-13-585Z-stdio-retained-exit-shared-clock-red.json` remain preserved. After the minimal change all four controls passed. A subsequent compatibility check exposed the changed private root-wait signature through the existing reflection fixture; its red receipt is preserved. Restoring the original two-argument method and using a separate budget helper passed all 11 native cleanup controls.

| Bounded verification | Result |
| --- | --- |
| `test-cloud-guest-stdio.ps1 -MutationControls` | Passed: 8 native transport cases, 5 diagnostic controls, 8 natural-exit schedule controls, 2 inner wait-failure controls, 2 wait-guard mutations, 3 regression mutations, 11 readiness controls and 4 retained-exit controls |
| `test-cloud-guest-stdio-retained-exit.ps1` after diagnostic assertions | Passed: 4 controls, actual failed-wait error/identity recorded, timeout and unobserved diagnostics distinguished |
| `test-cloud-guest-stdio-cloud.ps1` on final owner source | Passed: maintained actual compiler composition, 41 receipt/controller models, 18 runtime/task source models, 5 transfer/pinning cases and 6 prior-closure ordering models |
| Final maintained binaries | Owner 77312 B / 81920 B cap; stdio host 24576 B / 65536 B cap; helper 12288 B / 65536 B cap |
| `test-cloud-guest-token-cleanup.ps1` | Passed: 11 native same-principal cleanup controls |
| Focused ESLint, Prettier and `git diff --check` | Passed for owned changes |

The final retained-exit receipt reports transient success, immediate failed-wait refusal, persistent-timeout refusal and exhausted-budget refusal. All independent native waits returned signaled. The final compiler test compiles the actual owner/interface/phase together; local retained-exit execution substitutes the helper path and checks the same local SID/session. It does not execute the protected cross-account owner path. Full CI and any new hosted run remain separate coordinator work.

Receipts and untruncated logs are retained under `X:/tmp/aegis-github-review-20261006`, with copies and native binaries in the external frozen review packet. Commands use Windows PowerShell 5.1, per-process X-drive `TEMP`/`TMP`, `NODE_DISABLE_COMPILE_CACHE=1`, hidden native processes and an 8 MiB runner log cap. Disposable exact fixture directories have a seven-day / 32 MiB retention policy, with locked files and reparse points excluded from cleanup. Original cloud records, red/green receipts and frozen review files are preserved. This records a retention policy and measured sizes; automatic rotation is not claimed.

## Hosted follow-up

[Cloud run 37876000808](https://github.com/antropos17/Aegis/actions/runs/37876000808), attempt 1, job `113644640658`, succeeded on source `9e1b20d85ef9698353d39194b556587da8a26ef4`. Hosted preflight passed in 101 seconds, followed by the pinned Windows 11 task, evidence validation and artifact preservation. The later master merge has the same Git tree, but the receipt continues to identify its actual tested commit. The [original raw receipt](evidence/20261007/37876000808.json) is 315440 bytes, SHA256 `22324260d976ad937b756494a63b56c7147d9aafdd5d93f5bd956a09488c0c24`.

All five fixed stdio cases passed their original predicates. The cancellation case confirmed readiness, held-payload identity and retained-member exit, with 17 held records reporting signaled native waits. Held-record counts can include duplicate identities. The five closure observations took 3, 14, 9, 16 and 11 ms within the unchanged shared 2000 ms deadline. Every reported retained wait was signaled, with no failed-wait error. This is actual guest evidence for the fixed stdio observation path; the exact cause of the original Cloud36 failing member remains unknown.

The fixed sealed-copy capture, transfer, independent guest read/edit/test and original-source recheck passed. Both controlled owner-exit cases passed their maintained predicates. The kill-on-close case preserves `jobClosureConfirmed=null` and `handle-released-not-observed`; its retained-process exit observations do not supply a post-destruction Job census or crash/reboot evidence.

VM `3cb3cda3-8981-43d4-9526-558e738e307a` was observed off and removed, with `settled-and-exact-vm-absent`, no failure and no cleanup failure. Closed owned VHD and media cleanup completed. All five reported host-canary unchanged observations passed; the receipt carries no separate individual initialization-status fields. These observations apply to the recorded corpus and routes.

Independent GPT-6.1 Sol review verified the original run, job, attempt, artifact metadata, API archive digest, byte-identical raw entry and source bindings. Artifact `11593056798`, `enforcement-windows11-37876000808-1`, is 24393 bytes with ZIP SHA256 `4886c0eecf935312a3dc26477b51963ad16c1cc48d95e78b8de2a33bcaaeeef9`. The receipt's 85 tracked source hashes match the retained tested checkout. The original external `git-runtime.zip` is unavailable for independent reconstruction; its recorded hash remains an observation rather than a newly verified archive. The frozen external packet is retained under `X:/tmp/aegis-cloud-hyperv-20261007/cloud-run-37876000808`.

Cloud37, run `37873153235`, stopped in sealed-control preflight before VM startup and produced no artifact. Its original failed job metadata and log remain retained; there is no invented raw receipt or index entry. The previous 32 indexed raw receipts, including the failed Cloud36 receipt, remain unchanged.

The successful fixed lab result retains `labOnlyPowerShellDirect=true`, `atomicJobAtCreation=false` and false launch, A1, E2/E3 and provider acceptance flags. The controlled owner exits, selected routes and fixed corpus add evidence for their specific paths. Whole production admission, protected broker ownership, the complete adversarial matrix, general terminal behavior and crash/reboot recovery remain unqualified. No whole enforcement task or acceptance gate advances from this result alone.
