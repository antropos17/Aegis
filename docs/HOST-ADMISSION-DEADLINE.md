# Host caller admission deadline

The existing host caller admission now carries one monotonic decision budget from the outer `Accept(int milliseconds)` entry through gate acquisition, pipe connection, complete frame, native authentication and final context publication. The accepted range remains 1–2,000 ms. A connected silent caller no longer receives a new fixed two-second reader wait after the supplied endpoint budget. Delayed connection and delayed frame share the same remaining time.

`CallerAdmissionBudget` lives beside `CallerRegistration` so existing explicit native source inventories remain sufficient. It supplies bounded polling, expiry checks and owned `Monitor.TryEnter` leases. Each lease exits exactly its own acquisition, including reentrant acquisition when server, main and bootstrap composition share the same gate. A contender that cannot acquire its outer owner gate throws `TimeoutException` before consuming or closing the operation held by another call.

The same typed object reaches admission-aware overloads on the endpoint, reader, enrollment lease, main proof, fixed inspection registration and installed owner guard. Enrollment association prechecks release the lease gate before taking the server gate. Server-to-lease order and the sequential enrollment, child and endpoint checks remain intact. No raw synchronization object, imported deadline DTO, authority callback, runtime factory or source-list change is added.

Authentication preserves its impersonation/reversion `finally` path. Expiry observed while impersonating cannot skip token disposal or reversion. Failed reversion keeps the existing refusal and cleanup behavior. Final live-peer, original proof/selection, empty-pipe and unimpersonated checks still run before publication; a final budget check withholds the locally constructed context if the decision deadline has expired.

Returned contexts retain their separate existing two-second freshness lease, starting at native admission. The admission budget is not stored in a returned context and does not renew that freshness. Terminal inspection completion keeps its existing retained-peer and original supervisor-deadline checks; no new dispatch or renewal authority follows from this budget.

## Timing and cleanup limits

The budget limits admission eligibility and intentional admission polling/gate waits. Synchronous native identity, file, service and Job observations cannot be preempted by a stopwatch. OS scheduling can also delay execution after the last check. The final publication check is the decision boundary; this code makes no unconditional hard wall-clock return guarantee.

Mandatory owned cleanup is outside the decision budget. An attempt that owns a pipe or child still performs the original close/stop and retains cleanup uncertainty on failure, even after expiry. Cleanup may reacquire enrollment, endpoint, child or registration gates and may wait for process/Job settlement. It is not abandoned on a background thread. This differs from an unowned outer gate contender, which has no cleanup ownership and leaves the other operation untouched.

Legacy observation overloads preserve their blocking synchronization and existing local observation limits. Their admission-aware counterparts use the original shared decision budget. A borrowed enrollment lease is not revoked merely because an admission decision expires; independently failed authority observations keep their original refusal behavior.

The change covers the existing host `inspect-owned` path. It does not implement guest stop/revoke, enroll the GUI, activate an installed runtime/provider, or change A1–A4 or `launchAllowed`. Real pipe, expiry, contention, authentication/reversion and publication controls are separate from any broader native or end-to-end qualification.
