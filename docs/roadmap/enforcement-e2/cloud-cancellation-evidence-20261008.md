# Fixed Windows guest cancellation controls

Status: independently reviewed implementation; the first actual attempt stopped
at Windows Setup before runtime or cancellation execution. The
[verified useful-task corpus](cloud-hyperv-evidence-20261007.md)
is the prerequisite for these additional qualification cases.

The first case authenticates and seals the initialized runtime, rechecks its
caller and retained Job inventory, withholds project ACK and requests Job
termination. The administrator checks that the fixed payload marker is absent.
The second case releases a fixed payload and retains a live Node descendant's
native handle, birth identity, image, principal and standard token before
requesting termination. The controller constructs no new calibration receiver.

Both require an observed live root, accepted Job termination, root exit 137,
independently empty Job and private desktop closure. The second additionally
requires the retained descendant's exit. Natural completion, a prior admission
failure or an unknown observation cannot count as successful cancellation.
The host requires the previous useful-task Jobs, receivers and separate witness
to have closed, then checks host canaries again after the new cases.

The frozen 13-file donor has SHA-256
`8199c5a7bf78f34d4239486219e0f5f1cb123d5e53a0025306aafffd516e491f`;
its patch has SHA-256
`12ff80e8d1136f25351dbcad86b50bf861d700f50310ef23a8e3841e7a50c962`.
Independent Astra review verified source and evidence hashes, caller/transfer
wiring and both requirements and engineering behavior. Its two draft findings
were corrected: truthful natural/unknown exit reporting and strict descendant
identity validation in the host consumer.

Recorded explicit Windows PowerShell 5.1 checks passed 68 pure controls and two
actual same-principal native cancellation cases. Three altered-source controls
detected premature payload execution, missing descendant identity validation
and incorrect natural-completion reporting. The existing runtime fixture passed
14 native controls. Seven affected compiler compositions remained within their
existing size limits; no cap was increased. These local observations do not
establish the guest's standard-principal or private-desktop behavior.

The integrated maintained Windows PowerShell 5.1 preflight passed in 40.1 seconds
with 14,277 bytes of untruncated output, including the two new native cancellation
cases and all existing runtime, shell, receiver and witness controls. All four
new JavaScript files passed ESLint. These checks used the final reviewed bytes.

One earlier local native fixture refusal remains unexplained. Its diagnostic
log is retained with SHA-256
`baf19ed6035eaea8322ceb29e7d9f59a08833f0d441e0969f0fcb889eabcb49e`.
The final fixture records both passing cases and additional release/payload
observations, with controls-log SHA-256
`f4bef354f8d37bcc6af56086614684a451b957a9b327a6b687e4163836876481`.
Later success does not explain the earlier refusal. Independent review permits
one bounded actual lab run; recurrence requires diagnosis before another retry.
No stability claim follows.

The subsequent test-only diagnostic revision preserves fixed case/phase lines
even when the fixture wrapper throws. It accepts only an allowlisted diagnostic
format, rejects reparse points and output above 4,096 bytes, and retains the
15-second native deadline and 80-KiB fixture cap. The corrected frozen evidence
manifest has SHA-256
`9bd981396c381ca1842c3e0384684ec2d2e8b128e3824e34efeeb666e58233b9`.
Independent Astra review approved exactly the PowerShell test wrapper and C#
fixture. Integrated Windows PowerShell 5.1 validation passed all existing pure
controls, both actual same-principal cancellation cases and two diagnostic
controls; the compiled fixture was 76,288 bytes.

The first diagnostic comparison stopped at compilation and could not establish
native failure reporting. That evidence is preserved and explicitly superseded
by two controls that both compile and reach the intended native refusal. Only
the candidate retains the fixed phase before refusal; neither emits raw error
text or leaves disposable directories. This correction does not identify the
cause of the earlier historical refusal.

The actual guest run uses runtime revision
`88fccf508535eba0055bf035484f90431e3b6ce1`. The later two-file diagnostic delta
changes local fixture source hashes, while the executed guest runtime and
cancellation acceptance predicates remain byte-identical to that revision.

## First actual attempt

[Run 37725510372](https://github.com/antropos17/Aegis/actions/runs/37725510372)
at that revision failed with `guest-setup-psdirect-not-ready`. The readiness
wait lasted 1,082,224 ms; no successful PowerShell Direct session, standard task,
Claude task or cancellation phase was observed. The owned VHD grew to
16,647,192,576 bytes and then stopped changing in retained samples. This does
not identify the Windows Setup failure's cause. Attempt-level remoting errors
were not retained. Both early thumbnails had a size mismatch also present in
the successful preceding run, so no useful boot image was retained.

Independent review matched all 59 repository source hashes to the run revision.
Boot, media, VM and readiness code were unchanged from the successful preceding
run. Start and stop operations settled, the exact VM was observed Off and
removed, and host canaries remained unchanged after removal. Cleanup reported
no failure. The [raw receipt](evidence/20261007/37725510372.json), SHA-256
`61ae1b5247134be5c5c1bcdfedf93a4b411866dc826fde27fb8fbfdbbc8fe5c1`,
is retained as a failed setup attempt. This is separate from the earlier local
native refusal. One bounded fresh attempt is justified with unchanged runtime
predicates and setup deadline; repeated setup failure requires bounded readiness
diagnostics before another retry.

## Hosted preflight refusal

[Run 37727519745](https://github.com/antropos17/Aegis/actions/runs/37727519745)
at `f7bc5790a64767952e9b4c07af3c990cdf0d65ce` stopped in hosted preflight.
Three actual same-principal shell cases passed, then the shell model wrapper
reported `shell-controls-refused`. Its original wrapper removed stdout/stderr
without retaining fixed failure details, so the failing model and cause are
unknown. The VM execution step was skipped, and no VM receipt was produced.
This run therefore supplies no second Windows Setup or cancellation observation.
The preserved preflight log has SHA-256
`ae13002805de880539185bb65dd80397ea9b55fc39e741355ad4275e55ad08f8`.

The reviewed shell-test repair retains fixed case/phase/error categories, child
exit status and stream byte counts before cleanup, with strict schema and label
validation. All original assertions, the model's 1,000-ms VM timeout, 5,000-ms
model process budget and 15,000-ms native budget are unchanged. The frozen donor
manifest is `22dd252b99b7fe5a6a7a115b4d786ba382c9a7e71b04a56714480d16a12a3f00`.
Independent Astra review approved its three test files and exact ignore-rule
exception. Integrated PS5 execution passed eight wrapper controls, four actual
Node executions of altered test copies, the native shell cases and all original
model cases. The baseline missing-diagnostic regression fails at the expected
assertion. These results repair evidence loss without identifying cloud26's
historical refusal cause.

## Readiness deadline and diagnostics

Source review found a separate readiness defect: the original loop checked its
1,080-second limit before blocking remoting calls, so a true response arriving
at 1,081 seconds could still admit downstream work. The repaired caller checks
the same limit after session acquisition and after the profile response, then
closes and clears expired sessions. It preserves the observed establishment
history and records rejected late profile readiness separately.

Readiness evidence now retains capped attempt/failure counts and fixed first/
last failure metadata: phase, exception category and numeric HRESULT. It excludes
raw messages, credentials, paths, usernames and remote payloads. All six guest
command bodies, the ten-second polling interval and outer worker deadline remain
unchanged. A blocked provider call is still governed by that outer worker fence.

Independent Astra review approved the frozen two-file donor with manifest
SHA-256 `4be38ec55fc6f87d7e3b7cfc5f0549dba5152a892d2c62cae56e8d721cd9841d`.
The baseline/candidate regression demonstrates the late-admission defect and
its rejection after repair. Explicit Windows PowerShell 5.1 passed all 25
source-extracted readiness controls, including cleanup, recovery, sticky history,
boundary times and redaction. The integrated maintained bootstrap test also
passed. These command-double tests do not establish an actual PS Direct failure
cause or a completed guest cancellation observation.

These cases cover fixed owner-requested cancellation only. Full terminal I/O,
crash/reboot recovery, all host routes and production cancellation interfaces
remain outside this evidence. E2.2, E3.3, E2/E3 overall, A1 and launch are not
accepted by these local controls; qualification flags remain false.
