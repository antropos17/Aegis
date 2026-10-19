using System.Diagnostics;

namespace Aegis.EtwLifecycle;

internal static class FileBroker
{
    internal static async Task<int> Run(string[] args)
    {
        bool live = args[0] is not ("check-broker" or "check-loss-broker");
        if (Security.Current().Elevated || !FileWire.Id(args[1]) || !FileWire.Id(args[2])) return 3;
        var scope = new FileScope(args[3]); // Validate before any UAC request.
        if (args.Length == 6) FileOrphanWire.Observer(args[5]);
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
            "broker-triple-collector-check" or "broker-triple-denial-check" => "triple-collector", "broker-triple-guard-check" => "triple-guard-collector",
            "broker-triple-fallback-check" => "triple-fallback-collector", "broker-triple-prearm-check" => "triple-prearm-collector",
            "broker-triple-prestart-check" => "triple-prestart-collector",
            "broker-group-prestart-check" => "triple-prestart-collector", "broker-group-prearm-check" => "triple-prearm-collector",
            "broker-group-first-check" => "group-parent-collector", "broker-group-triple-check" or "broker-group-denial-check" => "triple-collector",
            "broker-orphan-prestart-check" => "orphan-prestart-collector", "broker-orphan-prearm-check" => "orphan-prearm-collector",
            "broker-orphan-main-check" => "orphan-main-collector", "broker-orphan-native-check" => "orphan-native-collector",
            "broker-orphan-denial-check" => "orphan-denial-collector", "broker-custodian-exit-check" => "custodian-exit-collector",
            "broker-orphan-total-prestart-check" => "orphan-total-prestart-collector",
            "broker-orphan-total-prearm-check" => "orphan-total-prearm-collector",
            "broker-orphan-total-running-check" => "orphan-total-running-collector",
            "broker-orphan-recovery-denial-check" => "orphan-recovery-denial-collector",
            _ => "collector" } :
            args[0] == "check-loss-broker" ? "check-loss-collector" : "check-collector";
        var info = Program.Child(collector, args[1], args[2], pipeId,
            self.Pid.ToString(), self.Birth.ToString(), scope.Root, FileWire.Profile);
        if (live) { info.ArgumentList.Add(recoveryId); info.ArgumentList.Add(fallbackId); }
        bool mainEscrow = args.Length >= 5 && args[4] == "main-escrow";
        if (live && mainEscrow) info.ArgumentList.Add("orphan-custody");
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
        using var child = await FileNativeChild.Start(info);
        using var recoveryLifetime = new CancellationTokenSource();
        FileGuardPeer? guard = null;
        FileGuardPeer? fallback = null;
        Task<FileGuardResult>? recovery = null;
        Task<FileGuardResult>? fallbackRecovery = null;
        string? reservation = null;
        FileMainCustody? mainCustody = null;
        FileGuardPeer? custodian = null;
        Task? custodianWatch = null;
        Stream input = Console.OpenStandardInput(), output = Console.OpenStandardOutput();
        try
        {
            var identity = Security.Observe(child.SafeHandle, child.Id);
            await pipe.WaitForConnectionAsync(startup.Token);
            Security.Verify(pipe, child.SafeHandle, child.Id, identity.Birth, true, live);
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
                reservation = FileBrokerRecovery.Reservation(hello.guid, second.guid);
                fallbackRecovery = FileGuardWire.Read<FileGuardResult>(fallbackPipe, recoveryLifetime.Token);
                if (mainEscrow)
                {
                    using var originalBroker = Process.GetCurrentProcess();
                    mainCustody = FileMainCustody.Deposit(reservation,
                        [(self.Pid, originalBroker.SafeHandle), (child.Id, child.SafeHandle),
                         (guard.Id, guard.Handle), (fallback.Id, fallback.Handle)]);
                    // Collector cannot start until this independent authority and main both acknowledge custody.
                    await FileGuardWire.Write(pipe, new FileGuardCommand("connected"), connect.Token);
                    connect.CancelAfter(Timeout.InfiniteTimeSpan);
                    custodian = await FileOrphanBroker.Reserve(pipe, mainCustody, args.Length == 6 ? args[5] : null);
                    await FileMainWire.Deposit(output, input, args[1], args[2], mainCustody.Reservation, connect.Token);
                    custodianWatch = FileOrphanBroker.Watch(custodian, pipe, lifetime.Token);
                }
                else await FileGuardWire.Write(pipe, new FileGuardCommand("connected"), connect.Token);
            }
            var read = new FileWire(args[1], args[2]);
            var controls = new FileWire(args[1], args[2]);
            int terminalObserved = 0;
            int consentRequested = 0;
            var cleanupAck = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            var inbound = Task.Run(async () =>
            {
                while (true)
                {
                    var command = await controls.Read(input, true, lifetime.Token);
                    if (command.t == "consent-ack")
                    {
                        if (Volatile.Read(ref consentRequested) != 1 || !cleanupAck.TrySetResult(true)) throw new InvalidDataException();
                        return;
                    }
                    await FileWire.Forward(pipe, command, lifetime.Token);
                }
            });
            async Task ConsentAck()
            {
                using var deadline = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
                deadline.CancelAfter(TimeSpan.FromSeconds(8));
                await Task.WhenAny(cleanupAck.Task, inbound).WaitAsync(deadline.Token);
                if (cleanupAck.Task.IsCompleted) { await cleanupAck.Task; return; }
                try { await inbound; } catch { }
                // The old forwarding task can have ended after pipe EOF. It no
                // longer reads stdin, so transfer that one reader to cleanup.
                while (true)
                {
                    var command = await controls.Read(input, true, deadline.Token);
                    if (command.t == "consent-ack") return;
                    if (command.t is not ("ping" or "stop" or "prime-issuers")) throw new InvalidDataException();
                }
            }
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
                        if (frame.Message.t == "ready" && args[0] == "broker-group-first-check") _ = Task.Run(async () =>
                        { await Task.Delay(30000); Environment.Exit(75); });
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
                    if (args[0].StartsWith("broker-group-", StringComparison.Ordinal)) Environment.Exit(75);
                    await FileOrphanBroker.FaultExit(args[0], mainCustody);
                    FileGuardResult? primary = null;
                    try { primary = await recovery.WaitAsync(TimeSpan.FromSeconds(2)); } catch { }
                    FileGuardResult? secondary = null;
                    try { secondary = await fallbackRecovery.WaitAsync(TimeSpan.FromSeconds(2)); } catch { }
                    FileGuardResult receipt;
                    string cause;
                    bool cleanupElevated = false, accessDenied = false;
                    var terminal = new FileWire(args[1], args[2]);
                    terminal.ContinueAfter(read.LastReceived);
                    try
                    {
                        var chosen = FileRecoveryPolicy.Select(child.ExitCode, guard.ExitCode, fallback.ExitCode, primary, secondary);
                        receipt = chosen.Receipt;
                        cause = chosen.Fallback ? "collector-and-guard-exited" : "collector-exited";
                    }
                    catch (IOException)
                    {
                        FileGuardResult Recover() => FileBrokerRecovery.Recover(reservation, child.HasExited, guard.HasExited, fallback.HasExited);
                        receipt = args[0] == "broker-triple-denial-check" ? FileRecoveryAccess.RestrictedProbe(Recover) : Recover();
                        if (FileRecoveryAccess.NeedsConsent(receipt))
                        {
                            accessDenied = true;
                            Volatile.Write(ref consentRequested, 1);
                            await terminal.Write(output, "recovering", new
                            { cause = "all-three-helpers-exited", queryStatus = 5, consentDeadlineMs = 120000 }, lifetime.Token);
                            await ConsentAck();
                            receipt = await FileRecoveryConsent.Start(reservation!);
                            cleanupElevated = true;
                        }
                        if (receipt.kind != "recovered" || !receipt.stopped || !receipt.absent) throw new IOException();
                        cause = "all-three-helpers-exited";
                    }
                    var counters = receipt.counters ?? new FileStats(50, null, null, null, null, null);
                    Volatile.Write(ref terminalObserved, 2);
                    await terminal.Write(output, "recovered", new
                    {
                        cause, stopped = true, absent = true,
                        peers = new { guardExit = guard.ExitCode, fallbackExit = fallback.ExitCode, brokerElevated = self.Elevated,
                            cleanupElevated, accessDenied },
                        counters = new { queryStatus = counters.Status, eventsLost = counters.Events?.ToString(),
                            realTimeBuffersLost = counters.RealTime?.ToString(), logBuffersLost = counters.Log?.ToString(),
                            asOfQpc = receipt.asOfQpc },
                        finalTotals = (object?)null, observationGap = true, collectorExit = child.ExitCode,
                        brokerExit = (int?)null
                    }, lifetime.Token);
                }
            });
            try
            {
                var first = await Task.WhenAny(inbound, outbound);
                // Main closes stdin immediately after accepting stopped. Its EOF may
                // win the scheduling race with the outbound task completing its flush.
                if (first == inbound && Volatile.Read(ref terminalObserved) == 0)
                {
                    // A failed ping can win the race with collector EOF. Close
                    // the data pipe, then let the same outbound recovery path
                    // establish cleanup before lifetime cancellation.
                    try { await inbound; } catch { pipe.Dispose(); }
                }
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
                    if (fallback.ExitCode != 0 && Volatile.Read(ref terminalObserved) != 2) return 2;
                }
                if (Volatile.Read(ref terminalObserved) is 1 or 2) mainCustody?.ReleaseDeposits(false);
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
            mainCustody?.Dispose();
            lifetime.Cancel();
            if (custodianWatch != null) { try { await custodianWatch; } catch { } }
            custodian?.Dispose(); // Never wait for its exit: this broker is one of the original five.
        }
    }
}
