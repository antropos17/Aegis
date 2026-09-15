# Windows resource transport — 2026-09-15

This change reads the existing formatted WMI CPU/RAM counters through a small
inbox-.NET helper. The old PowerShell transport remains the failure fallback.
The query class, PID filter, CPU normalization, working-set conversion, GPU
collection, per-instance cache and scheduling are preserved. See the
[provider contract](../../sidecar/resources/README.md).

Six alternating pairs per scenario compared both transports on the same Windows
machine and target process. The order reversed in each pair. These are elapsed
collection times including process startup, not CPU consumption:

| Target | Helper median | PowerShell median |
| --- | --- | --- |
| Idle diagnostic Node process | 489.79 ms | 1,293.29 ms |
| One busy child with a 64 MiB allocation | 483.23 ms | 1,304.21 ms |

Every successful helper-labelled sample recorded an actual `aegis-resources.exe`
launch and no PowerShell fallback. The loaded process had nonzero formatted CPU
readings from both providers (helper 87–98, PowerShell 91–100, before division by
logical core count). Both observed working sets around 119 MB in bytes. These
sequential observations cover different counter windows and are not expected to
be numerically identical. The child was terminated after the bounded comparison.

An initial helper attempt failed before this paired comparison and fell back;
its cause was not established. A later direct helper invocation completed in
511 ms. The paired medians describe warmed executions, not guaranteed cold-start
latency. The automatic timeout, fallback and retry cooldown are covered by tests.

A subsequent real Electron capture lasted 180 seconds, minimized with a separate
profile, no ETW opt-in and no UAC. Its first 90 seconds were excluded from the
steady window. That window completed nine process ticks and nine resource
collections: nine resource-helper launches, zero CPU/RAM PowerShell launches,
and the existing nine NVIDIA queries. Resource-collection median was 581.32 ms,
maximum 608.66 ms. Startup resource collection reached 2,263.86 ms (including
GPU probing); this is retained in the numeric report. Other Windows collectors
continue to use PowerShell.

The earlier [live profile](live-cycle-profile-2026-09-15.md) observed a 1,948.63 ms
resource median, but that run had different live load and population. It is not
the controlled comparator for this patch; the alternating pairs above provide
the transport comparison. No claim is made about total application CPU reduction,
foreground responsiveness, long sessions or event recall.

The [numeric record](windows-resource-helper-2026-09-15.json) contains all paired
samples, actual executable categories, source/binary hashes and live report hashes.
The capture used base `98cb50d` with this working patch. Private profile/audit/log
receipts remain on X: outside Git. No installed application was replaced and no
release was cut. Linux CI covers injected transports; Windows compilation and
actual execution were verified locally.
