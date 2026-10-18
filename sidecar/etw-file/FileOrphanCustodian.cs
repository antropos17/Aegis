using System.Diagnostics;

namespace Aegis.EtwLifecycle;

internal static class FileOrphanCustodian
{
    internal static async Task<int> Run(string[] args)
    {
        if (!Security.Current().Elevated) return 3;
        int collectorPid = int.Parse(args[2]); ulong birth = (ulong)FileMainHandles.Positive(args[3]);
        using var parent = FileMainHandles.OpenProcess(FileMainHandles.ObserveRights, false, collectorPid);
        using var pipe = Security.Client(args[1]); Security.Verify(pipe, parent, collectorPid, birth, false, true);
        using var setup = new CancellationTokenSource(TimeSpan.FromSeconds(8));
        var lease = await FileGuardWire.Read<FileOrphanLease>(pipe, setup.Token);
        using var custody = FileOrphanCustody.Take(lease, collectorPid, birth);
        var durable = FileDurableJournal.Reserve(custody.Durable(), args[4] == "recovery-denial-check");
        using var observation = await FileOrphanObservation.Connect(lease.observer, custody.Pids);
        if (durable.restrictedProbeStatus == 5) await observation.Send(new FileOrphanPhase("journal-denied"));
        if (durable.recovered != 0) await observation.Send(new FileOrphanPhase("journal-recovered"));
        await FileGuardWire.Write(pipe, new FileOrphanPhase("reserved"), setup.Token);
        if (args[4] == "exit-check") _ = Task.Run(async () => { await Task.Delay(30000); Environment.Exit(76); });
        using var lifetime = new CancellationTokenSource();
        var phases = Task.Run(async () =>
        {
            try
            {
                for (int n = 0; n < 3; n++)
                {
                    var phase = await FileGuardWire.Read<FileOrphanPhase>(pipe, lifetime.Token);
                    if (!FileOrphanWire.Phase(phase.kind)) throw new InvalidDataException();
                    await observation.Send(phase);
                }
            }
            catch { } // Pipe EOF is not original-process exit proof.
        });
        try
        {
            bool tripleObserved = false; long? orphanedAt = null;
            while (true)
            {
                var exits = custody.Exits;
                if (args[4] == "total-exit-check" && exits[0]) Environment.Exit(76); // Leave cleanup to the next explicit launch.
                if (!tripleObserved && exits.Skip(2).All(gone => gone))
                {
                    tripleObserved = true;
                    await phases.WaitAsync(TimeSpan.FromSeconds(3)).ConfigureAwait(ConfigureAwaitOptions.SuppressThrowing);
                    await observation.Send(new FileOrphanPhase("triple-exited"));
                }
                if (exits[0]) orphanedAt ??= Stopwatch.GetTimestamp();
                if (exits.All(gone => gone)) break;
                if (!exits[0] && exits.Skip(1).All(gone => gone))
                {
                    // Main's existing recovery/normal stop owns cleanup while main survives.
                    var found = FileTrace.Lookup();
                    if (found.Stats.Status == 4201)
                    {
                        FileDurableJournal.Retire(custody.Reservation);
                        await observation.Send(new FileOrphanTerminal("terminal", false, true, [], 4201, null, true, null));
                        return 0;
                    }
                    // A later explicit capture may already own the name. Never retain
                    // stale authority indefinitely or control that different reservation.
                    if (found.Stats.Status == 0 && found.Identity.ToString("N") != custody.Reservation)
                    {
                        await observation.Send(new FileOrphanTerminal("terminal", false, false, [], 0, null, true, null));
                        return 2;
                    }
                }
                if (orphanedAt.HasValue && Stopwatch.GetElapsedTime(orphanedAt.Value) >= TimeSpan.FromSeconds(20))
                    throw new TimeoutException();
                await Task.Delay(100);
            }
            FileGuardResult Recover() => FileOrphanPolicy.Recover(custody.Reservation, custody.Exits);
            uint? denied = null;
            if (args[4] == "denial-check")
            {
                var probe = FileRecoveryAccess.RestrictedProbe(Recover);
                if (!FileRecoveryAccess.NeedsConsent(probe)) throw new IOException();
                denied = 5; // Reverting the diagnostic thread restriction restores the existing original token.
            }
            var result = Recover();
            if (result.kind != "recovered" || !result.stopped || !result.absent) throw new IOException();
            FileDurableJournal.Retire(custody.Reservation);
            await observation.Send(new FileOrphanTerminal("terminal", true, true, custody.Codes,
                result.counters?.Status ?? 50, denied, true, null));
            return 4;
        }
        catch
        {
            await observation.Send(new FileOrphanTerminal("terminal", false, false, [], 50, null, true, null));
            return 2;
        }
        finally
        {
            lifetime.Cancel(); pipe.Dispose();
            try { await phases.WaitAsync(TimeSpan.FromSeconds(3)); } catch { }
        }
    }
}
