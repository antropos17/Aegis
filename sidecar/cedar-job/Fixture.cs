using System.Buffers.Binary;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;

// Included only in the separate qualification build. No policy/action execution.
internal static class Fixture
{
    [DllImport("kernel32.dll", SetLastError = true)] private static extern nint VirtualAlloc(nint address, nuint bytes, uint kind, uint protect);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool VirtualFree(nint address, nuint bytes, uint kind);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool TerminateProcess(nint process, uint code);
    internal static bool PipeOnly;
    internal static bool StrictRetention;
    internal static nint ControlPipe;
    private static nint controlWriter;
    private static string terminalMode = "";
    private static bool terminalQueued;

    internal static int ParentAdmission()
    {
        bool accepted = false;
        object? profile = null;
        try
        {
            var captured = RetentionJob.CaptureAmbient();
            profile = RetentionJob.Facts(captured);
            accepted = RetentionJob.Supported(captured);
        }
        catch { }
        Console.WriteLine(JsonSerializer.Serialize(new { label = "AMBIENT_PROFILE_QUERY_ONLY", supported = accepted,
            profile, ownJobCreated = false, evaluatorCreated = false }));
        return 0;
    }

    internal static int ProfileControls()
    {
        var baseline = new Native.Limits { Basic = new Native.BasicLimits { Flags = 0x3c00, Priority = 32, Scheduling = 5 } };
        var cases = new List<(string Label, RetentionJob.Profile Value, bool Expected)>
        {
            ("STRUCTURAL_PROFILE", new(true, baseline, default, default), true),
            ("NO_AMBIENT", default, true),
            ("UI_RESTRICTED", new(true, baseline, new Native.UiLimits { Flags = 1 }, default), false),
            ("CPU_RATE_ENABLED", new(true, baseline, default, new Native.CpuLimits { Flags = 1, Value = 1000 }), false),
            ("CPU_UNKNOWN_STATE", new(true, baseline, default, new Native.CpuLimits { Value = 1 }), false)
        };
        var altered = baseline; altered.Basic.Flags |= 0x20;
        cases.Add(("ENABLED_PRIORITY_LIMIT", new(true, altered, default, default), false));
        altered = baseline; altered.Basic.Flags |= 0x80;
        cases.Add(("ENABLED_SCHEDULING_LIMIT", new(true, altered, default, default), false));
        altered = baseline; altered.Basic.Flags |= 0x1;
        cases.Add(("UNKNOWN_RESOURCE_FLAG", new(true, altered, default, default), false));
        altered = baseline; altered.ProcessMemory = 128 * 1024 * 1024;
        cases.Add(("UNSUPPORTED_AMBIENT_MEMORY", new(true, altered, default, default), false));
        altered = baseline; altered.Basic.ProcessTime = 1;
        cases.Add(("UNSUPPORTED_AMBIENT_TIME", new(true, altered, default, default), false));
        var rows = cases.Select(value => new { label = value.Label, expected = value.Expected,
            actual = RetentionJob.Supported(value.Value) }).ToArray();
        bool passed = rows.All(value => value.actual == value.expected);
        Console.WriteLine(JsonSerializer.Serialize(new { label = "RETENTION_PROFILE_PURE_CONTROLS", passed, rows,
            ownJobCreated = false, evaluatorCreated = false, assertionKind = passed ? null : "AssertionError",
            assertionCode = passed ? null : "ERR_ASSERTION" }));
        return passed ? 0 : 9;
    }

    private static void QueueTerminalInput()
    {
        byte[] frame = { 2, 0, 0, 0, 123, 125 }; // A second inert frame containing {}.
        Native.Check(Native.WriteFile(controlWriter, frame, (uint)frame.Length, out uint count, 0) && count == frame.Length);
        terminalQueued = true;
    }

    internal static void AfterOutputRead()
    {
        if (terminalMode == "queued-during-drain" && !terminalQueued) QueueTerminalInput();
    }

    internal static int TerminalControl(string mode)
    {
        if (mode is not ("clean" or "queued-before-receive" or "queued-during-drain" or "owner-closed")) return 1;
        PipeOnly = true; terminalMode = mode; terminalQueued = false;
        nint outputWriter = 0, errorWriter = 0;
        using var child = new Child(); // No process handle, executable, evaluator or Job is created.
        string label = "PIPE_ONLY_TERMINAL_" + mode.ToUpperInvariant().Replace('-', '_');
        try
        {
            var security = new Native.Security { Length = Marshal.SizeOf<Native.Security>() };
            Native.Check(Native.CreatePipe(out ControlPipe, out controlWriter, ref security, 0));
            Native.Check(Native.CreatePipe(out child.Output, out outputWriter, ref security, 0));
            Native.Check(Native.CreatePipe(out child.Error, out errorWriter, ref security, 0));
            using var stream = new MemoryStream();
            Protocol.Write(stream, new { decision = "allow", reason = "policy-allow", policyIds = new[] { "fixture" } });
            byte[] frame = stream.ToArray();
            Native.Check(Native.WriteFile(outputWriter, frame, (uint)frame.Length, out uint count, 0) && count == frame.Length);
            Native.Close(ref outputWriter); Native.Close(ref errorWriter);
            if (mode == "queued-before-receive") QueueTerminalInput();
            if (mode == "owner-closed") Native.Close(ref controlWriter);
            bool refused = false;
            JsonElement? reply = null;
            try { reply = Protocol.Receive(child); }
            catch (InvalidOperationException error) when (error.Message == "cedar-control-refused") { refused = true; }
            bool passed = mode == "clean" ? !refused && reply?.GetProperty("decision").GetString() == "allow" : refused;
            if (mode == "queued-during-drain") passed &= terminalQueued;
            Console.WriteLine(JsonSerializer.Serialize(new { label, passed, refused, terminalQueued,
                nativePipes = true, syntheticAlreadyExitedProcess = true, ownJobCreated = false, evaluatorCreated = false,
                assertionKind = passed ? null : "AssertionError", code = passed ? null : "ERR_ASSERTION" }));
            return passed ? 0 : 9;
        }
        catch (Exception error)
        {
            Console.WriteLine(JsonSerializer.Serialize(new { label, passed = false, assertionKind = error.GetType().Name, code = "PIPE_FIXTURE_SETUP_FAILED" }));
            return 8;
        }
        finally
        {
            Native.Close(ref outputWriter); Native.Close(ref errorWriter);
            Native.Close(ref controlWriter); Native.Close(ref ControlPipe);
            PipeOnly = false;
        }
    }

    internal static int Run(string operation)
    {
        if (operation == "sleep" || operation == "suspended") { Thread.Sleep(25000); return 1; }
        if (operation == "cpu") { while (true) Thread.SpinWait(1000000); }
        if (operation == "bad-exit") return 7;
        if (operation == "excess") { Console.OpenStandardOutput().Write(new byte[16384]); return 0; }
        string id = "fixture";
        int allocationError = 0;
        if (operation == "memory")
        {
            var allocations = new List<nint>();
            try
            {
                for (int i = 0; i < 64; i++)
                {
                    nint allocation = VirtualAlloc(0, 4 * 1024 * 1024, 0x3000, 4);
                    if (allocation == 0)
                    {
                        allocationError = Marshal.GetLastWin32Error();
                        id = "memory-refused-at-" + allocations.Count * 4;
                        break;
                    }
                    allocations.Add(allocation);
                    Marshal.WriteByte(allocation, 1);
                }
            }
            finally { foreach (var allocation in allocations) VirtualFree(allocation, 0, 0x8000); }
            if (id == "fixture") return 3;
        }
        else if (operation == "spawn")
        {
            try
            {
                using var attempted = Process.Start(new ProcessStartInfo(Environment.ProcessPath!, "--inert-sleep") { UseShellExecute = false, CreateNoWindow = true });
                // A created process that is immediately terminated is also a refused descendant.
                if (attempted == null || !attempted.WaitForExit(500)) return 4;
                id = "descendant-refused";
            }
            catch (System.ComponentModel.Win32Exception) { id = "descendant-refused"; }
        }
        else if (operation is not ("caps-corrupt" or "revoked-suspended" or "expired-suspended" or "unknown-wait" or "unknown-pipe")) return 5;
        string[] ids = allocationError == 0 ? new[] { id } : new[] { id, "allocation-error-" + allocationError };
        Protocol.Write(Console.OpenStandardOutput(), new { decision = "deny", reason = "policy-deny", policyIds = ids.Order(StringComparer.Ordinal).ToArray() });
        return 0;
    }

    internal static int ParentLoss()
    {
        using var helper = new Process
        {
            StartInfo = new ProcessStartInfo(Environment.ProcessPath!) { UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true }
        };
        Process? original = null;
        bool started = false, originalVerified = false;
        try
        {
            started = helper.Start();
            Native.Check(started);
            byte[] body = JsonSerializer.SerializeToUtf8Bytes(new { schemaVersion = 1, op = "suspended", request = new { } });
            byte[] frame = new byte[body.Length + 4];
            BinaryPrimitives.WriteUInt32LittleEndian(frame, (uint)body.Length); body.CopyTo(frame, 4);
            helper.StandardInput.BaseStream.Write(frame); helper.StandardInput.BaseStream.Flush();
            using var deadline = new CancellationTokenSource(5000);
            byte[] header = new byte[4];
            helper.StandardOutput.BaseStream.ReadExactlyAsync(header, deadline.Token).AsTask().GetAwaiter().GetResult();
            int length = checked((int)BinaryPrimitives.ReadUInt32LittleEndian(header));
            Native.Check(length is > 0 and < 1024);
            byte[] reply = new byte[length];
            helper.StandardOutput.BaseStream.ReadExactlyAsync(reply, deadline.Token).AsTask().GetAwaiter().GetResult();
            using var document = JsonDocument.Parse(reply);
            original = Process.GetProcessById(document.RootElement.GetProperty("fixtureReady").GetInt32());
            nint retainedHandle = original.Handle; // Open before killing the parent; never reacquire/adopt by PID.
            Native.Check(Native.GetProcessTimes(retainedHandle, out long creation, out _, out _, out _) &&
                creation == document.RootElement.GetProperty("originalCreationTime").GetInt64());
            originalVerified = true;
            helper.Kill(); Native.Check(helper.WaitForExit(1500));
            bool terminated = Native.WaitForSingleObject(retainedHandle, 1500) == 0;
            if (!terminated) TerminateProcess(retainedHandle, 1); // Bounded fixture cleanup on that original handle.
            Console.WriteLine(JsonSerializer.Serialize(new { label = "PARENT_LOSS_SUSPENDED", terminated, retainedOriginalHandle = true,
                originalCreationTimeMatched = originalVerified, ownership = document.RootElement.GetProperty("ownership").Clone() }));
            return terminated ? 0 : 9;
        }
        catch (Exception error)
        {
            Console.WriteLine(JsonSerializer.Serialize(new { label = "PARENT_LOSS_SUSPENDED", assertionKind = error.GetType().Name, code = "fixture-failed" }));
            return 8;
        }
        finally
        {
            if (started && !helper.HasExited) { helper.Kill(); helper.WaitForExit(1500); }
            original?.Dispose();
        }
    }
}
