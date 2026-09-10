# B5 follow-up — keep slow output work off the ETW mapper

Implemented 2026-09-11 from `8b16692`. The connected diagnostic backend's mapper
previously performed fresh process-handle queries and JSON serialization before
returning to its bounded input queue. A slow query therefore prevented it from
processing subsequent reads and naming/lifecycle events.

`FilePipeline.Take()` now performs the process observation on the collector's
single output reader, after removing one candidate from the queue and releasing
the map lock. The mapper does no native process queries or JSON serialization.
It estimates retained output with 2,048 bytes per record plus UTF-16 path storage;
the existing 4,096-record / 4 MiB caps remain. Serialization remains in the bounded
collector/wire writer. Changing this conservative storage estimate can change the
number of records admitted before the byte cap, especially for long paths.

The reader retains the 100-per-second probe budget. Every probe observes a fresh
handle at delivery time; no creation time is cached, and agent/instanceId remain
null. This later interval is still candidate evidence. An invalidation counter
prevents an observation whose probe overlapped an ingress/native loss from escaping;
that in-flight discard increments output loss. Ordinary mapping lifecycle resets
do not retroactively discard earlier queued reads.

## Verification

The new blocked-probe regression failed against the original mapper with only a
probe injection seam added, after the original 22 self-tests passed. Moving the
probe to the output reader made it pass. It holds one probe while delivering
32 batches of 256 further reads, waiting for ingress drain between batches.
The mapper finishes these 8,192 reads and a subsequent Close with zero ingress
drops; an intentionally unread output queue fills and counts its own drops.
This is a controlled interleaving test, not an unpaced throughput benchmark.

All 27 C# self-tests pass. Added cases cover probe timing/budget without cached
witnesses, native and decoder invalidation during a held probe with exact total
accounting, and output byte limits with 32,711-character selected paths. Release
build and `dotnet format --verify-no-changes --no-restore` pass. The normal-token
process check passes two clean sessions and parent EOF with unverified cleanup;
native counters remain null. Its report is
`X:/tmp/aegis-etw-burst-process-20260911.json` (local, synthetic). The 110 focused
JS protocol/health/supervisor/main-composer tests pass.

Run the checks from the repository root:

```powershell
dotnet build sidecar/etw-file/EtwFile.csproj -c Release
& sidecar/etw-file/bin/Release/net10.0-windows/EtwFile.exe self-test
node scripts/verify-etw-file.mjs --report=X:/tmp/etw-burst-process-new.json
```

The repository's five CI contexts do not build this .NET project. The local C#
results above are separate evidence. No elevated capture or sleep/wake was run
for this follow-up, and the installed application was not replaced.

## Next evidence

The earlier live result of 12,061 application drops among 88,772 inputs remains
historical evidence. This change establishes that a slow process probe cannot
hold up lifecycle mapping; it does not establish the cause of every earlier drop
or quantify native burst improvement. A new agreed live check should retain
delivered/filtered/dropped totals, native counters, scoped candidate evidence and
verified stop before making a new loss claim. E3 remains open along with B1's
coverage questions, E4/E5 identity admission and collector-crash recovery.
