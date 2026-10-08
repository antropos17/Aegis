# Fixed sealed project copy guest qualification

Status: reviewed implementation; actual guest execution pending.

The disposable Windows lab seals a four-file dummy project using the maintained
native capture/seal implementation. Retained source identity, content and
membership checks precede publication. The independent host oracle verifies the
bundle, and the transfer manifest binds its exact bytes.

The admitted standard-user task validates the complete fixed manifest and all
payload bytes before creating an independent copy. It reads that copy, observes
the initial test fail, changes the copied function and observes the same test
pass. Tests use only the pinned Node executable with bounded output and time.
The original host corpus and transferred bundle are rechecked after guest exit.
No user project, credentials, Git hooks or shared store is imported by this corpus.

The trusted bootstrap consumes results only after native task identity, exit zero
and Job closure checks. It independently verifies the final four guest files.
Retained reads have individual byte caps and reject observed reparse leaves and
ancestors. Membership enumeration stops upon a fifth entry and disposes its
enumerator. Child receipt fields require exact scalar types; the returned receipt
is reconstructed from validated values.

## Source and verification

The original immutable packet has manifest SHA-256
`d05c3311f506dd786a21f692fbccc61d759efbf2fc6dabdb4966a7910ae9133a`.
Independent review reproduced array-valued fields bypassing PowerShell scalar
comparisons and found unrestricted directory enumeration. Both findings were
fixed in a separate revision, preserving the original evidence.

The corrected manifest SHA-256 is
`881d732771d8250b897184c7835c1edf981790814d247e5ac08564ccfab9d2ea`;
verifier SHA-256 is
`8531f9676f81a9dc1b4d3f75b31ced4dbea3337f0c0e3823c2fe7febcc99c403`.
The unchanged proposed integration patch SHA-256 is
`f8f1ced664cd90a28bf2099d95ed604e7256098ba3f3492db0169160bb123867`.
The coordinator re-anchors its four caller changes to the current branch base;
position-dependent hunks are not evidence of that final integration.

Recorded Windows controls include two native capture/seal and local guest-consumer
tests, refusal of five native mutation seams, and 133 PowerShell controls for
scalar types, detached results and bounded enumeration. Independent review
reproduced type and enumeration controls in memory under PowerShell 5.1.
Unchanged native evidence was reused after the verifier-only repair. The bundle
contains four files and 211 payload bytes, with SHA-256
`6fd39c002f664c265523047a74d14038aa2aec1befe8707d81d925de0781298f`.

Integration review found an unsupported 60-second native helper timeout and
outdated task-model totals. The staging helper now uses its existing 30-second
maximum, with a real helper boundary control. All connected model projections
expect 27 completed cases. A subsequent preflight exposed the old Restricted
policy fixture missing the newly retained verifier input. That fixture now
exercises both hash-bound helpers, including wrong verifier hash and missing
verifier refusals, without changing execution policy.

The corrected composed intake and native controls passed under inbox PowerShell
5.1: 15 Restricted-policy controls, two actual native capture/seal and local
consumer tests, and 133 verifier controls. The successful wrapper removed only
its fresh, validated, closed fixture output (167,674 bytes). The corrected full
maintained preflight then passed in 41 seconds under inbox PowerShell 5.1,
including the composed bootstrap, task and diagnostic models, Restricted intake,
actual native copy controls and bounded verifier controls. Earlier failed
preflights are preserved separately; their results are not passing evidence.
Independent Astra requirements and engineering review approved that 18-file
integration. Scoped formatting of five JavaScript files was independently checked
for normalized AST equivalence. Formatting exposed two source-text mutations in
the diagnostic tests that no longer matched; each mutation now requires one exact
contextual target and refuses a no-op. Eight diagnostic models and all four real
altered-source executions passed after that repair. The native shell fixture also
used an array-layout terminator that incorrectly captured a following statement
after formatting. Both extracted declarations now require unique starts and
validated boundaries before their own next guard. Its three actual Windows
shell/descendant controls passed, including the missing-file refusal. The final
formatted maintained preflight passed in 39 seconds. Hosted guest execution is
pending.

These are local disposable-fixture observations. Actual guest transfer, final
filesystem verification and composed task timing require a fresh reviewed cloud
receipt. The fixed corpus grants no arbitrary command interface or production
ownership. Full E2.3 and production launch remain unqualified; admission flags
stay false.
