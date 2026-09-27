# One-attempt terminal confirmation (B1)

`--action-exec-confirm <policy.json> <request.json>` lets an operator review one
exact action before AEGIS-owned direct execution. It uses the schema 2 or 3 policy and
schema 1 request from [ACTION-EXECUTION.md](ACTION-EXECUTION.md). Both `ask` and
`allow` require an affirmative terminal response on this route. Policy `deny`
cannot be overridden.

```sh
node src/main/main.js --action-exec-confirm /absolute/policy.json /absolute/request.json
```

On Windows, choose `--action-exec-windows-job-confirm` to combine the same
one-attempt terminal review with a private Windows Job for the selected process
and ordinary member descendants:

```powershell
node src/main/main.js --action-exec-windows-job-confirm C:/selected/policy.json C:/selected/request.json
```

The Windows Job helper must be available (source checkouts: `npm run build:sidecar`).
An approved action is assigned to its Job before it starts running. Cancellation,
runtime expiry or ordinary completion requests cleanup of that Job. A missing
helper or unsupported host refuses execution; this route never falls back to an
ordinary child. Only confirmed cleanup, exit code zero and complete output
accounting yield CLI exit zero. The protected report uses `control: windows-job`;
`descendantControl` is `not-started`, `confirmed` or `unconfirmed` according to the
observed outcome. A helper failure can leave the outcome unknown.

This approval controls **whether the selected program starts**. Once allowed,
the program retains the caller's file and network access. Job cleanup cannot
undo reads, writes or transmissions already completed, and external process
brokers may create processes outside the Job. The route supplies no file
quarantine, read interception or OS sandbox. Ordinary agent launches, the MCP
review broker and saved agent permission choices do not acquire this Job route
automatically. See [the protected-launch plan](roadmap/protected-launch.md).

Standard input and standard error must both be live TTY streams. Piped input,
redirected review output and missing terminals refuse execution. Standard output
contains only the redacted execution report. The standalone JSON CLI and direct
MCP stdio tool retain their existing behavior. The separate
[MCP review broker](ACTION-MCP-REVIEW.md) reuses this confirmation owner for each
selected tool call, borrowing the connection's revision binding without recapture.

## Exact private review

The owner captures a private revision binding for both selected files before
preparing the review. The preview shows the complete effective executable, cwd,
argument array and environment as JSON, including deterministic environment
defaults. JSON control escapes and explicit escapes for non-ASCII code units make
terminal control characters visible. The preview does not reconstruct a shell
command and does not shorten arguments or values.

The entire preview, including instructions, is limited to 16 KiB; larger actions
are refused instead of truncated. Review output must drain within one second.
A fresh eight-hexadecimal-character challenge requires the exact response
`RUN <challenge>` followed by one line ending. Other answers, additional lines,
more than 128 input bytes or expiry refuse execution. Review has a sixty-second
deadline in both the prompt and its owner.

The preview intentionally exposes private arguments and environment values on
the selected terminal. Scrollback, terminal recording and screen capture can
retain them. They are not included in stdout reports or application logs by this
feature. A TTY or PTY can be automated by an agent: this checks a local terminal
interaction, not an authenticated human identity.

## Permission and cancellation

Only an affirmative response creates the private grant. It is a frozen opaque
object, bound to the exact configuration capability, with a five-second monotonic
expiry and one launch attempt. Serialized copies, a different binding, expired,
revoked or already consumed grants cannot authorize execution. No grant is stored
on disk or sent to an MCP client.

The runner rereads the selected files after review and compares the same bytes it
uses for evaluation against the captured revisions. An observed change or read
failure revokes the binding; restoring files does not revive it. The runner checks
binding liveness again and consumes the grant immediately before spawn. A failed
spawn still consumes that attempt. Policy deny remains a hard refusal. Earlier
preparation failures do not consume a launch attempt, and the owner revokes both
grant and binding when it finishes.

Interrupt/termination signals, terminal EOF, terminal errors and owner
cancellation remain connected through execution cleanup. Before launch they
prevent a later allow from starting; after launch they request direct-child
termination on the ordinary route or Job cleanup on the Windows Job route.
Both wait for bounded confirmation. Already completed side effects cannot be
undone. Runtime, output and descendant limits remain those of the selected
[execution route](ACTION-EXECUTION.md).

An approved launch report has `decision: allow`,
`authorization: operator-confirmed` and the original `policyDecision` (`ask` or
`allow`). Exit status and termination evidence describe the direct child
separately. The report contains no grant, private revision digest or preview.

## Scope and verification

This route adds an explicit operator interaction for one selected action. It does
not provide reusable approval, task-wide authorization,
file/network isolation or authenticated human presence. Revision checks are not
continuous watchers and do not pin executable bytes, loaded libraries, scripts or
cwd contents. Allowed executables retain the caller's account privileges.

Focused tests exercise private review, exact-response rejection, expiry,
cancellation, revision changes and one-attempt enforcement. Runner tests also use
real harmless Node children. A native Windows PTY fixture exercised affirmative
ask confirmation, negative response, and Ctrl+C after child launch; the last case
reported confirmed direct-child termination and prevented its delayed marker.
These automated interactions do not establish human presence. Verification and
publication receipts belong to the implementation PR.

The combined Windows Job route also has native fixture tests for approved ask
and schema 3 review-required launches, refusal before a marker can be written,
descendant cleanup after normal completion and cancellation of both running
fixture processes. These tests substitute the terminal response at the existing
confirmation seam; they exercise the real policy, grant and native Job helper,
but do not establish a manual terminal interaction or installed-agent coverage.
For a full Windows test run from a clean source checkout, build the sidecars
first: other MCP suites need `build/sidecar/aegis-mcpjob.exe` and must not depend
on a different native suite happening to build it earlier in the run.
