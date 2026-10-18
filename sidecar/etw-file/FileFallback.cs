using System.Diagnostics;

namespace Aegis.EtwLifecycle;

// Independent elevated recovery authority, started and reserved before StartTrace.
// It survives loss of the collector and primary guard; it cannot recapture ETW.
internal static class FileFallback
{
    internal static async Task<int> Run(string[] args)
    {
        if (!Security.Current().Elevated) return 3;
        using var collector = Process.GetProcessById(int.Parse(args[2]));
        using var broker = Process.GetProcessById(int.Parse(args[5]));
        using var ownerPipe = Security.Client(args[1]);
        Security.Verify(ownerPipe, collector, ulong.Parse(args[3]), false, true);
        using var brokerPipe = Security.Client(args[4]);
        Security.Verify(brokerPipe, broker, ulong.Parse(args[6]), false, false);
        using var setup = new CancellationTokenSource(TimeSpan.FromSeconds(8));
        var reservation = await FileGuardWire.Read<FileFallbackReservation>(ownerPipe, setup.Token);
        if (!Guid.TryParseExact(reservation.guid, "N", out var guid) || guid == Guid.Empty ||
            reservation.guardPid <= 0 || reservation.guardPid == collector.Id || reservation.guardPid == broker.Id ||
            !ulong.TryParse(reservation.guardBirth, out ulong birth) || birth == 0 || birth.ToString() != reservation.guardBirth)
            throw new InvalidDataException();
        using var guard = new FileGuardPeer(reservation.guardPid);
        guard.VerifyIdentity(birth); // Retain this original query-limited process object, never reopen its PID.
        await FileGuardWire.Write(ownerPipe, new FileGuardCommand("reserved"), setup.Token);
        var collectorGone = collector.WaitForExitAsync();
        var brokerGone = broker.WaitForExitAsync();
        FileGuardResult result = new("unverified", false, false, null, null);
        try
        {
            using var readLimit = new CancellationTokenSource(TimeSpan.FromSeconds(150));
            var input = FileGuardWire.Read<FileGuardCommand>(ownerPipe, readLimit.Token);
            var first = await Task.WhenAny(input, collectorGone, brokerGone);
            if (first == input)
            {
                var command = await input;
                if (command.kind != "disarm" || command.handle != null || command.guid != null) throw new InvalidDataException();
                // Normal disarm is query-only and also requires the primary guard's exit.
                await guard.WaitForExitAsync(TimeSpan.FromSeconds(5));
                bool absent = guard.ExitCode == 0 && FileTrace.Lookup().Stats.Status == 4201;
                result = new(absent ? "disarmed" : "unverified", absent, absent, null, null, guardExit: guard.ExitCode);
                using var limit = new CancellationTokenSource(TimeSpan.FromSeconds(5));
                await FileGuardWire.Write(ownerPipe, result, limit.Token);
                await FileGuardWire.Write(brokerPipe, result, limit.Token);
                return absent ? 0 : 2;
            }
            readLimit.Cancel(); ownerPipe.Dispose();
            try { await input; } catch { }
        }
        catch { }
        ownerPipe.Dispose(); // Ask a surviving collector to close; never terminate a peer.
        try
        {
            await Task.WhenAll(collectorGone, guard.WaitForExitAsync(TimeSpan.FromSeconds(12)))
                .WaitAsync(TimeSpan.FromSeconds(12));
        }
        catch { }
        result = FileRecoveryPolicy.Recover(reservation.guid, collector.HasExited, guard.HasExited) with
        {
            collectorExit = collector.HasExited ? collector.ExitCode : null,
            guardExit = guard.HasExited ? guard.ExitCode : null
        };
        try
        {
            using var limit = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            await FileGuardWire.Write(brokerPipe, result, limit.Token);
        }
        catch { }
        return result.stopped && result.absent ? 0 : 2;
    }
}
