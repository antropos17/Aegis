using System.Diagnostics;
using System.IO.Pipes;

namespace Aegis.EtwLifecycle;

// The collector retains its guard child. The normal broker independently verifies
// that exact guard and keeps a second pipe open for a collector-crash receipt.
internal sealed class FileGuardOwner : IAsyncDisposable
{
    private readonly NamedPipeServerStream pipe;
    private readonly Process child;
    private bool ended;
    internal bool Alive => !child.HasExited;
    private FileGuardOwner(NamedPipeServerStream channel, Process guard) { pipe = channel; child = guard; }
    internal static async Task<FileGuardOwner> Start(string recoveryPipe, Process broker, ulong brokerBirth, Stream data)
    {
        string id = Guid.NewGuid().ToString("N");
        var pipe = Security.Server(id);
        if (!Security.RestrictedAcl(pipe)) { pipe.Dispose(); throw new UnauthorizedAccessException(); }
        var self = Security.Current();
        var info = Program.Child("guard", id, self.Pid.ToString(), self.Birth.ToString(),
            recoveryPipe, broker.Id.ToString(), brokerBirth.ToString());
        info.RedirectStandardInput = info.RedirectStandardOutput = info.RedirectStandardError = false;
        var child = Process.Start(info) ?? throw new InvalidOperationException();
        var owner = new FileGuardOwner(pipe, child);
        try
        {
            using var limit = new CancellationTokenSource(TimeSpan.FromSeconds(8));
            var identity = Security.Observe(child);
            await pipe.WaitForConnectionAsync(limit.Token);
            Security.Verify(pipe, child, identity.Birth, true, true);
            await FileGuardWire.Write(data, new FileGuardHello(child.Id, identity.Birth.ToString()), limit.Token);
            var ack = await FileGuardWire.Read<FileGuardCommand>(data, limit.Token);
            if (ack.kind != "connected" || ack.handle != null || ack.guid != null) throw new InvalidDataException();
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
        try { await child.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(12)); } catch { }
        child.Dispose();
    }
}
