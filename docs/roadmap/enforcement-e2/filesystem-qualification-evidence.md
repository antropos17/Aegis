# Filesystem qualification baseline

Date: 2026-09-28. Source base: `8e0f5085acfeb83ad50fc5dbc7424b06d8f0de43`.
Scope: permanent developer diagnostic and a proposed Windows guest boundary.
Production preparation remains unavailable; full E1/A1 are incomplete.

## Executed now

The focused suite passed **31/31**, including the native probe on Windows x64.
The combined final Windows regression batch passed **94/94** with no skips:
the new diagnostic cases plus the unchanged inactive JS/native protocol suite.
The fixed C# probe uses the actual native AccessCheck API with an unassigned
restricted token, Flags=0, exactly one queried restricting SID equal to TokenUser,
and removal of every privilege except any retained traversal privilege.
All token handles/descriptors are released; no impersonation or host ACL change.

The probe records **36** paired access decisions: read-data, write-data and DELETE
on allocated Everyone/principal, empty, present-NULL and absent descriptors,
plus fresh Everyone → NULL → empty read-data checks. The ordinary and restricted
controls reproduce the existing mechanism gap. This is an API-semantic result,
without actual filesystem effects, dynamic on-disk ACL changes or guest isolation.

The validator always preserves strictBoundaryPassed=false. Adversarial receipt
tests reject altered identity/profile, missing controls, inconsistent rights,
hidden counterexamples and claimed authority. Native provenance includes OS build
and source/compiler/executable hashes; no actual account SID/content is emitted.
The build comes from [RtlGetVersion](https://learn.microsoft.com/en-us/windows/win32/devnotes/rtlgetversion)
and is cross-checked against Node's OS release. An unmanifested inbox-compiler
executable's Environment.OSVersion reported compatibility build 9200 during
development; that earlier receipt is preserved and superseded for OS provenance.

Receipts are retained locally under the task's data-drive diagnostic directory.
The standalone CLI also completed the native matrix and saved its bounded receipt.
Formatting, lint, TypeScript/Svelte checks and renderer build passed locally;
lint retained the existing **57** warnings. Production dependency audit found no
reported vulnerabilities. Full coverage runs in hosted CI; it supplies no Windows
effects for the native cases skipped there.
The review packet binds final source HEAD, complete diff and all relevant receipts.
Hosted CI and local checks are recorded separately from native Windows evidence.

## Existing review consumed

The actual review `E1-identity-r1-f0bfcab-20260928` returned PASS only for bounded
research documentation at BASE `6dee6f0` / HEAD `f0bfcab`. Raw response SHA-256:
`f1c04b78f67221ffa942b8b3d433c75112aecdd9dd683a6843f112087c34934f`.
PR #693 merged after matching that HEAD and successful required CI, as
`8e0f5085acfeb83ad50fc5dbc7424b06d8f0de43`.
The prior FIX_REQUIRED remains history; the NULL-DACL limitation remains open.

## Not-run and limits

Separate-account file effects, private desktop/admission, useful restricted
Node/Git/Claude tasks, Hyper-V availability, guest image/bootstrap/VM provisioning,
host/guest channel, integration escape cases, WFP, Pro credentials, export and
release have not been qualified by this batch. No VM or host feature is activated.
The [boundary ADR](windows-vm-boundary-adr.md) is a proposal for combined review.

Do not equate the successful diagnostic or CI with a protected coding session.
Exact disposable-host authorization is still needed before privileged effects.
The retained E0 teardown EPERM also remains unresolved for resilience acceptance.
