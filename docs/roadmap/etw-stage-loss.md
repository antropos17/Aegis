# B5 follow-up — separate collector stage losses

This records the v2 step. The [output-drain follow-up](etw-output-drain.md) extends
that protocol to v3 with mandatory output-cause measurements. The current v4 adds
[service measurements](etw-service-timings.md); this page preserves the v2 evidence.

Implemented on `codex/etw-stage-loss-counters` from `4a23c9c`, after the previous
live measurement could only report a combined application drop count.

## Contract and accounting

The diagnostic wire protocol is now `etw-file/2`. Both collector and JS reader
require two additional canonical uint64 strings in every telemetry `totals`:

| Counter | Meaning |
| --- | --- |
| `ingressDropped` | Raw inputs rejected by the ingress cap plus buffered inputs discarded at an ingress/decoder gap. |
| `outputDropped` | Mapped candidates rejected by the outbound cap, cleared during invalidation, or discarded when mapping/probe work overlaps invalidation. |
| `dropped` | Exactly `ingressDropped + outputDropped` in this snapshot. |

Decoder errors remain in `decoderErrors`; intentional filtering remains in
`filtered`. Native ETW counters and the main ring's `ringDropped` remain separate.
In particular, output drops do not necessarily indicate a slow writer: raw/native
loss can invalidate already mapped candidates. The existing caps and discard
policy are unchanged. Queue depth/high-water fields still report maxima across
the two separately capped stages, not a sum or individual stage depths.

The C# producer reads ingress totals once while holding the outbound lock and
derives all three drop fields from that snapshot. The JS schema rejects absent,
numeric, negative, noncanonical or overflowing counters, unknown fields and a
mismatched sum. Version 1 peers are rejected before capture authorization; missing
stage measurements are never filled with zero. Rebuild the diagnostic helper and
run it with the matching main code. The coverage profile remains
`home-26200-diagnostic-v1`; changing telemetry does not expand coverage or admit
attribution.

The growing schema moved out of the framing module into `etw-file-schema.js`.
Session validation, bounded decoding and the public protocol API remain in
`etw-file-protocol.js`; both files are covered by the JS coverage configuration.
The health reducer retains independent stage maxima and sticky loss/regression
flags. `lossCount` still counts only native EventsLost, preventing double counting.
The supervisor retains split values in `maxima` and `finalTotals` on exit. Failure
preserves the last available sample; only verified stop establishes final totals.
Independent maxima need not sum after a regressed sample; the exact-sum invariant
applies to each received snapshot. New sessions start without old evidence.

## Verification and live evidence

28 C# self-tests and 128 focused JS tests passed. Tests cover both queue caps,
buffered discard, in-flight invalidation, precise stage sums, uint64 values beyond
JS precision, legacy-peer rejection, regressions, failure retention and final
supervisor reports across restart. C# Release build and formatter passed.

The process verifier supports an explicit synthetic saturation mode:

```powershell
dotnet build sidecar/etw-file/EtwFile.csproj -c Release
& sidecar/etw-file/bin/Release/net10.0-windows/EtwFile.exe self-test
node scripts/verify-etw-file.mjs --report=X:/tmp/etw-stage-normal-new.json
node scripts/verify-etw-file.mjs --loss-check --report=X:/tmp/etw-stage-loss-new.json
```

`--loss-check` cannot be combined with `--live`. Its fixed normal-token
broker/collector mode queues 4,097 inputs before starting the mapper, then feeds
8,192 scoped reads in paced batches while output is unread. The original protocol,
supervisor and authenticated pipes carry actual C# totals into the report. In both
clean sessions the report retained 4,097 ingress drops and 6,270 output drops; the
third EOF case retained the measurements while refusing to certify stop. Native
counters remain null. This is deliberate synthetic saturation, not a throughput
benchmark. The ordinary three process cases also passed.

A subsequent authorized live check used the same apphost/assembly as both process
checks. The [evidence aggregate](../recon/evidence/etw-file-home-26200-stage-loss.json)
retains all three original reports, their hashes and 20 source hashes matched to
the checked implementation. On Windows 11 Home 25H2 / 26200.8655:

| Live observation | Result |
| --- | --- |
| Delivered / filtered | 57,927 / 57,597 |
| Ingress / output drops | 0 / 0 |
| Native event / realtime-buffer / log-buffer loss | 0 / 0 / 0 |
| Decoder errors / map conflicts / map resets | 0 / 0 / 321 |
| Main diagnostic ring evictions | 11 |
| Scoped fixture Read/header PID candidate | Observed |
| Out-of-scope path or non-null agent/instanceId | None observed |
| Owned stop / child exit / remaining helpers | Verified / 0 / 0 |

The lower ambient workload did not reproduce the earlier 463,125-event run, so
zero collector drops do not establish that burst loss is fixed. The bounded main
ring evicted 11 records separately. Health remains DEGRADED for experimental
mapping/identity evidence. There was no independent session-absence witness,
sleep/wake test or installed-app replacement. E3 remains open: next use a repeatable
burst workload and the split counters to reproduce and locate remaining losses.
