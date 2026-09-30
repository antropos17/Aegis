# Native bootstrap evidence — 2026-09-28

Scope: **one trusted same-principal Windows process, anonymous pipes and Job**.
No VM, separate guest principal, filesystem/network restriction, actual Hyper-V
socket peer, useful guest Node/Git task, online provider or credential was tested.
The [fixture contract](native-bootstrap-fixture.md) states these limits.

The final Windows x64 run passed **226/226 tests, no skips**, in thirteen files:
**55** new bootstrap cases and **171** existing protocol/filesystem/VM foundation
cases. The new cases include eleven native assertions for nine process scenarios,
report consistency tests and seven CLI refusal controls. The initial behavioral
red test rejected an unsafe validator that accepted release without initialized
held-process observation; it now passes with the strict report contract.

During native development, the initial exact-one-member Job assumption failed.
A separate disposable diagnostic observed the fixed executable and `conhost`
inside its private Job. The final fixture records a nonzero initial active count
and pins its one held child; complete member inventory remains unqualified.
This correction is not a filesystem or network containment conclusion.

The standalone CLI compiled the exact ten C# sources with inbox x64 compiler
**4.8.9221.0** on OS build **26200**, then ran all nine cases. The Node harness
was **24.11.1** and the test harness **Vitest 4.1.11**. Source/compiler/executable
hashes were checked before/after execution and saved with the receipt.

| Mode | Initialized admission | Fixed task released | Expected refusal | Held child exited | Job queried empty | C# frame verified in JS |
| --- | --- | --- | --- | --- | --- | --- |
| admit | yes | yes | none | yes | yes | yes |
| cancel | yes | no | none | yes | yes | yes |
| close-job | yes | no | none | yes | unavailable | yes |
| bad-mac | no | no | frame-authentication | yes | yes | no accepted frame |
| cross-epoch | no | no | frame-authentication | yes | yes | no accepted frame |
| oversized | no | no | frame-size | yes | yes | no accepted frame |
| replay | no | no | frame-consumed | yes | yes | no accepted frame |
| observer-loss | no | no | injected observer-unavailable | yes | yes | no accepted frame |
| timeout | no | no | frame-timeout | yes | yes | no accepted frame |

The three accepted messages were checked by the unchanged JS verifier with the
collector's fresh binding and key; second acceptance was refused. The image hash
matched the independently compiled executable hash. Runtime/principal/Job hashes
retain the contract's limited provenance: core assembly file, same TokenUser SID,
and child-stamp/limit fingerprint. They are not complete guest runtime/identity
attestations. Unexpected startup/EOF/API failure is not a successful injected
denial; both native and JS validators require the expected refusal category.

The address codec checks a pinned byte vector and rejects foreign VM/service,
wrong size/family/reserved fields, zero service and all documented special VM
routes. It makes no socket or registry call. No connected peer was exercised.

CLI controls refused missing receipt, relative path, existing receipt, wrong
extension, a VM selector, arbitrary command text and duplicate options. Each
returned exit 2 with the fixed generic diagnostic. Existing receipt bytes were
unchanged; no relative receipt, compiler scratch or extra output appeared.

Raw final receipts in `X:/tmp/aegis-enforcement-e0-20260928/receipts` are
`native-fixture-complete-windows.json/.txt`, `native-fixture-complete-cli.json/.txt`
and `native-fixture-complete-proof.json`. Earlier failing/development receipts remain
separate; the review packet labels them as such. No key, challenge, VM/session
binding, raw frame, user SID, host path or project content enters the native
receipt. Saved output is bounded and the receipt is exclusively created/fsynced.

The final review packet binds complete source/diff, receipt hashes, actual scope
and five required CI contexts to the submitted commit. Linux CI skips the eleven
native bootstrap assertions; it cannot replace these matching Windows receipts.
Scripts/tests are outside the application packaging list, production call graph,
main typecheck and measured main coverage scope. No main module/IPC count changed.

Actual independent review `native-bootstrap-fa05fd3-20260928` returned scoped
PASS at HEAD `fa05fd39feef3db99fc52a2a02cc984921d253f6`. It independently checked
226 Windows tests, nine standalone scenarios, 39 additional controls, archive
integrity and all five exact-HEAD CI contexts. Raw response SHA-256 is
`8f341f0a87dddc1a7e0d8dd0b905abe8391f7b144b983d55850ce20104e26735`.
PR #696 merged as `2e325d0591c4011c9c4e25d7bc0522202fb96be1` on 2026-09-28.
This review covers only the stated same-principal process fixture. The subsequent
[channel/Node/Git fixture](guest-channel-fixture.md) needs its own scoped review.

All E1/E2 task checkmarks and full A1 remain incomplete. The inactive protocol
still refuses preparation.
VM lifecycle/jobs, protected owner inventory, guest bootstrap/transport, runtime
closure, private desktop, malicious same-user callers, helper crash/reboot,
useful Node/Git, file/network effects, real credentials and export remain not-run.
