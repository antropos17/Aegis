# Measured token accounting

Claude Code usage is read from the matching local session registry and transcript,
guarded by an observed process start time. Only usage numbers, message IDs and model
IDs are extracted; message content and transcript paths are excluded from diagnostics.
Subagent transcript usage is attributed to the main session process. Repeated message
IDs share one deduplication set across the main and subagent files.

Session registries above 64 KiB are unavailable to token accounting. Supported
registries use a bounded read with one extra byte to detect growth after the size
check; changing or unreadable metadata is retried on a later scan without resetting
the transcript cursor. Registry reads share the adapter's 4 MiB call budget.

Transcript reads request at most 64 KiB at a time, at most 1 MiB per file per call and
at most 4 MiB including registry reads across one adapter call. The first process
rotates between calls so a continuously busy prefix cannot monopolize that budget.
A backlog can take several scan ticks to drain;
the displayed measured subtotal can therefore lag recent agent activity. An incomplete
supported line waits for its newline and is decoded as one UTF-8 record.

Records above 512 KiB are discarded through their newline so later records remain
readable. Each such record emits the fixed `transcript-record-too-large` diagnostic
with a count, without a private path or content excerpt. Its usage is absent from the
measured subtotal. Unreadable or malformed sources also limit coverage. These figures
are observed usage, rather than a complete provider bill.

Dollar amounts remain estimates from a local rate table. For the existing known
Claude 4.x/Haiku model entries, cache reads cost 0.1 times ordinary input; cache
writes cost 1.25 times for five minutes and 2 times for one hour. The adapter keeps
the measured aggregate input count while passing these numeric categories through
both main and subagent transcripts. Duration fields must sum to the reported cache
write total. Missing or inconsistent durations use the five-minute rate and set a
sticky `pricingEstimated` flag; token counts remain measured. Unknown model IDs or
invalid categories use the existing estimated fallback, rather than applying these
multipliers to newer models with different rates.

Rates were checked on 2026-10-01 against [Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing)
and [prompt caching usage fields](https://platform.claude.com/docs/en/build-with-claude/prompt-caching).
The table does not refresh automatically. Billing endpoint, batch discounts and
other provider adjustments are not inferred from transcripts; these amounts are
local estimates rather than invoice totals.

Cost accounting retains every active process record, including the session exit
grace window, and 256 recently updated exited records. Older exited records are
folded into one explicitly archived row with no PID or process identity. The sums
of retained rows and this archive preserve all recorded input/output tokens and
estimated costs for the current application run, including sticky count/pricing
uncertainty. The archive is not attributed to current agents or included in their
rates. Individual archived process counters are no longer available through
per-instance lookup. Application restart still resets this in-memory accounting.

Each record retains at most 32 model labels, each at most 256 characters. Omitted
labels are explicitly flagged; all numeric usage and pricing still accumulate.
Compaction requires a confirmed current population/identity observation and freezes
during provider failures, missing birth-time witnesses, suspend gaps or a stopped
scan generation. Its bound scales with the live population plus recent history;
active processes are not dropped to enforce a fixed fleet-size cap.

The Claude Code adapter's session cursors, message-ID deduplication sets and
subagent-file maps remain retained for the application lifetime. They are separate
from the bounded cost history and IPC. Their retention, and long-duration native
qualification, remain tracked in [#637](https://github.com/antropos17/Aegis/issues/637).
Deleting those sets would allow resumed or rewritten transcripts to be counted
again; bounded transcript reads do not resolve this remaining memory limit.
