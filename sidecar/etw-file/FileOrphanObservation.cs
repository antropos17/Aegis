using System.IO.Pipes;

namespace Aegis.EtwLifecycle;

// Optional diagnostic sink: no commands are read from the normal observer.
internal sealed class FileOrphanObservation : IDisposable
{
    private NamedPipeClientStream? pipe;
    private readonly SemaphoreSlim writer = new(1, 1);
    private FileOrphanObservation(NamedPipeClientStream? value) { pipe = value; }
    internal static async Task<FileOrphanObservation> Connect(string? address, int[] originals, FileDurableSummary durable)
    {
        var endpoint = FileOrphanWire.Observer(address);
        if (endpoint == null) return new(null);
        using var peer = FileMainHandles.OpenProcess(FileMainHandles.ObserveRights, false, endpoint.pid);
        var pipe = Security.Client(endpoint.id);
        try
        {
            Security.Verify(pipe, peer, endpoint.pid, (ulong)FileMainHandles.Positive(endpoint.birth), false, false);
            using var limit = new CancellationTokenSource(TimeSpan.FromSeconds(3)); var self = Security.Current();
            await FileGuardWire.Write(pipe, new FileOrphanNotice("reserved", self.Pid, self.Birth.ToString(), originals,
                durable.journalDigest, durable.previousJournalDigest, durable.previousSameScope), limit.Token);
            return new(pipe);
        }
        catch { pipe.Dispose(); throw; }
    }
    internal async Task Send<T>(T value)
    {
        bool entered = false;
        try
        {
            using var limit = new CancellationTokenSource(TimeSpan.FromSeconds(2));
            await writer.WaitAsync(limit.Token); entered = true;
            if (pipe == null) return;
            await FileGuardWire.Write(pipe, value, limit.Token);
        }
        catch { if (entered) { pipe?.Dispose(); pipe = null; } } // Losing diagnostics must never cancel cleanup.
        finally { if (entered) writer.Release(); }
    }
    public void Dispose() { pipe?.Dispose(); writer.Dispose(); }
}
