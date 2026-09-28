# VM foundation evidence — 2026-09-28

Scope: **developer admission/recovery code and read-only native API subset**.
No native VM lifecycle, guest bootstrap, guest-to-host isolation, protected host
inventory, file effects or useful guest Node/Git task was run. Full E1/A1/E2 stay
incomplete. Neither a synthetic result nor the preceding scoped review grants
production launch authority.

The corrected Windows x64 focused run passed **171/171**, with no skips: **77** new
foundation cases, **63** existing inactive protocol cases and **31** existing
filesystem diagnostic cases. The new cases exercise MAC/framing/replay/binding,
single-use release, durable intent failures, short/zero writes, journal caps and
corruption, cancellation, late start/release/stop, observer loss, independent
pending jobs and recovery without resuming. The lifecycle integration test uses
the actual fsync journal with synthetic backend callbacks.

Actual review `vm-fixture-4a3f420-20260928` returned FIX_REQUIRED at HEAD
`4a3f42015fc56b0f43c24450b83481d0cbb545a1`. Its raw response SHA-256 is
`4bf06b327603850dbbbb4c0dbfd52c0fbde11a5ed016b081d7d234700ad049e1`.
F1 showed that a delayed off snapshot could outlive an earlier pending start,
record false stopped status and disable a later stop. Before the correction, two
deterministic regression cases failed with stopped instead of cleanup-unknown;
eight neighboring cases already passed. After the pending/revision observation
fence, all ten cases pass, alongside the existing late-work and recovery tests.
The new cases include late release, explicit cleanup retry after caller timeout,
sticky journal failure and cancellation during four observation points. This is
fix verification for the synthetic controller. Actual scoped review
`vm-fixture-r1-bf464c1-20260928` accepted the correction at HEAD
`bf464c153ff5b3be87a78a3d21d462991495aa95`; its raw response SHA-256 is
`ca7e599dbf76a7ebd883742e7dd55bc513e4bb577c5021b40b0684df3771493a`.
The reviewer independently checked 171/171 Windows cases, old/new ordering
controls, source/patch integrity and exact-HEAD CI. PR #695 merged as
`567c6b00b3dac04970b7ef5284a20a53e764e191`.

The final read-only probe queried OS build **26200** and hypervisorPresent=true.
Management service instance observation returned **unavailable** in the current
unelevated process, despite the earlier read-only namespace/service discovery.
This receipt cannot distinguish UAC filtering, inaccessible or absent service
instances. The exact all-zero VM GUID returned **missing**, with no VM details.
No existing VM was selected. The native observed-VM settings branch therefore
remains not-run: generation/Secure Boot/NIC subset code has no positive native
selected-VM control yet. Missing is not a security denial or a containment PASS.

The fixed synthetic lifecycle CLI produced ready → running → stopped, exactly
one fixture release and seven journal records; recovery launch stayed refused.
The receipt states effectsRun=false and nativeContainmentQualified=false.
Native and synthetic receipts retain independent source hashes; native receipts
also contain compiler/executable hashes. They contain no key, challenge, SID,
VM name, host resource path or project content.

Seven CLI controls passed: each CLI refuses an existing receipt, relative path
and unknown option, and native inspection refuses an invalid selector. Existing
receipt bytes stayed identical; no new control scratch output or relative-path
receipt appeared. Both CLIs return code 2 and a fixed generic diagnostic.

Affected Windows tests, the real-journal synthetic CLI, lint, explicit source
formatting and derived counts were rerun for this correction. Earlier local
renderer build, project/Svelte type checks, mutation gates and production audit
receipts apply to unchanged inputs. The required hosted five-context CI run is
bound to the corrected HEAD in the review packet and reruns all ten required
commands. Lint retains existing warnings and no errors. Linux CI does not execute
native Windows-only cases. Native inspection source is unchanged; its earlier
receipts and byte provenance remain separate from the corrected lifecycle run.

Raw receipts live in the owned task directory `X:/tmp/aegis-enforcement-e0-20260928`.
The review archive contains a redacted copy, the exact complete changed source,
full patch, relevant unchanged protocol/packaging context and prior actual review.
The packet distinguishes developer tests from the still-required
[native matrix](windows-vm-qualification.md). Exact authorized disposable
host/image and reviewed privileged fixture remain outstanding.

The next [native bootstrap evidence](native-bootstrap-evidence.md) documents
additional process/pipe/Job cases. It retains these VM effects as not-run and
needs its own scoped review.
