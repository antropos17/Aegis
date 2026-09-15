# Direct Windows TCP observation — 2026-09-15

Windows TCP collection now queries `MSFT_NetTCPConnection` in
`root/StandardCimv2` directly with `Get-CimInstance`. This is the class named by
the installed `NetTCPIP/MSFT_NetTCPConnection.cdxml` behind `Get-NetTCPConnection`.
Microsoft documents the [TCP class](https://learn.microsoft.com/en-us/windows/win32/fwp/wmi/nettcpipprov/msft-nettcpconnection).
One PID-filtered query selects the six required fields; JavaScript preserves the
existing endpoint shape, TCP state names and literal exclusions. This avoids
initializing the NetTCPIP cmdlet module. PowerShell still starts once per scan.

`bench/tcp-query-compare.cjs` compares the production provider against the frozen
cmdlet query from `9c6b8b3`. It creates its own sockets on `127.0.0.2`, `127.0.0.1`
and `::1`, with two simultaneous connections per listener. Only the two client
connections to `127.0.0.2` should survive the existing literal filters. Every
query must match the exact expected PID, both addresses, both ports and state;
matching row counts alone cannot pass. A separately queried absent PID must yield
an empty observation. The fixture is closed at completion and uses no external
server or elevated permissions.

Six alternating pairs reversed provider order in each pair, after an exploratory
run had warmed filesystem/provider caches. All twelve queries matched the exact
fixture expectations. Median elapsed query time was **2,571.31 ms** through the
cmdlet and **1,272.65 ms** through direct CIM. These timings include process startup
and parsing and do not measure CPU consumption. All samples and source hashes are
in the [numeric record](windows-tcp-cim-2026-09-15.json).

A subsequent 180-second real Electron run used a fresh minimized profile without
ETW opt-in or UAC. After the first 90 seconds, three network observations completed
with zero provider failures: raw TCP query median 1,692.98 ms, full network stage
median 1,696.69 ms (maximum 1,813.55 ms). There were still three PowerShell launches
for those observations. The run completed nine steady process ticks and exited
normally. Its live workload differs from the fixture and previous profiles, so
those figures are not a controlled before/after application comparison. Raw
numeric reports and private profile/audit/log receipts are retained outside Git.

The normalizer preserves simultaneous sockets, scoped IPv6 strings, transient TCP
states and unknown numeric enum values. It keeps the original exclusions for
Listen, Bound and four literal remote addresses. Unit tests exercise those cases,
invalid output, unsafe PID input and endpoint fields. The live fixture validates
IPv4 positive observations and IPv4/IPv6 loopback exclusions; it does not establish
coverage of external IPv6 traffic or event recall.

The same exclusion constants also generate the pre-serialization PowerShell
filter, so loopback/listener rows do not fill stdout before JavaScript can discard
them. A Windows-only test executes the generated pipeline on disposable objects:
ten thousand excluded rows plus two retained sockets produce less than 4 KiB of
JSON and preserve both sockets. No live OS table is queried by that test. The
response remains bounded at 2 MiB, allowing room for CIM's longer property names
compared with the former short aliases.

`-ErrorAction Stop` makes a CIM query failure reject the observation. Malformed or
out-of-scope rows also reject it, so failure cannot become a healthy empty table.
Actual empty output still resolves to `[]`. The existing network-health caller,
DNS validation, endpoint classification, generation attribution and scan intervals
are unchanged. No new binary, dependency, service or IPC channel is added.

Reproduce on Windows with `node bench/tcp-query-compare.cjs`. The script prints
only numeric timings, counts and source hashes; it does not print observed host
endpoints. Machine load and provider cache state affect elapsed time. This is a
small fixture comparison, not a claim about total application CPU, long-running
memory use or full network-detection accuracy.
