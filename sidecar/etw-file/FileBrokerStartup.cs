namespace Aegis.EtwLifecycle;

// The broker owns framing, validation and acknowledgements. Callbacks retain the
// native peer authentication and custody operations at their existing boundary.
internal static class FileBrokerStartup
{
    internal static async Task Connect(Stream pipe, int brokerPid, int collectorPid,
        Func<int, ulong, string, CancellationToken, Task> connectPrimary,
        Func<int, ulong, string, CancellationToken, Task> connectFallback,
        Func<CancellationToken, Task>? custody, CancellationToken startupToken,
        TimeSpan? connectionBudget = null)
    {
        TimeSpan budget = connectionBudget ?? TimeSpan.FromSeconds(8);
        if (budget <= TimeSpan.Zero || budget > TimeSpan.FromSeconds(8))
            throw new ArgumentOutOfRangeException(nameof(connectionBudget));

        var primary = await FileGuardWire.Read<FileGuardHello>(pipe, startupToken);
        ulong primaryBirth = Validate(primary, brokerPid, collectorPid);
        FileBrokerRecovery.Reservation(primary.guid, primary.guid);
        using (var connect = CancellationTokenSource.CreateLinkedTokenSource(startupToken))
        {
            connect.CancelAfter(budget);
            await connectPrimary(primary.pid, primaryBirth, primary.guid, connect.Token);
            connect.Token.ThrowIfCancellationRequested();
            await FileGuardWire.Write(pipe, new FileGuardCommand("connected"), connect.Token);
            connect.Token.ThrowIfCancellationRequested();
        }

        var fallback = await FileGuardWire.Read<FileGuardHello>(pipe, startupToken);
        ulong fallbackBirth = Validate(fallback, brokerPid, collectorPid);
        if (fallback.pid == primary.pid) throw new InvalidDataException();
        FileBrokerRecovery.Reservation(primary.guid, fallback.guid);
        using (var connect = CancellationTokenSource.CreateLinkedTokenSource(startupToken))
        {
            connect.CancelAfter(budget);
            await connectFallback(fallback.pid, fallbackBirth, fallback.guid, connect.Token);
            connect.Token.ThrowIfCancellationRequested();
            await FileGuardWire.Write(pipe, new FileGuardCommand("connected"), connect.Token);
            connect.Token.ThrowIfCancellationRequested();
        }

        startupToken.ThrowIfCancellationRequested();
        if (custody != null) await custody(startupToken);
        startupToken.ThrowIfCancellationRequested();
    }

    private static ulong Validate(FileGuardHello hello, int brokerPid, int collectorPid)
    {
        if (hello.pid <= 0 || hello.pid == brokerPid || hello.pid == collectorPid ||
            !ulong.TryParse(hello.birth, out ulong birth) || birth == 0 || birth.ToString() != hello.birth)
            throw new InvalidDataException();
        return birth;
    }
}
