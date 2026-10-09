# Retained caller preparation and one-use release — 2026-10-09

Status: internal composable native primitive. This adds a controller setup phase
to the [retained caller launcher](supervisor-caller-launcher-native-evidence-20261009.md).
Protected enrollment, trusted bootstrap/locator delivery, broker/operator binding
and production activation remain separate implementation requirements. Full E1.2,
E1.5 and A1 remain incomplete; the inactive `Program` and launch flags are unchanged.

## Controller contract

`CallerLauncher.Prepare(fixedImage, expectedSize, expectedHash, session)` creates
the selected child suspended in the atomically supplied private kill-on-close Job.
It pins the executable and ancestors, checks the held process/image/Job and
observed primary token, and returns the retained `Instance` and its registration.
It performs no initial-thread resume. The trusted controller can retain this exact
instance during an intervening setup phase. Its arguments convey the existing
trusted-code image selection and no protected installation or resource authority.
This API neither chooses nor implements a bootstrap transport.
The trusted controller must not independently resume or transfer the retained
handles. Protection from hostile process/handle access remains an E1 prerequisite.

`Instance.Release()` takes the instance lock before the registration lock. Before
the first native resume, it rechecks the clean supervisor thread, retained image,
live process/birth/primary token, owned Job and noninheritable handles. It requires
the native resume to observe exactly the single initial suspension. The first
attempt consumes release: any validation or resume failure permanently disposes
the instance, revokes registration and uses the existing confirmed owned stop.
Another release attempt fails. A duplicate after successful release does not
resume again and leaves the released child owned until disposal.

`Dispose()` before release revokes registration and terminates the suspended
owned child. Disposal after release retains the existing root/Job-empty closure
requirements. Root wait and Job-empty polling retain their separate two-second
budgets; stop failure throws while held resources close in `finally`. A failure
does not certify closure or permit reuse. `CheckCurrent()` is valid while prepared
or released and uses the same retained checks, including a clean supervisor thread.
`Start()` delegates to `Prepare()` followed by `Release()` and retains its eager
execution and failure cleanup behavior.

The locks share the instance-before-registration order in current checks,
release and disposal. Registration revocation takes its own lock; a release after
observed revocation closes the instance before any payload execution. This local
API introduces no durable registration or new restart/recovery authority.

## Local native evidence

The behavioral baseline deliberately used the prior `Start()` implementation at
base `4302dddda7c7ab60e7f3acdcc7aebc89474b2553`. An actual child payload marker
was already present during the controller's intended intervening setup interval;
independently retained root and descendant handles subsequently observed exit.
The capability test failed on `markerAtSetup=true`, rather than a missing-method
compile error. This demonstrates an eager API limitation motivating the new
setup phase. Old `Start()` satisfied its own prior contract.

The maintained fixture compiles the actual native sources with inbox x64 .NET
Framework `csc`, optimization and warnings as errors. New controls observe:

| Control | Independent observation |
| --- | --- |
| Prepared release | Payload marker absent through the setup interval, selected image still refuses write access, queried owned Job/handles remain valid, marker appears only after release, root and descendant exit after disposal. |
| Disposal before release | Marker remains absent; retained root exits; release on the disposed instance and a further attempt refuse; image write access returns after cleanup. |
| Registration revocation before release | Marker remains absent; release refuses and retained root exits; another release refuses; image pins release. |
| Supervisor thread token | Independent Win32 queries observe a real same-principal impersonation token; release refuses, marker remains absent, retained root exits and later release refuses after native reversion. |
| Extra native suspension | Independent `SuspendThread` observes the initial suspension and adds another; release refuses the changed native count, marker remains absent and retained root exits. |
| Duplicate release | Second release refuses; independent root wait still observes the released child live until owned disposal, then root and descendant exit. |

Existing `Start()` controls continue to cover selected image/hash, injected image
and registration refusals, natural root exit, owner death, unrelated inherited
handle access and early-execution mutants. These controls provide disposable
same-principal native evidence. They do not qualify protected principals, process
ACLs, installer provenance, bootstrap delivery, foreign callers/VMs, guest desktop,
runtime dependencies, host provisioning or the full E1 adversarial matrix.

Source-bound baseline, final receipts, native observations and frozen inputs are
retained under `X:/tmp/aegis-parallel-development-20261009-evidence/caller`.
Diagnostics use the bounded task runner with per-process TEMP/TMP on X: and an
8 MiB log cap. Closed disposable output for the recorded caller labels is eligible
for removal after seven days or above 32 MiB, only inside the exact recorded
directories and with locked files/reparse points skipped. Frozen evidence and
verification receipts are retained. This policy is not automatic rotation.
