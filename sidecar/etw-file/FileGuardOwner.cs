using System.Diagnostics;
using System.IO.Pipes;

namespace Aegis.EtwLifecycle;

// The collector starts each recovery peer. The normal broker independently
// verifies its original object and retains a separate pipe for its receipt.
internal sealed class FileGuardOwner : IAsyncDisposable
{
    private readonly NamedPipeServerStream pipe;
    private readonly Process child;
    private bool ended;
    internal FileGuardHello Identity { get; private set; } = null!;
    private bool fallback;
    internal bool Ended => ended;
    internal bool Alive => !child.HasExited;
    internal int Id => child.Id;
    internal Microsoft.Win32.SafeHandles.SafeProcessHandle Handle => child.SafeHandle;
    private FileGuardOwner(NamedPipeServerStream channel, Process guard) { pipe = channel; child = guard; }
    internal static async Task<FileGuardOwner> Start(string recoveryPipe, Process broker, ulong brokerBirth, Stream data,
        string reservation, string diagnosticMode, FileGuardHello? primary = null)
    {
        string id = Guid.NewGuid().ToString("N");
        var pipe = Security.Server(id);
        if (!Security.RestrictedAcl(pipe)) { pipe.Dispose(); throw new UnauthorizedAccessException(); }
        var self = Security.Current();
        var info = Program.Child(primary == null ? "guard" : "fallback", id, self.Pid.ToString(), self.Birth.ToString(),
            recoveryPipe, broker.Id.ToString(), brokerBirth.ToString(), diagnosticMode);
        info.RedirectStandardInput = info.RedirectStandardOutput = info.RedirectStandardError = false;
        var child = Process.Start(info) ?? throw new InvalidOperationException();
        var owner = new FileGuardOwner(pipe, child);
        owner.fallback = primary != null;
        try
        {
            using var limit = new CancellationTokenSource(TimeSpan.FromSeconds(8));
            var identity = Security.Observe(child);
            await pipe.WaitForConnectionAsync(limit.Token);
            Security.Verify(pipe, child, identity.Birth, true, true);
            owner.Identity = new FileGuardHello(child.Id, identity.Birth.ToString(), reservation);
            await FileGuardWire.Write(data, owner.Identity, limit.Token);
            var ack = await FileGuardWire.Read<FileGuardCommand>(data, limit.Token);
            if (ack.kind != "connected" || ack.handle != null || ack.guid != null) throw new InvalidDataException();
            if (primary == null)
                await FileGuardWire.Write(pipe, new FileGuardCommand("reserve", null, reservation), limit.Token);
            else
                await FileGuardWire.Write(pipe, new FileFallbackReservation(reservation, primary.pid, primary.birth), limit.Token);
            var reserved = await FileGuardWire.Read<FileGuardCommand>(pipe, limit.Token);
            if (reserved.kind != "reserved" || reserved.handle != null || reserved.guid != null || !owner.Alive)
                throw new InvalidDataException();
            return owner;
        }
        catch { await owner.DisposeAsync(); throw; }
    }
    internal async Task Arm(FileTraceToken token)
    {
        using var limit = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        await FileGuardWire.Write(pipe, new FileGuardCommand("arm", token.Handle, token.Guid), limit.Token);
        var ack = await FileGuardWire.Read<FileGuardCommand>(pipe, limit.Token);
        if (ack.kind != "armed" || ack.handle != null || ack.guid != null) throw new InvalidDataException();
    }
    internal async Task Disarm()
    {
        if (ended) return;
        using var limit = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        await FileGuardWire.Write(pipe, new FileGuardCommand("disarm"), limit.Token);
        var result = await FileGuardWire.Read<FileGuardResult>(pipe, limit.Token);
        if (result.kind != "disarmed" || !result.stopped || !result.absent) throw new IOException();
        await child.WaitForExitAsync(limit.Token);
        if (child.ExitCode != 0) throw new IOException();
        ended = true;
    }
    public async ValueTask DisposeAsync()
    {
        pipe.Dispose();
        // Fallback recovery requires this collector's actual exit. Waiting for
        // it here would deadlock that condition; the broker retains its peer.
        if (!fallback)
            try { await child.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(12)); } catch { }
        child.Dispose();
    }
}
