# aegis-procsnap — the process-snapshot sidecar

A ~10 KB Windows executable that answers one question — *what processes exist right
now, and when was each one born* — over stdio, in length-prefixed frames.

It exists to remove a measured tax. The scan loop needs one fresh observation of the
process table per non-empty enrichment pass; doing that through
`Get-CimInstance Win32_Process` costs **p50 1748 ms** on a 519-process machine. One
`NtQuerySystemInformation` call costs **p50 9 ms** on the same machine in the same
run. See `docs/bench/` for the full table.

## The wire is the contract

The language is a reversible implementation choice; the frame format is not. Anything
that speaks this protocol can replace this program without a line changing in AEGIS.

**Framing.** `uint32` little-endian payload length, then exactly that many bytes of
UTF-8 JSON. The length does not count itself. Maximum payload 8 MiB — a bound on what
a desynchronised stream can make the reader allocate, not a real frame size.

**Messages.** Every frame is a JSON object with a `t` discriminator.

| direction | frame |
|---|---|
| sidecar → client, once at startup | `{"t":"hello","proto":1,"caps":{"class":"class5","sequence":false,"topology":true},"pid":1234,"impl":"csharp-net48"}` |
| client → sidecar | `{"t":"snap","id":7}` |
| sidecar → client | `{"t":"snap","id":7,"source":"class5","procs":[…],"us":8123}` |
| sidecar → client | `{"t":"err","id":7,"code":"snapshot-failed","detail":"…"}` |

Each element of `procs` is `{"pid":1234,"ppid":42,"name":"claude.exe","ct":"133…"}`.

**`ct` and any future `seq` are decimal STRINGS, never JSON numbers.** Creation time
in 100 ns ticks runs around 1.3e17, past the 2^53 a JavaScript number holds exactly.
A witness that lost its low digits would compare *equal* across two generations —
which is the one failure the witness exists to prevent. `ct` is absent, rather than
zero, for a process the kernel reports without a creation time.

**Lifecycle.** The sidecar exits when stdin closes, so it cannot outlive its parent.
It answers requests one at a time, in order.

## What it queries, and what it refuses to guess

`NtQuerySystemInformation(SystemProcessInformation /* 5 */)`. One call, no per-process
handles — so the "`GetProcessTimes` is inaccessible for a large share of the process
table" problem does not arise. `STATUS_INFO_LENGTH_MISMATCH` is the normal
grow-the-buffer path and is branched separately from `STATUS_INVALID_INFO_CLASS` /
`STATUS_NOT_IMPLEMENTED`, which mean the capability is absent; conflating those two is
how a capability probe goes wrong.

**`SystemBasicProcessInformation` is not wired, and here is exactly why.** Microsoft
documents the class (available as of Windows 11 26100.4770) and the structure it
returns:

```c
typedef struct _SYSTEM_BASICPROCESS_INFORMATION {
    ULONG NextEntryOffset;
    HANDLE UniqueProcessId;
    HANDLE InheritedFromUniqueProcessId;
    ULONG64 SequenceNumber;
    UNICODE_STRING ImageName;
} SYSTEM_BASICPROCESS_INFORMATION;
```

Two findings from trying to use it, on Windows 11 26200.8655:

1. **It carries no `CreateTime`.** `startTime` — and therefore `instanceId` — is built
   from the creation time, so this class could never replace class 5; at best it would
   be a *second* call whose `SequenceNumber` is merged per pid.
2. **No primary source publishes its numeric enum value.** The MS Learn page names the
   class without a number, Geoff Chappell's table stops before it, and the one
   secondary source that offered a value (253) returns a 12-byte payload on this
   build — plainly some other class, caught by the validation rather than trusted.

Guessing kernel information-class numbers is not something this sidecar does, so the
`SequenceNumber` witness stays unwired until the value comes from a source that can be
checked. Nothing else waits on it: the client, the wire and the provider already
support an optional `seq` and prefer it when present, so enabling it later is a change
to this directory alone. The witness in the meantime is the creation time in 100 ns
ticks — ten thousand times finer than the epoch milliseconds it replaced.

## Struct offsets are validated, not assumed

MS Learn publishes `SYSTEM_PROCESS_INFORMATION` with a 48-byte `Reserved1` block that
hides `CreateTime`. `NtSnapshot.cs` reads the x64 layout of that block by offset, and
checks itself at startup against an independent oracle: our own record must be in the
snapshot, its `CreateTime` must equal `GetProcessTimes` on our own handle **exactly**,
its image name must be non-empty, and the `NextEntryOffset` chain must terminate
inside the returned length. If any check fails the process exits with status 2 and a
stderr line, and AEGIS falls back to CIM. It never emits numbers it cannot vouch for.

## Building

```
npm run build:sidecar    # → build/sidecar/aegis-procsnap.exe
```

Compiled by the C# compiler that ships inside Windows
(`%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe`, .NET Framework 4.8, both
inbox on Windows 10 1903+ and Windows 11). That is the point of the language choice:
nothing to install for whoever builds, nothing to install for whoever runs. The costs,
stated so they are not rediscovered mid-edit: a C# 5 era compiler — no string
interpolation, no `out var`, no tuples — and no `System.Text.Json`, which is why
`Json.cs` exists. `/platform:x64` is required, because the offsets are the 64-bit
layout.

The same three sources compile unchanged under `dotnet build` for `net48` or `net8.0`
if this ever needs to move; the wire would not notice.

Packaging is wired through electron-builder's `beforeBuild` hook
(`scripts/electron-builder-before-build.js`), and the binary is copied into
`resources/sidecar/` by `build.win.extraResources`. At run time the client resolves it
from `process.resourcesPath/sidecar/` when packaged and `build/sidecar/` in
development — both fixed paths, never `PATH`.
