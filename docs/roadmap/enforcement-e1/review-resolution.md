# E1 inactive protocol / Astra resolution

Actual review: `E1-protocol-5418249-20260928`, returned 2026-09-28.
Verdict: **PASS for the inactive protocol slice only**; no blocking finding.
Reviewed BASE: `c1d0aa6dc74b31e63e9cd8c0687638048e31f3ae`.
Reviewed HEAD: `54182492c68f72faef43ff45214dc7efb2b61dfd`.
Full response is retained locally as `ASTRA_REVIEW_E1.md`.
Raw response SHA-256:
`a8f37a493d9820571668ad4f81a134b2c13296a618f11b60a3834aa038ee2a2e`.
Reviewed source ZIP SHA-256:
`de797d54eb0aaec823d60d2abde1e4ffc70c658e1a7fd69548987c5261960a72`.

Sol verified the unchanged clean HEAD, matching PR base/head, and five successful
required contexts before marking [PR #692](https://github.com/antropos17/Aegis/pull/692)
ready and merging it. Merge commit:
`6dee6f0b6ff43a52e01768b4534398d7dd97543a`.

The reviewer independently matched the complete diff and 47 Git source files,
repeated 63/63 tests (37 JS + 26 native, no skips), and ran three separate native
probes. Full CI ran on Ubuntu; its native Windows skips establish no additional
Windows effects. The earlier passing local batch and preserved teardown EPERM
retain their distinct meanings.

| Carried condition | Current resolution |
| --- | --- |
| Partial E1 only | No production launch, authenticated ownership or OS containment was accepted. All E1 task checkmarks remain incomplete; full A1 is UNREVIEWED. |
| Concrete identity/filesystem feasibility first | The [token/ACL research profile](identity-filesystem-design.md) and [qualification contract](identity-filesystem-qualification.md) received FIX_REQUIRED at `bba16bb`. The revision below awaits its own review; strict adoption remains blocked. |
| Future active transport and transitions | Any privileged interface, production launcher, active prepare/allow reply or new operation needs its own actual scoped review before merge. The accepted v1 remains unchanged and inactive. |
| Native recovery uncertainty | Diagnose the retained E0 teardown EPERM before A1 resilience qualification; another pass alone is insufficient. |
| Later boundaries | Credentials/subscription and grants remain A2, effects/export A3, installer/release A4. |

This record reports the returned review and completed merge. It does not issue
a new security verdict or authorize provisioning on the user's working host.

## Identity/filesystem design review and proposed corrections

Actual review: `E1-identity-bba16bb-20260928`, returned 2026-09-28.
Verdict: **FIX_REQUIRED**, two findings; PR #693 remains an open draft.
Reviewed BASE: `6dee6f0b6ff43a52e01768b4534398d7dd97543a`.
Reviewed HEAD: `bba16bbac5e8306c6a1a8760b2b39f4fa9825777`.
Full response is retained locally as `ASTRA_REVIEW_E1_IDENTITY.md`.
Raw response SHA-256:
`b1b8367f20546a717a35b5ef69212fc191ac278fe56b65c366ff256d3eeae538`.
Reviewed source ZIP SHA-256:
`f3ad9932a5cf013ad41af6c044c145a371c8e075f114895db6daa64a38013b5e`.

| Finding | Proposed correction in this revision | Remaining gate |
| --- | --- | --- |
| P1: outside NULL DACL bypasses restricting-token check | Explicitly reject the profile as a sufficient strict boundary; retain only bounded research. Add present-NULL, absent, empty and Everyone-ACE controls plus post-setup ACL changes and read/write/delete effect oracles. No strict PASS can be produced from this profile. | Revised boundary ADR with an additional mediating mechanism, then independent native effects. Original strict scope remains required. |
| P2: desktop/loader observation demanded before initialization | Separate suspended configuration checks, trusted native initialization and single-use fixture admission. Pin all pre-admission code/DLL/cwd inputs, bound the private observation channel/deadline and require failed-admission sentinel controls. | Review/qualify the native probe and its observations; Node/Git/Claude need a separate pre-project-code admission design. |

The reviewer executed only in-memory AccessCheck controls using an unassigned
temporary restricted token. Everyone read-data allowed only the ordinary control;
an explicit user ACE allowed both, an empty DACL denied both, and a present NULL
DACL allowed both. This is evidence of the mechanism gap, without separate-account
file/process effects. No desktop/loader launch probe ran. Five CI contexts passed
at the reviewed HEAD, establishing regression checks for unchanged runtime code.

These are proposed corrections for re-review, not a returned PASS. The fundamental
NULL-DACL limitation remains open for active containment. No account/service/ACL
provisioning is authorized by accepting the research documents; full E1/A1 and
the later credentials, export and release gates remain incomplete.
