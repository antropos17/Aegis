# Claude Code accounting at storage capacity

The durable deduplication database retains hashed session/message keys,
main/subagent cursors and accepted numeric totals across application runs.
Its production SQLite page limit remains 128 MiB. It does
not evict accepted IDs to make room: doing so could count an old message again
when a transcript is truncated, resumed or repeated in a subagent log.

Each process commits its new IDs and cursors before returning its measured
deltas. A storage failure rolls back that process; earlier successful processes
remain committed, and later processes can still contribute if they fit within
the available space. Main and subagent usage remain one atomic process batch.
The shared 4 MiB read budget and rotating first process remain in effect.

A failed SQLite operation or failed index initialization records
`storage-paused`, with only the fixed reason `capacity` or `unavailable` and the
next retry time. During the 30-second retry interval the adapter returns no new
deltas and does not reread transcripts or registries. A retry starts from the
last committed cursors. A process pause clears only after a scan visits every
supplied process without another storage failure and commits a process. A
successful startup-open retry can also clear the startup pause
when committed historical usage is restored, even with no live process. An
empty population or missing registry alone does not establish process recovery.

The existing `token-costs` push now carries `{records, collection}`. Records are
the retained measured totals; collection contains independent adapter health.
Both the Observatory host and retained renderer store accept the earlier array
payload for preview and compatibility. No preload capability or channel is
added. Status contains no transcript content, source path, session ID, message
ID, or raw error. Observatory's Usage by agent panel marks paused Claude Code
totals as incomplete in English and Portuguese.

Statistics retain those totals while recording an unavailable token arrival
rate for scopes containing Claude Code during the pause. The first successful
recovery delivery establishes a new baseline and has no rate. Subsequent bounded
catch-up deliveries use the existing delivery-based rate and may still reflect
backlog rather than the provider's execution timing. Other metric sources and
unrelated agent scopes continue to update.

At the permanent page cap, retries can remain paused for the rest of the run.
The application does not grow the limit, remove deduplication evidence, reset
cursors, or estimate the backlog. Automatic recovery requires an actual
successful storage operation; a transient storage outage can recover, while a
permanently exhausted index still requires a different future retention/storage
design. Committed state and accepted totals persist across application runs;
prior usage is restored as historical without a live PID. An interrupted
transaction is recovered automatically only when its rollback journal matches
the ledger ownership witness.

## Focused evidence

`tests/main/token-storage-pause.test.js` uses real SQLite files with a reduced
64 KiB page limit, exercising the same `max_page_count` mechanism without a
large disk fixture. It checks permanent `SQLITE_FULL`, preserved committed
IDs/cursors, 3,000 cooldown calls without further source reads, another failed
retry, commits before and after a failing process, temporary capacity recovery,
shared main/subagent deduplication, oldest-message replay, and initialization
failure with no private error in the status. Recovery frees only a test-only
padding table; it never deletes accepted IDs.

Host/component tests check retained totals, the pause notice, Portuguese copy,
recovery and earlier array deliveries. These deterministic tests establish the
failure and recovery behavior. They do not establish an hours-long production
soak, packaged Electron behavior, physical-device layout or memory bounds of
the Node/SQLite runtime.
