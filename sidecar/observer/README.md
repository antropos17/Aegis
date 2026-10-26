# Windows observer transport

`aegis-observer.exe` performs one observation and exits. The inbox C# compiler
builds it through `npm run build:sidecar`; the existing Windows packaging hook
includes it under resources/sidecar. No service, additional runtime or privilege
elevation is required. The executable is resolved only from packaged resources
or this checkout's build directory, never PATH.

Modes `tcp`, `cwd` and `holders` select the same MSFT_NetTCPConnection,
Win32_Process and Restart Manager APIs used by the PowerShell fallback. The build
compiles the exact `rm-csharp.js` wrapper into the helper, avoiding a second copy.
The `rm-probe` startup mode accepts an empty object and actually opens and closes
a Restart Manager session. Its validated success enables the same native holder
path even when PowerShell is unavailable. Failed or missing helpers use a
PowerShell probe of that same session lifecycle. Neither probe emits file events.
Restart Manager sessions remain sequential and close in its existing finally
block. These are held-handle snapshots; short open/read/close activity can be
missed. Failed observations remain failures rather than successful empty snapshots.

Input JSON goes through stdin. Only the mode appears in arguments. The helper
never opens file contents or writes diagnostic files. TCP returns the six CIM
fields; CWD returns PID/CommandLine for immediate extraction by the existing
parser; holders return group indices and PIDs, with labels attached by the parent.
The UTF-8 response is `{version:1,rows:[...]}`. Errors exit nonzero without OS
exception text. No values are cached, and an empty successful observation remains
empty. Unknown TCP state numbers and the existing literal exclusions are retained.

The parent limits stdin to 512 KiB and stdout to 2 MiB, with 5-second TCP/CWD and
10-second holder timeouts. Native input also has a 524,288-character limit,
2,048-PID/group limits and 64 paths per holder group; TCP output has a 16,384-row
limit. Oversized input, missing binaries, protocol errors, timeouts or invalid
rows use the existing PowerShell query. A failed helper attempt can add its timeout
before fallback; a per-mode 60-second cooldown prevents repeated attempts during
that window. Fallback itself retains its existing timeout and error contract.

`AEGIS_OBSERVER_PROVIDER=powershell` selects fallback at application startup.
PowerShell CWD/RM output now explicitly uses UTF-8; the former output replaced
some non-ASCII characters with `?`. Collection intervals, attribution, per-instance
CWD caching, DNS validation and file-event deduplication are unchanged.

Run `node bench/observer-compare.cjs` on Windows for the disposable socket,
held-file and command-line comparison. Unit/integration tests inject transports
and cover missing/invalid helpers, recovery, scope validation and fallback.
Linux CI does not execute the Windows binary.

`claude-session` is an additional read-only Windows x64 mode with at most 32 PIDs.
It holds query/read/synchronize process handles and rejects exited, inaccessible,
WOW64 and non-`claude.exe` processes. For native Claude it returns only PID,
full-resolution creation ticks, current directory and a unique explicit session
selector parsed with `CommandLineToArgvW`. Raw argv never crosses stdout.
The x64 PEB/process-parameter layouts are version-dependent; failed reads return
no evidence. The host must compare fresh observations before and after source IO;
there is no PowerShell fallback for confirmation. This is process/session
association evidence, not executable-publisher authentication or protection from
same-account tampering. The layout was exercised on Windows 11 build 26200 with
Claude Code 2.1.292. `tests/ClaudeSessionTests.cs` covers native argv boundaries
and rejection of a real non-Claude process without provider calls.
Each native observation also enumerates current `claude` PIDs and refuses evidence
when they differ from the requested population; a stale app scan cannot silently
exclude a newly started second process.
