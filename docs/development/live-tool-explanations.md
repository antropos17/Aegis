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
The process snapshot and the selected and observed peer registries are checked
again after reading. These are bounded observations, not an atomic snapshot;
a change that is reversed between reads may go undetected.

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
paths/hard links, oversized or changing registries and incomplete IO. A growing
transcript can provide a partial snapshot only when its file identity is unchanged,
its observed sizes do not shrink and a second read of the selected byte window is
identical. Replacement, changed selected bytes or observed shrinking make the source
unavailable. Incomplete trailing JSONL bytes are discarded before UTF-8 decoding;
complete records retain their normal validation. This
does not establish the separate native Windows reader's reparse/loader custody
guarantee or protect against an adversary controlling the same account. That
reader and its qualification remain unchanged. The verified prefix still carries
partial-source uncertainty; it establishes no append-only or tamper-resistance
guarantee. There is no hidden retry or new guest provisioning.

The service retains at most 256 accepted event selections, expires them after 15
minutes and removes expired entries on the next service activity. Each
request selects at most 32 registry files of 64 KiB and reads each at most twice,
for at most 64 metadata reads. The request has a three-second deadline. The existing
512 KiB total transcript read budget reserves up to
256 KiB for the selected tail and 256 KiB for its verification if growth is observed;
an unchanged file requires only the first pass.
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
By default it preserves the configured model, permits only Read for the per-run
task and sets the CLI budget to USD 0.50. Hooks are supplied through task-local settings;
personal settings and hooks are not edited. The production scanner discovers the
real process. The case then checks the native binding, actual transcript and
preload/UI explanation. Its selected OS observation is explicitly synthetic;
this case does not qualify the native file-read sensor. Outputs are private
diagnostics: review closed disposable logs after seven days and retain receipts.

Setting `AEGIS_CLAUDE_QUALIFICATION_MODE=write` selects the existing runner's
real-write journey. It creates a fresh owned project below the source checkout's
ignored `out/development/` watch root and permits only one Claude Write there.
The runner awaits the real watcher event, compares the actual output bytes,
checks its retained audit entry, and selects the actual event UUID in Details.
It never injects a file observation in this mode. A unique path-based candidate
remains inferred; its coherent current process witness can support confirmation
of that candidate's session binding, not confirmation of the OS write issuer.
Multiple candidates at the selected path heuristic produce an unattributed
observation with `ambiguous-owner-match`, without a selected process or history
join. A missing or contradictory full witness preserves existing inferred
attribution and cannot establish confirmed session binding. On Windows, the existing
native CWD query returns the actual bounded x64 process directory and birth from
one held process handle. Its version-2 response rejects the older command-line
guess format; unsupported or inaccessible native observations remain unavailable.

The local Windows qualification on 2026-10-26 at `2536bf8e` passed with installed
Claude Code 2.1.292 and the configured Opus model. One genuine Write produced a
real FileWatcher `created` event, a matching persisted audit record and an
explanation selected by that event's UUID in Details. Independent output bytes
and the genuine tool result matched; the original audit record retained its exact
sequence, hash and full row after explanation. All six recorded stages passed,
and both Claude and Electron exited with code 0. This confirms the selected
process-to-session binding while path attribution and tool association remain
inferred. It establishes neither the OS write issuer nor native read-sensor
acceptance, measured clock alignment, other providers or general sensor completeness.

The optional `AEGIS_CLAUDE_QUALIFICATION_SCENARIO=instances-restart` with Write mode
prepares a separate instance-isolation case in an external owned project. Before
app startup the production selection owner seeds only the disposable profile
using a scripted fixture dialog/guard; this does not establish native owner
consent. Normal startup must restore that selection, report public `SELECTED`,
and ready its project watcher under the exact owned user-data directory before
any model release. A second Claude in a disjoint owned directory remains at
SessionStart while only the primary performs one Write.
After that proof the peer is terminated and the primary finishes normally. A
replacement resumes the primary history under fresh, unreleased startup settings;
the existing event UUID must then yield no borrowed candidate through both IPC
and a new Details request, while original audit rows stay preserved. Peer history
is never read. Each held side process has a 60-second owner deadline before the
hook's 90-second automatic return; uncertainty cancels the owned scenario without
releasing side barriers or retrying termination. This scenario has local lifecycle
and rendered-state controls.

The local Windows scenario on 2026-10-26 at `1a235a15` passed with installed
Claude Code 2.1.292 and the configured Opus model. The actual app restored the
scripted disposable-profile selection and reported its external project watcher
ready. Two same-name processes had distinct observed generations and directories;
only the primary was released to perform the genuine Write. Its real watcher
event reached the retained audit and event-specific Details explanation with
confirmed process-to-session binding and inferred attribution and association.
After the peer was retired and the primary exited normally, a held replacement
resumed the primary history under a new observed generation. Fresh IPC and Details
requests for the original event UUID returned unavailable without borrowed tool
candidates, while the original audit rows retained their exact sequence, hash and
contents. All eight instance stages and six Write stages passed; both held side
processes were terminated before their hook deadlines, and owned cleanup was
confirmed. Peer history was not read. This qualifies the selected local external
project and restart case; scripted selection does not establish native owner
consent, and the result makes no native read-sensor, measured-clock or packaged
installation claim.
