namespace Aegis.EtwLifecycle;

internal static class FileOrphanBroker
{
    internal static async Task<FileGuardPeer> Reserve(Stream pipe, FileMainCustody main, string? observer)
    {
        using var limit = new CancellationTokenSource(TimeSpan.FromSeconds(12));
        var identity = main.OwnerIdentity; FileOrphanWire.Observer(observer);
        await FileGuardWire.Write(pipe, new FileOrphanSetup(identity.Pid, identity.Birth.ToString(), observer), limit.Token);
        var hello = await FileGuardWire.Read<FileGuardHello>(pipe, limit.Token);
        if (hello.pid <= 0 || hello.pid == identity.Pid || main.Reservation.peers.Any(p => p.pid == hello.pid) ||
            hello.guid != main.Reservation.guid) throw new InvalidDataException();
        var peer = new FileGuardPeer(hello.pid);
        try { peer.VerifyIdentity((ulong)FileMainHandles.Positive(hello.birth)); return peer; }
        catch { peer.Dispose(); throw; }
    }
    internal static async Task Watch(FileGuardPeer peer, Stream capturePipe, CancellationToken token)
    {
        try
        {
            while (!peer.HasExited) await Task.Delay(100, token);
            token.ThrowIfCancellationRequested(); capturePipe.Dispose();
        }
        catch (OperationCanceledException) { }
    }
    internal static async Task FaultExit(string mode, FileMainCustody? custody)
    {
        if (!mode.StartsWith("broker-orphan-", StringComparison.Ordinal)) return;
        if (mode == "broker-orphan-native-check")
        {
            using var limit = new CancellationTokenSource(TimeSpan.FromSeconds(20));
            while (custody?.OwnerGone == false) await Task.Delay(50, limit.Token);
        }
        Environment.Exit(75); // Diagnostic only: skip original broker cleanup too.
    }
}
