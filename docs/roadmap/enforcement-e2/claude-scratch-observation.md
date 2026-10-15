# Fixed Claude scratch observation

The fixed guest task samples its scratch tree every 500 ms and once after the
task. Each complete traversal retains the existing limits: 16 MiB of file bytes,
256 entries and depth eight. Observed links, unsupported objects, quota excesses
and unavailable observations refuse the task. This sampled observer is not an
operating-system disk quota or production filesystem containment.

A temporary file or child directory can disappear between enumeration and its
next metadata/directory query. An `ENOENT` from that child permits one immediate
fresh traversal of the entire root. The task can proceed only after that complete
traversal passes the original limits. A missing root, permission failure, another
observation error, any quota excess or a second disappearance refuses the task.
No delay or larger quota is introduced. The original native owner must still
confirm process/Job closure; the task's child-kill request supplies no such proof.

`scratchObservation` contains exactly `reason`, `entries`, `bytes`, `depth`,
`error`, `retries` and `recoveries`. Counts saturate at the first excess value:
257 entries, 16777217 bytes and depth nine. Cumulative retry/recovery counts cap
at 255; successful observations require matching counts. Reasons are
`within-budget`, `entries`, `bytes`, `depth`, `symlink`, `type` or `unavailable`.
Only unavailable observations carry an error class: `ENOENT`, `EACCES`, `EPERM`,
`EIO`, `ENOTDIR` or `other`. The first final refusal remains latched. There are no
paths, names, file contents or exception messages in this field.

The strict bootstrap reader validates the exact shape, finite numeric ranges,
reason/error relationships and successful-task budget/recovery invariants.
Unknown early failures can have a null observation. A scratch refusal must retain
a non-successful observation before any native closure checks are considered.

Windows11 run 38651247611 at source 555dd895 reported only `scratch-limit`;
its exact cause is unknown. A controlled real Windows filesystem test reproduces
the false refusal after a child disappears, with an empty root afterward. The
bounded retry is covered by real file and directory deletion controls, persistent
failure, missing-root/access refusal, quota excess after retry and first-failure
retention. Hosted observations remain tied to their exact source commits; a
passing retry does not retrospectively diagnose the earlier run.
