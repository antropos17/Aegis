# Fixed guest standard-stream qualification

Status: **reviewed implementation; actual standard-user guest execution pending**.

The implementation adds five fixed cases after the existing useful-task,
receiver, witness and cancellation closure checks: binary input and output with
EOF, concurrent stdout/stderr draining, separate stdout and stderr limits, and
cancellation while the payload is alive. Each case uses a fresh authenticated
runtime and owned Job. The host requires unchanged canaries after this phase.

The owner creates local pipe endpoints before launch. OS Job census and retained
handles bind the helper PID, birth time, image, session and standard-user token
before transport attachment. The existing startup seal and acknowledgement
precede payload release. Successful byte-transfer cases require exact content,
EOF and natural root exit zero. Limit and cancellation cases require a live root
before termination and observed exit 137. Every accepted case also requires
retained-process exit, Job closure and private-desktop closure.

The exchange deadline is five seconds, helper discovery is three seconds, and
the five-case remote observation has a separate sixty-second deadline. Input
and each output are bounded by 65,536 bytes. Existing admission, loader,
acknowledgement, receipt and binary limits are unchanged. Receipts contain fixed
observations and byte counts; transported bytes are not included.

## Source and local review

The immutable integration candidate uses baseline
`6af571947a5af0e3c099951077a61de223e3f91b`, with compatibility checked against
merged revision `b3c70ab3774af112d61fd3c29515666280aff0e7`. Its manifest SHA-256
is `c34dd27af2b49183604776fc5e52d8b335ade70f05445030c48d834aac80f7ba`;
patch SHA-256 is
`26c4709784c054972221871e843bd55f70769a7f32432218c1fc651e0cc992f9`.

Independent review found no actionable defect in the selected source. It
verified the retained inputs and independently passed the receipt/controller
and actual-runtime source models. Recorded transport controls include binary
echo, concurrent output, output limits, cancellation, deadline and wrong-peer
refusal. Three compiled mutations exercise missing EOF, missing stderr drain
and a missing inherited-handle whitelist. These controls use the same local
principal and do not establish cross-account guest behavior.

Canonical paired compiler measurements preserve the existing caps: the guest
DLL changes from 73,216 to 74,240 bytes; the separate bridge is 19,456 bytes and
helper is 12,288 bytes. The runtime fixture is 81,920 bytes, exactly the unchanged
inclusive 80 KiB cap. Measurements from different compiler compositions are not
substitutes for these pairs.

The first integrated local maintained preflight on 2026-10-08 passed earlier
phases and both cancellation controls, then refused the first Node stdio case
at `Exchange`. Its closed native stdout was empty; stderr contained the fixed
phase and refusal labels. This phase covers both exchange and result assertions,
so the retained output does not identify a cause. Three subsequent isolated
Node probes passed. Those observations establish non-reproduction, without
explaining or superseding the original failure. The original bounded receipt
SHA-256 is
`77e2dbe6321cf8dfdfb1fa38843e942d32b1d63a5ecc8d4c56cbee6ef18f88be`;
its untruncated log SHA-256 is
`3afd35ae35aacb98155498d7d88152d5572859cf3c9076a8478f5bef83feb4c1`.
The separately invoked integrated compiler/transfer/pinning controls passed.

A controlled native schedule separately reproduced a natural-exit race: the
retained helper could exit between the live snapshot and an identity query.
Image and token observations can become unavailable during teardown. The repair
preserves initial live peer admission and permits this transition only after
stdin EOF, within the original clock and cancellation bounds, to the same held
PID, birth and Job with observed exit zero. Observed mismatches and failed or
unknown wait states refuse. Exact output bytes, every stream EOF and separate
owner-controlled process/Job closure remain required.

Independent review of the first repair found that generic identity exceptions
could also hide failures in either inner process wait. The corrected source uses
explicit wait-state checks outside observation recovery, with regression
controls for both failures. Its immutable manifest SHA-256 is
`c76d8b1f17c9d198ae3c640f837a13f5dfb142376bee5ba48436a78225dce41c`;
patch SHA-256 is
`95b60e7c6b8cc747e67e6010d0f9ae1e0c6bd2198b08519964c7afbdc636a104`.
The actual compiler control records the corrected bridge at 21,504 bytes;
the guest DLL and helper sizes above are unchanged. Controlled wait failures
do not establish that Windows returned those errors in the original preflight.

The local fixture also selects its fixed Node case explicitly. An inherited
case-selection control reproduced different bytes in the earlier fixture;
the original preflight did not record that environment, so this does not explain
its failure. Guest owner selection of all five cases remains unchanged.

Independent review passed the corrected immutable delta. The complete maintained
Windows PowerShell 5 preflight passed on integrated master
`7698fea820143a8c2ae8ff01ce8096eec7b52d8f` plus this change in 52 seconds,
including both existing cancellation cases, native stdio cases, retained-exit and
inner-wait controls, compiler/transfer/pinning and receipt models. These remain
local controls pending actual hosted standard-user observation.

## Acceptance scope

This fixed transport has no arbitrary command surface or production admission
path. General terminal operation, full E2.2, the complete containment matrix and
production launch require their own evidence. This document does not enable
any of those gates.
