using System.Diagnostics;
using System.Text.Json;

internal static class Program
{
    private static int stopped;
    private static readonly Stopwatch wall = Stopwatch.StartNew();
#if CEDAR_JOB_FIXTURE
    private static bool expiredForFixture;
    internal static string FixtureFault = "";
    internal static object? FixtureConstruction;
    internal static void ExpireForFixture() { expiredForFixture = true; }
#endif
    internal static bool ControlOpen() => Native.PeekNamedPipe(Native.GetStdHandle(-10), 0, 0, 0, out _, 0);
    internal static void MarkStopped(int reason) => Interlocked.CompareExchange(ref stopped, reason, 0);
    internal static void CheckRunning()
    {
#if CEDAR_JOB_FIXTURE
        Native.Check(!expiredForFixture);
#endif
        Native.Check(Volatile.Read(ref stopped) == 0 && ControlOpen() && wall.ElapsedMilliseconds < OwnedJob.WallMs);
    }

    private static int Main(string[] args)
    {
        if (!OperatingSystem.IsWindows()) return 1;
#if CEDAR_JOB_FIXTURE
        if (args.Length == 1 && args[0].StartsWith("--inert-", StringComparison.Ordinal)) return Fixture.Run(args[0][8..]);
        if (args.Length == 1 && args[0] == "--observe-parent-loss") return Fixture.ParentLoss();
        if (args.Length == 1 && args[0] == "--observe-parent-admission") return Fixture.ParentAdmission();
        if (args.Length == 1 && args[0] == "--retention-profile-controls") return Fixture.ProfileControls();
        if (args.Length == 1 && args[0] == "--strict-retention-memory")
        {
            Fixture.StrictRetention = true;
            return Main(Array.Empty<string>());
        }
        if (args.Length == 1 && args[0].StartsWith("--pipe-only-terminal-", StringComparison.Ordinal))
            return Fixture.TerminalControl(args[0]["--pipe-only-terminal-".Length..]);
#endif
        if (args.Length != 0) return 1;
        bool closed = false;
        string reason = "cedar-process-failed";
        JsonElement? result = null;
        OwnedJob? job = null;
        Child? child = null;
        using var finished = new ManualResetEventSlim(false);
        Thread? watchdog = null;
#if CEDAR_JOB_FIXTURE
        object? observation = null;
#endif
        wall.Restart();
        try
        {
            // The trusted facade supplies an allowlisted environment before .NET starts.
            // Reject hooks/diagnostics on direct invocation before private input is read.
            Native.Check(Environment.GetEnvironmentVariables().Keys.Cast<string>().All(key =>
                !new[] { "NODE_", "DOTNET_", "CORECLR_", "COR_", "COMPLUS_" }.Any(prefix => key.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))));
            job = new OwnedJob();
            // Independent of the Node parent's event loop and of blocked private writes.
            watchdog = new Thread(() =>
            {
                while (!finished.Wait(5))
                {
                    int failure = !ControlOpen() ? 2 : wall.ElapsedMilliseconds >= OwnedJob.WallMs ? 1 : 0;
                    if (failure == 0) continue;
                    job.Revoke(failure);
                    return;
                }
            }) { IsBackground = true, Name = "cedar-job-wall-owner" };
            watchdog.Start();
            byte[] request = Protocol.ReadRequest(Native.GetStdHandle(-10));
            using var document = JsonDocument.Parse(request.AsMemory(4), new JsonDocumentOptions { MaxDepth = 16 });
            var input = document.RootElement;
            Protocol.ExactKeys(input, "schemaVersion", "op", "request");
            Native.Check(input.GetProperty("schemaVersion").GetInt32() == 1);
            string operation = input.GetProperty("op").GetString() ?? "";
#if CEDAR_JOB_FIXTURE
            Native.Check(operation is "memory" or "cpu" or "sleep" or "spawn" or "suspended" or "resume-refusal" or "excess" or "bad-exit" or "caps-corrupt" or "revoked-suspended" or "expired-suspended" or "unknown-wait" or "unknown-pipe");
            FixtureFault = operation;
            child = new Child();
            child.Start(job, Environment.ProcessPath!, "", operation);
            Native.Close(ref child.Input);
#else
            Native.Check(operation == "evaluate");
            var layout = Layout.Verified();
            CheckRunning();
            child = new Child();
            child.Start(job, layout.Runtime, layout.Entry);
            Protocol.Send(child.Input, request);
            Native.Close(ref child.Input);
#endif
            result = Protocol.Receive(child);
            CheckRunning();
            Native.Check(wall.ElapsedMilliseconds < OwnedJob.WallMs);
            reason = "ok";
        }
        catch { result = null; }
        finally
        {
            if (job != null) closed = job.StopAndConfirm(child?.Process ?? 0);
            if (child != null && child.Process != 0 && !Protocol.DrainAfterStop(child)) { closed = false; result = null; }
#if CEDAR_JOB_FIXTURE
            if (job != null) observation = job.Observation(child?.Process ?? 0);
#endif
            finished.Set();
            if (watchdog != null && !watchdog.Join(250)) { closed = false; result = null; }
            // Disposal only after the whole-Job query and original-process wait above.
            child?.Dispose();
            job?.Dispose();
        }
        int stop = Volatile.Read(ref stopped);
        if (stop != 0 || !closed || wall.ElapsedMilliseconds >= OwnedJob.WallMs)
        {
            result = null;
            reason = stop == 1 || wall.ElapsedMilliseconds >= OwnedJob.WallMs ? "cedar-process-timeout" : "cedar-process-unconfirmed";
        }
        try
        {
            Protocol.Write(Console.OpenStandardOutput(), new
            {
                schemaVersion = 1, op = "result", closed, reason, result,
                limits = new { processMemoryBytes = (ulong)OwnedJob.MemoryBytes, jobMemoryBytes = (ulong)OwnedJob.MemoryBytes,
                    activeProcesses = 1, processUserTicks = OwnedJob.CpuTicks, jobUserTicks = OwnedJob.CpuTicks, wallMs = OwnedJob.WallMs }
#if CEDAR_JOB_FIXTURE
                , fixture = observation, construction = FixtureConstruction
#endif
            });
            return closed ? 0 : 1;
        }
        catch { return 1; }
    }
}
