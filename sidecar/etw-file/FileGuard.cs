using System.Diagnostics;

namespace Aegis.EtwLifecycle;

internal static class FileGuard
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
        FileTraceToken? owned = null;
        var collectorGone = collector.WaitForExitAsync();
        var brokerGone = broker.WaitForExitAsync();
        FileGuardResult result = new("unverified", false, false, null, null);
        try
        {
            while (true)
            {
                using var readLimit = new CancellationTokenSource(TimeSpan.FromSeconds(150));
                var input = FileGuardWire.Read<FileGuardCommand>(ownerPipe, readLimit.Token);
                var first = await Task.WhenAny(input, collectorGone, brokerGone);
                if (first != input)
                {
                    readLimit.Cancel(); ownerPipe.Dispose();
                    try { await input; } catch { }
                    if (!collector.HasExited)
                        try { await collectorGone.WaitAsync(TimeSpan.FromSeconds(7)); } catch { }
                    break;
                }
                var command = await input;
                if (command.kind == "arm" && owned == null && command.handle != null && command.guid != null)
                {
                    var token = new FileTraceToken(command.handle, command.guid);
                    var query = FileTrace.GuardControl(token, 0);
                    if (query.Stats.Status != 0 || query.Identity.ToString("N") != token.Guid) throw new InvalidDataException();
                    owned = token;
                    using var writeLimit = new CancellationTokenSource(TimeSpan.FromSeconds(5));
                    await FileGuardWire.Write(ownerPipe, new FileGuardCommand("armed"), writeLimit.Token);
                    continue;
                }
                if (command.kind != "disarm" || command.handle != null || command.guid != null) throw new InvalidDataException();
                bool absent = owned == null || FileTrace.GuardAbsent(FileTrace.GuardControl(owned, 0).Stats.Status);
                result = new(absent ? "disarmed" : "unverified", absent, absent, null, null);
                using var limit = new CancellationTokenSource(TimeSpan.FromSeconds(5));
                await FileGuardWire.Write(ownerPipe, result, limit.Token);
                await FileGuardWire.Write(brokerPipe, result, limit.Token);
                return absent ? 0 : 2;
            }
        }
        catch { }
        // EOF alone cannot establish owner death. Ask it to stop through the pipe
        // closure first; bounded waiting never grants authority over another session.
        ownerPipe.Dispose();
        if (!collector.HasExited)
            try { await collectorGone.WaitAsync(TimeSpan.FromSeconds(7)); } catch { }
        if (owned != null) result = FileTrace.Recover(owned);
        result = result with { collectorExit = collector.HasExited ? collector.ExitCode : null };
        try
        {
            using var limit = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            await FileGuardWire.Write(brokerPipe, result, limit.Token);
        }
        catch { }
        return result.stopped && result.absent ? 0 : 2;
    }
}
