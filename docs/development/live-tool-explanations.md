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
matching working directory and registry startup within that process's
lifetime are prerequisites. A session shared by monitored instances is rejected.
The process snapshot and selected registry are checked again after reading.

The registry alone is agent-reported metadata. On Windows x64, the ordinary
observer helper can independently inspect a live native `claude.exe` through a
retained process handle. It reads the full-resolution process birth, native
current directory and an explicit `--session-id <UUID>` or `--resume <UUID>`
selector. It projects those fields inside the helper; raw command lines never
leave it. Both observations surrounding the transcript read must agree with the
current OS-stamped process population and selected registry. Missing peers,
duplicate sessions, changed generations/directories/selectors and incomplete
sources prevent confirmation. The retained event's full-resolution birth witness must match
the current process. A missing event witness permits inferred context only; a
different witness rejects the join even when PID and birth millisecond coincide.
The source spelling is used for lexical digests
only after the native directory comparison, so a trailing directory separator
cannot manufacture a mismatch. The same-user observation does not authenticate
the executable publisher or establish resistance to same-account tampering.

That path can report **confirmed session binding** independently of the tool's
temporal association. Ordinary launches without an explicit selector, unavailable
native evidence and other supported metadata-only cases remain inferred.
Tool association still remains **inferred**, even with an exact object match.
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
all providers or measured clock alignment. The genuine-Claude journey below
additionally checks independently observed ownership for its selected native case.

Run the focused application journey with
`node frontend/observatory/tests/live-tool-context-electron.mjs` after building
the renderer and ordinary platform sidecars. It uses disposable source/profile
fixtures, a synthetic observed process and file event, then activates the real
DOM handler through the real preload bridge. It awaits the batched event before
entering the reading surface, whose retained snapshot deliberately holds later
arrivals. Native pointer delivery and compositor screenshots are outside this
journey; use the browser interaction/layout suite for those UI checks. Its
metadata-only result and original audit are checked for raw-content disclosure.

`node scripts/qualification/live-tool-context-claude.cjs` runs one genuine installed
Claude Code session on Windows with a disposable project and Electron profile.
It preserves the configured model, allows only Read for the per-run task and caps
the provider budget at USD 0.50. Hooks are supplied through task-local settings;
personal settings and hooks are not edited. The production scanner discovers the
real process. The case then checks the native binding, actual transcript and
preload/UI explanation. Its selected OS observation is explicitly synthetic;
this case does not qualify the native file-read sensor. Outputs are private
diagnostics: review closed disposable logs after seven days and retain receipts.
