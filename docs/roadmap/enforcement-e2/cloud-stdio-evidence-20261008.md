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

## Hosted preflight refusal

Hosted run `37764392840` used committed source
`cf331fba8b2ac012500ca0a35d4e56656b7d3e4e`. It stopped before VM creation in the
existing cancellation fixture at `after-ack:DescendantObserve`. Before-ACK
cancellation passed; the after-ACK release and payload observations were true.
Guest standard-stream execution did not run. No guest root, raw guest receipt
or guest artifact was produced. This run is a source-check failure and is not
included in the actual guest-attempt index.

The exact focused cancellation composition subsequently passed locally. The
original hosted failure remains unexplained. A diagnostic-only candidate records
the current predicate's before/after Job counts, member and image-category
counts, stage and Boolean result. It does not change admission or deadlines.
`CLOUD_CANCELLATION_DIAGNOSTICS` gates the instrumentation, and only the maintained
cancellation fixture compiler enables it. Ordinary runtime compilation retains
the original four-argument observation method and its identical IL hash.

The candidate manifest SHA-256 is
`ec6d899f4f7b85b9c0a185e7bc51f14097c4888ea1adca63624e05b387615945`;
patch SHA-256 is
`01f384b040eceb0da49f97e0c9b8686b13442f0bb784bf05821a12db404a5685`.
The instrumented cancellation fixture is 79,872 bytes. Paired uninstrumented
runtime fixtures remain 81,920 bytes under the existing inclusive cap. Local
controls record both native cancellation cases and a deliberately inconsistent
snapshot that refuses while retaining the typed diagnostic. That control does
not establish an inconsistent snapshot in the original hosted run.

Independent Astra review passed that frozen diagnostic revision, including all
155 inputs, 345 retained files, conditional-source equivalence, retained binary
reflection and eight diagnostic filter controls. After integration on master
`bec975c495d79fc3d2df061271d4867df77138d4` plus the stdio branch, the complete
maintained Windows PowerShell 5 preflight passed in 54 seconds. It observed both
native cancellation cases, the new diagnostic controls, eight native stdio
cases, eight retained-exit/wait schedules and the maintained compiler controls.
The original hosted cause is still unknown, and a fresh hosted observation is
required. No guest acceptance is inferred from this local pass.

## Acceptance scope

Hosted run `37766973092` used committed source
`56e30fb2908321cfcfd386c0814d53885fdd5943`. Its maintained preflight passed,
including cancellation and stream controls. The lab then timed out during
`pinned-media-download-and-hash` after 600,080 ms, with the existing 600-second
download cancellation source. Creation of a VM was never submitted. The raw
receipt is retained in the attempt index with SHA-256
`a208c32d890a47b730c290aa1a9b9e391dd53026d1dd297f3aa84354ee409926`.
All 68 recorded source hashes match the exact committed content under Windows
checkout line-ending representations. Closed owned-file cleanup removed the
partial ISO of 5,562,712,064 bytes. This demonstrates admitted response headers
and file writes; it does not identify the cause of the incomplete transfer.
Guest streams and containment were not observed in this run.

The reviewed diagnostic increment retains a closed, 12-field observation even
when download fails: phase, status, expected/declared/read/written byte counts,
read attempts, elapsed/progress timing and deadline state. It includes no URL,
headers, paths or exception messages. The pinned admission, ten-minute CTS,
buffer/output bounds and existing cleanup remain unchanged. Independent Astra
review passed frozen packet
`83f6f8fe65994414f80cf5fe95124d5a7ff5b6585524120ed08af7f85a69676f`.
After exact integration, production admission refusals, five actual local HTTP
controls, the written-counter mutant and the actual failed-download caller
projection passed under PowerShell5.1 in seven seconds. Those fixture observations
do not reproduce the public CDN transfer or establish its failure cause.

This fixed transport has no arbitrary command surface or production admission
path. General terminal operation, full E2.2, the complete containment matrix and
production launch require their own evidence. This document does not enable
any of those gates.
