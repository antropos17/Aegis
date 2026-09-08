using System.Diagnostics;
using System.IO.MemoryMappedFiles;
using System.Text.Json;

namespace Aegis.EtwProbe;

internal static class Fixture
{
    internal static readonly string[] Scenarios = ["buffered", "async", "mapped", "preopened", "churn", "idle"];

    // Only called by the parent with a new, private stage directory. The actor never
    // accepts a file supplied by the user, follows no scripts and reads no secrets.
    internal static async Task<int> Run(string[] args)
    {
        if (args.Length != 5 || !Scenarios.Contains(args[3])) throw new ArgumentException("Bad actor options");
        string root = Path.GetFullPath(args[1]), role = args[2], scenario = args[3];
        if (!Path.GetFileName(root).StartsWith("aegis-etw-fixture-", StringComparison.Ordinal) ||
            !Guid.TryParseExact(Path.GetFileName(root)["aegis-etw-fixture-".Length..], "N", out _) ||
            !new[] { "target", "control" }.Contains(role)) throw new ArgumentException("Invalid fixture scope");
        int seconds = int.Parse(args[4]);
        if (seconds is < 1 or > 120) throw new ArgumentException("Invalid actor duration");
        string file = Path.Combine(root, role + ".dat");
        using (var output = new FileStream(file, FileMode.CreateNew, FileAccess.Write, FileShare.Read))
            output.Write(new byte[1024 * 1024]);
        using var preopened = scenario == "preopened" ? File.OpenRead(file) : null;
        Console.WriteLine(JsonSerializer.Serialize(new { ready = true, pid = Environment.ProcessId, tid = Native.GetCurrentThreadId(), role }));
        if (await Console.In.ReadLineAsync() != "go") return 4;
        var watch = Stopwatch.StartNew();
        var samples = new List<object>();
        int operations = 0;
        long bytes = 0;
        byte[] buffer = new byte[4096];
        while (watch.Elapsed.TotalSeconds < seconds)
        {
            long begin = Stopwatch.GetTimestamp();
            uint tidBefore = Native.GetCurrentThreadId();
            int read = 0;
            if (scenario == "idle") { await Task.Delay(50); continue; }
            if (scenario == "mapped")
            {
                using var mapping = MemoryMappedFile.CreateFromFile(file, FileMode.Open, null, 0, MemoryMappedFileAccess.Read);
                using var view = mapping.CreateViewAccessor(0, 0, MemoryMappedFileAccess.Read);
                read = view.ReadArray(0, buffer, 0, buffer.Length);
            }
            else if (preopened != null)
            {
                preopened.Position = 0;
                read = preopened.Read(buffer);
            }
            else
            {
                using var input = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read,
                    4096, scenario == "async" ? FileOptions.Asynchronous : FileOptions.None);
                read = scenario == "async" ? await input.ReadAsync(buffer) : input.Read(buffer);
            }
            operations++;
            bytes += read;
            if (samples.Count < 5000) samples.Add(new
            {
                operation = operations,
                beginQpc = begin,
                endQpc = Stopwatch.GetTimestamp(),
                tidBefore,
                tidAfter = Native.GetCurrentThreadId(),
                bytes = read
            });
            await Task.Delay(scenario == "churn" ? 1 : 20);
        }
        double durationMs = watch.Elapsed.TotalMilliseconds;
        preopened?.Dispose();
        Console.WriteLine(JsonSerializer.Serialize(new { done = true, operations }));
        if (await Console.In.ReadLineAsync() != "save") return 4;
        // Parent stops ETW before permitting ledger writes. This witnesses successful
        // API operations, not a one-to-one oracle for ETW Read event 15.
        Program.Write(root, role + "-operations.json", new
        {
            schema = 1,
            role,
            scenario,
            pid = Environment.ProcessId,
            operations,
            bytes,
            sampledOperations = samples,
            omittedOperations = operations - samples.Count,
            durationMs
        });
        return 0;
    }
}
