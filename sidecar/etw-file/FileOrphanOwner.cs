using System.Diagnostics;
using System.IO.Pipes;
using System.Text.Json;

namespace Aegis.EtwLifecycle;

// Collector owns setup, but must not wait for this child during its own exit.
internal sealed class FileOrphanOwner : IDisposable
{
    private readonly NamedPipeServerStream pipe;
    private readonly Process child;
    internal FileGuardHello Identity { get; }
    internal bool Alive => !child.HasExited;
    private FileOrphanOwner(NamedPipeServerStream channel, Process process, FileGuardHello identity)
    { pipe = channel; child = process; Identity = identity; }

    internal static async Task<FileOrphanOwner> Start(FileOrphanSetup setup, string reservation,
        Process broker, FileGuardOwner guard, FileGuardOwner fallback, string mode)
    {
        FileOrphanWire.Observer(setup.observer);
        using var main = FileMainParent.ObserveMain(broker.Id, setup.mainPid, (ulong)FileMainHandles.Positive(setup.mainBirth));
        using var selfProcess = Process.GetCurrentProcess(); var self = Security.Current();
        string id = Guid.NewGuid().ToString("N"); var pipe = Security.Server(id);
        if (!Security.RestrictedAcl(pipe)) { pipe.Dispose(); throw new UnauthorizedAccessException(); }
        var info = Program.Child("custodian", id, self.Pid.ToString(), self.Birth.ToString(), mode);
        info.RedirectStandardInput = info.RedirectStandardOutput = info.RedirectStandardError = false;
        var child = Process.Start(info) ?? throw new IOException();
        try
        {
            using var limit = new CancellationTokenSource(TimeSpan.FromSeconds(8));
            var identity = Security.Observe(child);
            await pipe.WaitForConnectionAsync(limit.Token); Security.Verify(pipe, child, identity.Birth, true, true);
            var originals = new[] { (setup.mainPid, main), (broker.Id, broker.SafeHandle), (self.Pid, selfProcess.SafeHandle),
                (guard.Id, guard.Handle), (fallback.Id, fallback.Handle) };
            var peers = originals.Select(p => FileMainHandles.Deposit(child.SafeHandle, p.Item2, p.Item1)).ToArray();
            await FileGuardWire.Write(pipe, new FileOrphanLease(reservation, JsonSerializer.SerializeToElement(peers), setup.observer), limit.Token);
            var ack = await FileGuardWire.Read<FileOrphanPhase>(pipe, limit.Token);
            if (ack.kind != "reserved" || child.HasExited) throw new IOException();
            return new(pipe, child, new(child.Id, identity.Birth.ToString(), reservation));
        }
        catch { pipe.Dispose(); child.Dispose(); throw; } // Setup EOF authorizes no capture or control.
    }
    internal async Task Phase(string kind)
    {
        if (!FileOrphanWire.Phase(kind)) throw new InvalidDataException();
        using var limit = new CancellationTokenSource(TimeSpan.FromSeconds(2));
        await FileGuardWire.Write(pipe, new FileOrphanPhase(kind), limit.Token);
    }
    public void Dispose() { pipe.Dispose(); child.Dispose(); }
}
