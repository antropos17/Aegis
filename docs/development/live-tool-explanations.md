# Live local tool explanations

Open a retained file observation in Observatory and choose **Explain from local
history** under **Preceding tool call**. The main process resolves the event ID;
the renderer cannot supply a transcript path, PID, working directory or event
timestamp. Results are displayed separately from the original audit evidence.
This operation reads local metadata and does not run an agent or contact a model.

The first supported source is the native local Claude Code main session. The
application selects `.claude/sessions/<observed-pid>.json` under its user's home,
then the corresponding `projects/<encoded-cwd>/<session-id>.jsonl`. Other
providers, alternate homes, WSL, subagents and remote histories remain outside
this integration. A healthy current process snapshot, exact instance key,
matching observed working directory and registry startup within that process's
lifetime are prerequisites. A session shared by monitored instances is rejected.
The process snapshot and selected registry are checked again after reading.

The registry is agent-reported metadata, not independent OS ownership proof.
Live results therefore remain **inferred**, even with an exact object match.
They explicitly record `clock-skew-assumed-local`: timestamps are compared in
the native host's UTC time domain, without claiming a measured skew. The existing
measured-skew path remains available to independently qualified callers; the new
assumption path cannot produce a confirmed association. Missing tool end times
use a five-second window. Time overlap without a matching object stays unattributed.

Reads use bounded ordinary same-user filesystem observations. They reject linked
paths/hard links, oversized registries, changing files and incomplete IO. This
does not establish the separate native Windows reader's reparse/loader custody
guarantee or protect against an adversary controlling the same account. That
reader and its qualification remain unchanged. A concurrent transcript writer may
make a request unavailable; there is no hidden retry or new guest provisioning.

The service retains at most 256 accepted event selections, expires them after 15
minutes and removes expired entries on the next service activity. Each
request selects at most 32 registry files of 64 KiB (the selected registry is
checked twice) and one 512 KiB transcript tail;
there is one read operation in flight and at most one new operation per second.
The UI receives an unavailable result after three seconds. Pending filesystem IO
may outlive that response, but occupies the single slot until it finishes and
closes its handles. Monitoring is never held behind this on-demand read.

Only the closed tool-context projection crosses IPC: fixed reasons, tool names,
structural argument categories and per-process keyed digests. Prompts, response
text and raw argument values are neither returned nor logged. Owned buffers are
cleared after parsing; this is not secure erasure of JavaScript strings or OS caches.
An incomplete tail stays partial. Unknown, expired or restarted-process selections
return an explicit unavailable result without modifying the observed event.

W4.2's application path is distinct from W4.3 association qualification and W4.4
the installed genuine-agent end-to-end acceptance. Fixtures and an Electron
integration journey must be reported as such; they do not qualify native reads,
all providers, measured clock alignment or independently confirmed session ownership.

Run the focused application journey with
`node frontend/observatory/tests/live-tool-context-electron.mjs` after building
the renderer and ordinary platform sidecars. It uses disposable source/profile
fixtures, a synthetic observed process and file event, then activates the real
DOM handler through the real preload bridge. It awaits the batched event before
entering the reading surface, whose retained snapshot deliberately holds later
arrivals. Native pointer delivery and compositor screenshots are outside this
journey; use the browser interaction/layout suite for those UI checks. Its
metadata-only result and original audit are checked for raw-content disclosure.
