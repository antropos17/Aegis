# Network verdict work — 2026-09-14

The TCP scanner already resolves DNS once per normalized remote address, but it
previously repeated allowlist classification for every socket. Scans containing
repeated addresses now reuse that address's verdict from the same scan's DNS
evidence. A scan containing only distinct addresses skips the verdict Map.
Verdicts expire with the function call; DNS TTL handling and forward confirmation
are unchanged. Owner, instance, ports, socket state and HTTP flags remain separate
for every output row, including equivalent IPv4/mapped-IPv6 addresses.

## Reproduction

```powershell
node scripts/bench-network-verdicts.cjs --baseline=bca004f466c2b0107f120bfc74d3bc32562f6a2f --report=X:/tmp/network-verdicts.json
```

Use a trusted baseline commit and an unused report filename. The script executes
both actual scanner revisions with identical TCP and DNS fixtures and current
dependencies. It checks complete output equality and unmodified input rows.
After an initial scan and five warm-up scans, 20 interleaved samples contain five
scans each. DNS is warm during measurement; each arm makes exactly 100 fake TCP
provider calls and zero DNS provider calls. No real sockets or DNS are queried.

Windows x64, Node v24.11.1; median milliseconds per scan:

| Sockets | Distinct addresses | Previous | Current |
| --- | --- | --- | --- |
| 256 | 1 | 0.80898 | 0.23213 |
| 2,048 | 1 | 5.31291 | 1.43203 |
| 256 | 256 | 0.95702 | 1.00482 |

The distinct-address case does not demonstrate an improvement. These timings
measure JavaScript processing over controlled providers, not network latency or
total application CPU. Timing is informational; no machine-dependent threshold
is asserted. The [report](network-verdict-work-2026-09-14.json) includes scanner
and dependency hashes.

The work regression first failed with 1,000 hostname normalizations versus a
limit of 11 derived from ten same-address sockets. Three new tests cover bounded
classification work, socket/owner separation, equivalent address spellings,
unmatched owners, DNS expiry/reclassification, unconfirmed PTR results, provider
failure and recovery. Existing network suites also cover scans exceeding the DNS
cache capacity and address/domain allowlist boundaries.
