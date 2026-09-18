# One-attempt terminal confirmation (B1)

`--action-exec-confirm <policy.json> <request.json>` lets an operator review one
exact action before AEGIS-owned direct execution. It uses the schema 2 policy and
schema 1 request from [ACTION-EXECUTION.md](ACTION-EXECUTION.md). Both `ask` and
`allow` require an affirmative terminal response on this route. Policy `deny`
cannot be overridden.

```sh
node src/main/main.js --action-exec-confirm /absolute/policy.json /absolute/request.json
```

Standard input and standard error must both be live TTY streams. Piped input,
redirected review output and missing terminals refuse execution. Standard output
contains only the redacted execution report. The standalone JSON CLI and MCP
tool retain their existing behavior; MCP does not acquire an approval prompt
from this addition.

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
termination and wait for the existing bounded confirmation. Already completed
side effects cannot be undone. Runtime, output and descendant limits remain those
of the [direct-execution contract](ACTION-EXECUTION.md).

An approved launch report has `decision: allow`,
`authorization: operator-confirmed` and the original `policyDecision` (`ask` or
`allow`). Exit status and termination evidence describe the direct child
separately. The report contains no grant, private revision digest or preview.

## Scope and verification

This route adds an explicit operator interaction for one selected action. It does
not provide an MCP approval bridge, reusable approval, task-wide authorization,
process-tree isolation or authenticated human presence. Revision checks are not
continuous watchers and do not pin executable bytes, loaded libraries, scripts or
cwd contents. Allowed executables retain the caller's account privileges.

Focused tests exercise private review, exact-response rejection, expiry,
cancellation, revision changes and one-attempt enforcement. Runner tests also use
real harmless Node children. A native Windows PTY fixture exercised affirmative
ask confirmation, negative response, and Ctrl+C after child launch; the last case
reported confirmed direct-child termination and prevented its delayed marker.
These automated interactions do not establish human presence. Verification and
publication receipts belong to the implementation PR.
