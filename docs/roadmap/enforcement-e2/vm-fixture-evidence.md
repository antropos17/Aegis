# VM foundation evidence — 2026-09-28

Scope: **developer admission/recovery code and read-only native API subset**.
No native VM lifecycle, guest bootstrap, guest-to-host isolation, protected host
inventory, file effects or useful guest Node/Git task was run. Full E1/A1/E2 stay
incomplete. Neither a synthetic result nor the preceding scoped review grants
production launch authority.

The final Windows x64 focused run passed **161/161**, with no skips: **67** new
foundation cases, **63** existing inactive protocol cases and **31** existing
filesystem diagnostic cases. The new cases exercise MAC/framing/replay/binding,
single-use release, durable intent failures, short/zero writes, journal caps and
corruption, cancellation, late start/release/stop, observer loss, independent
pending jobs and recovery without resuming. The lifecycle integration test uses
the actual fsync journal with synthetic backend callbacks.

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

Local renderer build, lint, formatting, project type checks, Svelte checks,
witness/sequence mutation gates, derived counts and production dependency audit
passed. Lint retains existing warnings and no errors; Svelte reports no errors
or warnings. The required hosted five-context CI run is bound to the final HEAD
in the review packet. Linux CI does not execute native Windows-only cases.

Raw receipts live in the owned task directory `X:/tmp/aegis-enforcement-e0-20260928`.
The review archive contains a redacted copy, the exact complete changed source,
full patch, relevant unchanged protocol/packaging context and prior actual review.
The packet distinguishes developer tests from the still-required
[native matrix](windows-vm-qualification.md). Exact authorized disposable
host/image and reviewed privileged fixture remain outstanding.
