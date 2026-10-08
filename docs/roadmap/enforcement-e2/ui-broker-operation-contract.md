# Protected Session UI and broker operation contract

Status: implementation contract for E1.1. This document specifies the missing UI
edge of the [supervisor design](supervisor-caller-inventory-design-20260930.md).
It does not add an IPC handler, enable the inactive helper or qualify E1.2–E1.5.
The existing native `probe`/`prepare` v1 codec continues to return unavailable.

## Sender and operator binding

The future main-process adapter accepts requests only from its currently owned,
live application BrowserWindow. Require object equality with its `webContents`,
equality of `event.senderFrame` with that window's current `mainFrame`, an attached
frame, and the exact configured production document URL with only its fragment
removed. Preview, child frames, another window, detached frames and navigation to
another document fail. A URL match alone never establishes ownership. Reuse the
ownership/revision pattern in `src/main/local-security-ipc.js`; do not broaden that
handler or its existing review operations.

Main retains a per-window document generation. Navigation, reload, destruction,
replacement or operator logout invalidates its references and outstanding UI
requests. Recheck the same window/frame/generation after every asynchronous
validation and immediately before sending an operation. A timeout or invalidation
after submission is an unknown outcome; it is never an automatic second request.

Main is a UI adapter and supplies no privileged operator or resource identity.
The supervisor's trusted registration binds a held broker instance and the held
main-process instance to the authorized operator's observed SID, logon LUID and
Windows session. This binding comes from authenticated provisioning/registration
and OS process/token observations, never a renderer field. Broker registration
contains the allowed inventory records and operations for that operator. Changing
the operator, either held process, its birth identity or registration generation
invalidates the binding.

The main-to-broker local pipe uses the same held-peer, per-frame token checks,
first-instance endpoint ownership, remote rejection, server authentication and
revert-on-failure contract as broker-to-supervisor. The broker verifies the
registered main process; main verifies its registered broker. Merely knowing a
pipe name, request ID or user SID grants no admission. Native provisioning and
both-direction transport tests remain implementation prerequisites.

After authenticated registration, the broker may expose at most eight
operator-authorized session descriptors within one bounded registration response.
It derives them from supervisor-owned inventory. Main issues a fresh opaque
32-hex `viewRef` for each descriptor and maps it privately to that registration,
operator, inventory revision, session/VM epoch and current document generation.
Only the admitted frame receives those references. They are selection handles;
the broker independently checks ownership and policy on every operation.

## Exact requests and operation mapping

One future preload method, `requestProtectedSession`, invokes the future
`protected-session-request` channel. It accepts only a plain record serialized
to at most 512 UTF-8 bytes: `version: 1`, `requestId` (32 lowercase hex), `action`
(the table below), and `viewRef` (32 lowercase hex). `query-operation` additionally
requires one 32-hex `operationRef`; every other action rejects that field.
Unknown fields, prototypes, getters, noncanonical values and missing fields fail.
No paths, commands, URLs, VM IDs, PIDs, policy choices, raw results, credentials or
capabilities are accepted from the renderer.

Main maps `viewRef` through its retained generation. Broker and supervisor derive
the native session reference, registration, inventory/policy revision, VM/epoch,
sequence and operation ID themselves. The UI request ID is only a deduplication
key inside the admitted document generation. An identical repeat returns its
existing result/reference; changed arguments under that ID fail. Main maps
`operationRef` only to a previously submitted operation for that same view and
generation. An operation reference from another view/window/operator fails.

| UI action / supervisor operation | Additional privileged arguments | Allowed phase and effect |
| --- | --- | --- |
| `inspect-owned` | None beyond the retained binding | Any retained owned phase. Query observations without mutation; retain unavailable/unknown fields explicitly. |
| `prepare-owned` | Registered fixed fixture ID, chosen by broker policy | `owned-off` with valid registration, current approved configuration and no pending operation. Prepare only that pre-registered disposable resource; no arbitrary provisioning. |
| `release-fixed-fixture` | Broker-selected fixed fixture identity and current approved policy binding | `ready` with independently observed initialized runtime/token/Job, current inventory and no unresolved operation. One release per epoch after the supervisor's final fence. No project commands arrive from UI. |
| `stop-owned` | None beyond the retained binding | `preparing`, `ready`, `running`, `stopping` or `cleanup-unknown`. Immediately prevent further release. If another management mutation is unresolved, retain stop intent and reconcile it before dispatching a conflicting stop. Already confirmed `owned-off` returns the recorded observation. |
| `query-operation` | Supervisor-issued operation ID resolved from `operationRef` | Any phase for an operation retained under the same registration/session binding. Observe or reconcile its outcome; never redispatch its effect. |
| `revoke-session` | None beyond the retained binding | Any admitted phase. Revoke capabilities and future admission under the same supervisor lock as dispatch. Retain owned cleanup independently of the UI connection. Repeated revocation returns the recorded state. |

The broker checks the operation allowlist, current lease and policy; the
supervisor repeats authorization and the protected inventory/pre-mutation fence
from the supervisor design. Per-session management mutations serialize. Main
admits one ordinary pending mutation and one status query per view; repeated
clicks reuse the same pending reference. A separate reserved control slot permits
`stop-owned` or `revoke-session` to invalidate admission immediately and record
one idempotent owner-side stop/revocation intent even while prepare/release is
pending. Repeated control requests join that intent; revoke upgrades its admission
state without allocating another queued effect. This slot remains available when
the ordinary history is full. It never dispatches a conflicting VM mutation until
the preceding operation settles. There is no unbounded command queue. Ordinary
terminal operation summaries are capped at 128 per registration; exhaustion
refuses new ordinary mutations and requires an explicit fresh registration,
without discarding pending work or blocking revocation and owned cleanup.

## Responses, revocation and failure

Return at most 4096 UTF-8 bytes with exactly `version`, `requestId`, `viewRef`,
`operationRef` (null before submission), `state`, `reason` and `observed`.
`state` is `unavailable`, `denied`, `pending`, `ready`, `running`, `owned-off`,
`revoked` or `cleanup-unknown`. `reason` is a fixed code: `none`,
`caller-unavailable`, `binding-stale`, `phase-refused`, `policy-refused`,
`observation-unavailable`, `operation-pending`, `capacity-exceeded` or
`cleanup-unconfirmed`. No exception message or arbitrary guest string crosses
this response boundary.

`observed` has exactly `sourceRevision`, `inventoryRevision`, `vmOff`,
`guestJobClosed` and `taskPassed`; each unavailable value is null. Source revision
is a verified 40-hex commit or null; inventory revision is a nonnegative safe
integer or null; the final three values are booleans or null. Broker-issued
operation references are rewrapped for this document generation. No token,
credential, host path, guest result body or grant is returned. These responses
are display data; echoing or editing one cannot issue authority.

Frame loss, pipe loss or timeout revokes new UI admission and requests owner-side
revocation. Supervisor cleanup continues only against independently retained
owned resources. `owned-off` requires current independent VM-off observation;
`guestJobClosed` is reported separately and cannot be inferred from a stopped
message or later VM removal. Unknown mutation/cleanup prevents release, export,
credentials and reuse. Renderer disappearance never terminates ownership tracking.

## Implementation acceptance cases

Verify another frame/window with the same URL, stale document generations,
foreign or guessed view/operation references, substituted operator/session
fields, same-SID unregistered pipe peers, replaced broker/server and replayed
registration. Each must leave an independent effect counter unchanged. Exercise
all operation/phase pairs, repeated-click deduplication, changed-request replay,
capacity exhaustion, revoke racing release, disconnect after dispatch, delayed
management completion and unknown cleanup. Positive controls must traverse the
actual registered sender and operator binding. UI tests alone do not establish
native peer authentication or protected inventory ownership.
