# Measured token accounting

Claude Code usage is read from the matching local session registry and transcript,
guarded by an observed process start time. Only usage numbers, message IDs and model
IDs are extracted; message content and transcript paths are excluded from diagnostics.
Subagent transcript usage is attributed to the main session process. Repeated message
IDs share one deduplication set across the main and subagent files.

Transcript reads request at most 64 KiB at a time, at most 1 MiB per file per call and
at most 4 MiB across one adapter call. A backlog can take several scan ticks to drain;
the displayed measured subtotal can therefore lag recent agent activity. An incomplete
supported line waits for its newline and is decoded as one UTF-8 record.

Records above 512 KiB are discarded through their newline so later records remain
readable. Each such record emits the fixed `transcript-record-too-large` diagnostic
with a count, without a private path or content excerpt. Its usage is absent from the
measured subtotal. Unreadable or malformed sources also limit coverage. These figures
are observed usage, rather than a complete provider bill.

Dollar amounts remain estimates from a local rate table. Cache read/write pricing
needs separate accounting work ([#636](https://github.com/antropos17/Aegis/issues/636)).
Session/message-state retention and retained cost-record growth remain tracked in
[#637](https://github.com/antropos17/Aegis/issues/637); bounded transcript reads do not
resolve those memory-retention limits.
