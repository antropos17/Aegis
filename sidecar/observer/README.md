# Windows observer transport

`aegis-observer.exe` performs one observation and exits. The inbox C# compiler
builds it through `npm run build:sidecar`; the existing Windows packaging hook
includes it under resources/sidecar. No service, additional runtime or privilege
elevation is required. The executable is resolved only from packaged resources
or this checkout's build directory, never PATH.

Modes `tcp`, `cwd` and `holders` select the same MSFT_NetTCPConnection,
Win32_Process and Restart Manager APIs used by the PowerShell fallback. The build
compiles the exact `rm-csharp.js` wrapper into the helper, avoiding a second copy.
Restart Manager sessions remain sequential and close in its existing finally
block. These are held-handle snapshots; short open/read/close activity can be
missed. RM's existing empty-on-native-error behavior is preserved.

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
