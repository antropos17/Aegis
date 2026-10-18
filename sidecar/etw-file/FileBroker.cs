using System.Diagnostics;

namespace Aegis.EtwLifecycle;

internal static class FileBroker
{
    internal static async Task<int> Run(string[] args)
    {
        bool live = args[0] is not ("check-broker" or "check-loss-broker");
        if (Security.Current().Elevated || !FileWire.Id(args[1]) || !FileWire.Id(args[2])) return 3;
        var scope = new FileScope(args[3]); // Validate before any UAC request.
        string pipeId = Guid.NewGuid().ToString("N");
        using var pipe = Security.Server(pipeId);
        string recoveryId = Guid.NewGuid().ToString("N");
        using var recoveryPipe = live ? Security.Server(recoveryId) : null;
        string fallbackId = Guid.NewGuid().ToString("N");
        using var fallbackPipe = live ? Security.Server(fallbackId) : null;
        if (!Security.RestrictedAcl(pipe)) return 3;
        if (recoveryPipe != null && !Security.RestrictedAcl(recoveryPipe)) return 3;
        if (fallbackPipe != null && !Security.RestrictedAcl(fallbackPipe)) return 3;
        var self = Security.Current();
        string collector = live ? args[0] switch {
            "broker-crash-check" => "crash-collector", "broker-prestart-check" => "prestart-collector",
            "broker-prearm-check" => "prearm-collector", "broker-guard-check" => "guard-loss-collector",
            "broker-dual-guard-check" => "dual-guard-collector", "broker-dual-collector-check" => "dual-collector",
            "broker-dual-prearm-check" => "dual-prearm-collector", "broker-dual-prestart-check" => "dual-prestart-collector",
            _ => "collector" } :
            args[0] == "check-loss-broker" ? "check-loss-collector" : "check-collector";
        var info = Program.Child(collector, args[1], args[2], pipeId,
            self.Pid.ToString(), self.Birth.ToString(), scope.Root, FileWire.Profile);
        if (live) { info.ArgumentList.Add(recoveryId); info.ArgumentList.Add(fallbackId); }
        if (live)
        {
            info.UseShellExecute = true; info.Verb = "runas"; info.WindowStyle = ProcessWindowStyle.Hidden;
            info.RedirectStandardInput = info.RedirectStandardOutput = info.RedirectStandardError = false;
        }
        // Closing the pipe on expiry prevents a late elevated child from authorizing capture.
        // It does not cancel or dismiss the OS consent dialog.
        using var lifetime = new CancellationTokenSource();
        using var startup = new CancellationTokenSource(TimeSpan.FromSeconds(120));
        using var expire = startup.Token.Register(() => pipe.Dispose());
        using var child = Process.Start(info) ?? throw new InvalidOperationException();
        using var recoveryLifetime = new CancellationTokenSource();
        FileGuardPeer? guard = null;
        FileGuardPeer? fallback = null;
        Task<FileGuardResult>? recovery = null;
        Task<FileGuardResult>? fallbackRecovery = null;
        try
        {
            var identity = Security.Observe(child);
            await pipe.WaitForConnectionAsync(startup.Token);
            Security.Verify(pipe, child, identity.Birth, true, live);
            startup.CancelAfter(Timeout.InfiniteTimeSpan);
            if (recoveryPipe != null)
            {
                using var connect = new CancellationTokenSource(TimeSpan.FromSeconds(8));
                var hello = await FileGuardWire.Read<FileGuardHello>(pipe, connect.Token);
                if (hello.pid <= 0 || !ulong.TryParse(hello.birth, out ulong birth) || birth == 0 || birth.ToString() != hello.birth)
                    throw new InvalidDataException();
                guard = new FileGuardPeer(hello.pid);
                await recoveryPipe.WaitForConnectionAsync(connect.Token);
                guard.Verify(recoveryPipe, birth);
                recovery = FileGuardWire.Read<FileGuardResult>(recoveryPipe, recoveryLifetime.Token);
                await FileGuardWire.Write(pipe, new FileGuardCommand("connected"), connect.Token);
                var second = await FileGuardWire.Read<FileGuardHello>(pipe, connect.Token);
                if (second.pid <= 0 || second.pid == hello.pid || second.pid == child.Id || second.pid == self.Pid ||
                    !ulong.TryParse(second.birth, out ulong secondBirth) || secondBirth == 0 || secondBirth.ToString() != second.birth)
                    throw new InvalidDataException();
                fallback = new FileGuardPeer(second.pid);
                await fallbackPipe!.WaitForConnectionAsync(connect.Token);
                fallback.Verify(fallbackPipe, secondBirth);
                fallbackRecovery = FileGuardWire.Read<FileGuardResult>(fallbackPipe, recoveryLifetime.Token);
                await FileGuardWire.Write(pipe, new FileGuardCommand("connected"), connect.Token);
            }
            var read = new FileWire(args[1], args[2]);
            var controls = new FileWire(args[1], args[2]);
            int terminalObserved = 0;
            Stream input = Console.OpenStandardInput(), output = Console.OpenStandardOutput();
            var inbound = Task.Run(async () =>
            {
                while (true) await FileWire.Forward(pipe, await controls.Read(input, true, lifetime.Token), lifetime.Token);
            });
            var outbound = Task.Run(async () =>
            {
                var performance = new FileForwardProfile();
                try
                {
                    while (true)
                    {
                        var frame = await read.ReadFrame(pipe, false, lifetime.Token);
                        if (frame.Message.t == "stopped") Volatile.Write(ref terminalObserved, 1);
                        await performance.Forward(output, frame, lifetime.Token);
                        if (frame.Message.t == "ready" && args[0] == "broker-exit-check") _ = Task.Run(async () =>
                        { await Task.Delay(30000); Environment.Exit(72); });
                        if (frame.Message.t == "stopped") return;
                    }
                }
                catch when (live && Volatile.Read(ref terminalObserved) == 0 && recovery != null && guard != null &&
                    fallback != null && fallbackRecovery != null)
                {
                    Volatile.Write(ref terminalObserved, 3); // Guard recovery owns completion while pipe pings unwind.
                    pipe.Dispose();
                    await child.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(12));
                    await Task.WhenAll(guard.WaitForExitAsync(TimeSpan.FromSeconds(12)),
                        fallback.WaitForExitAsync(TimeSpan.FromSeconds(12)));
                    FileGuardResult? primary = null;
                    try { primary = await recovery.WaitAsync(TimeSpan.FromSeconds(2)); } catch { }
                    var secondary = await fallbackRecovery.WaitAsync(TimeSpan.FromSeconds(2));
                    var chosen = FileRecoveryPolicy.Select(child.ExitCode, guard.ExitCode, fallback.ExitCode, primary, secondary);
                    var receipt = chosen.Receipt;
                    var counters = receipt.counters ?? new FileStats(50, null, null, null, null, null);
                    var terminal = new FileWire(args[1], args[2]);
                    terminal.ContinueAfter(read.LastReceived);
                    Volatile.Write(ref terminalObserved, 2);
                    await terminal.Write(output, "recovered", new
                    {
                        cause = chosen.Fallback ? "collector-and-guard-exited" : "collector-exited", stopped = true, absent = true,
                        counters = new { queryStatus = counters.Status, eventsLost = counters.Events?.ToString(),
                            realTimeBuffersLost = counters.RealTime?.ToString(), logBuffersLost = counters.Log?.ToString(),
                            asOfQpc = receipt.asOfQpc },
                        finalTotals = (object?)null, observationGap = true, collectorExit = child.ExitCode
                    }, lifetime.Token);
                }
            });
            try
            {
                var first = await Task.WhenAny(inbound, outbound);
                // Main closes stdin immediately after accepting stopped. Its EOF may
                // win the scheduling race with the outbound task completing its flush.
                if (first == inbound && Volatile.Read(ref terminalObserved) == 0) await inbound;
                await outbound;
                await child.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(7));
                if (guard != null)
                {
                    await guard.WaitForExitAsync(TimeSpan.FromSeconds(7));
                    if (guard.ExitCode != 0 && Volatile.Read(ref terminalObserved) != 2) return 2;
                }
                if (fallback != null)
                {
                    await fallback.WaitForExitAsync(TimeSpan.FromSeconds(7));
                    if (fallback.ExitCode != 0) return 2;
                }
                if (Volatile.Read(ref terminalObserved) == 2) return 4; // Cleanup succeeded; capture failed.
                return child.ExitCode == 0 ? 0 : 2;
            }
            finally
            {
                lifetime.Cancel(); pipe.Dispose(); input.Dispose();
                try { await Task.WhenAll(inbound, outbound).WaitAsync(TimeSpan.FromSeconds(6)); } catch { }
            }
        }
        finally
        {
            pipe.Dispose(); // Independent EOF cleanup trigger; never terminate elevated child.
            try { await child.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(12)); } catch { }
            if (guard != null)
            {
                try { await guard.WaitForExitAsync(TimeSpan.FromSeconds(12)); } catch { }
                guard.Dispose();
            }
            if (fallback != null)
            {
                try { await fallback.WaitForExitAsync(TimeSpan.FromSeconds(12)); } catch { }
                fallback.Dispose();
            }
            recoveryLifetime.Cancel();
            if (recovery != null) { try { await recovery; } catch { } }
            if (fallbackRecovery != null) { try { await fallbackRecovery; } catch { } }
        }
    }
}
