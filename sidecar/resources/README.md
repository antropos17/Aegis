# Windows resource counters

`aegis-resources.exe` performs one local read-only WMI query and exits. Build it
with `npm run build:sidecar`; the Windows packaging hook runs that same build and
includes both helpers from `build/sidecar`. It uses the inbox .NET Framework C#
compiler and System.Management assembly, with no added npm or NuGet dependency.

The sole argument is a comma-separated list of positive uint32 PIDs (at most
2,048). Output is `{ "version": 1, "rows": [...] }`, with only `IDProcess`,
`PercentProcessorTime` and `WorkingSet`. Missing counters remain JSON null.
Query failures exit nonzero without exception text or partial stdout. The provider
uses the same `Win32_PerfFormattedData_PerfProc_Process` class and PID filter as
the existing PowerShell query. CPU remains a formatted sum across logical cores;
the caller retains normalization, RAM conversion, instance cache and collection
provenance. No new CPU delta cache or process identity is introduced.

The Node transport validates output, caps stdout at 1 MiB and kills an execution
after five seconds. A failed/missing helper falls back to the original PowerShell
query and suppresses helper attempts for 60 seconds, using a monotonic clock.
Fallback remains fresh on every requested collection. Both providers failing
still produces null measurements. The existing fallback timeout is eight seconds,
so the first failing helper attempt can add up to five seconds before fallback.
`AEGIS_RESOURCE_PROVIDER=powershell` selects the old transport at app startup.

The executable is resolved from packaged resources or the development build
directory, never PATH. No service, elevated permissions or persistent child is
needed. Real Windows compilation/execution is checked locally; Linux CI exercises
the transport's validation, fallback, cooldown and resource-monitor contracts with
injected executors.

Microsoft documents formatted WMI performance classes in
[WMI performance monitoring](https://learn.microsoft.com/en-us/windows/win32/wmisdk/wmi-tasks--performance-monitoring)
and the query interface in
[ManagementObjectSearcher.Get](https://learn.microsoft.com/en-us/dotnet/api/system.management.managementobjectsearcher.get).
