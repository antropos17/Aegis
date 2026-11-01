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
        using var watch = new CancellationTokenSource();
        try
        {
            using var limit = new CancellationTokenSource(TimeSpan.FromSeconds(8));
            using var startup = new FileGuardStartup(child.WaitForExitAsync(watch.Token), () => child.ExitCode, limit.Token);
            string phase = primary == null ? "guard" : "fallback";
            FileQualificationDiagnostic.Stage(phase + "-connect");
            var identity = Security.Observe(child);
            await startup.Wait(token => pipe.WaitForConnectionAsync(token));
            Security.Verify(pipe, child, identity.Birth, true, true);
            owner.Identity = new FileGuardHello(child.Id, identity.Birth.ToString(), reservation);
            FileQualificationDiagnostic.Stage(phase + "-broker");
            if (primary == null)
            {
                // The unarmed GUID reservation uses a different pipe. Queue it
                // before broker authentication completes so its reply can progress
                // within the same eight-second startup deadline, not after it.
                var reserve = ReservePrimary(startup, pipe, reservation);
                ObserveFailure(reserve);
                var connected = ConnectBroker(startup, data, owner.Identity);
                ObserveFailure(connected);
                var first = await Task.WhenAny(reserve, connected);
                FileQualificationDiagnostic.Stage(phase + (first == reserve ? "-reserve" : "-broker"));
                await first;
                FileQualificationDiagnostic.Stage(phase + (first == reserve ? "-broker" : "-reserve"));
                await (first == reserve ? connected : reserve);
            }
            else
            {
                // Fallback reservation can deliberately exit the peer. Keep it
                // after ACK2 and the broker's original-process handle deposit.
                await ConnectBroker(startup, data, owner.Identity);
                FileQualificationDiagnostic.Stage(phase + "-reserve");
                await startup.Wait(token => FileGuardWire.Write(pipe, new FileFallbackReservation(reservation, primary.pid, primary.birth), token));
                await ReadReserved(startup, pipe);
            }
            limit.Token.ThrowIfCancellationRequested();
            if (!owner.Alive) throw new FileGuardPeerExitedException(child.ExitCode);
            return owner;
        }
        catch
        {
            // Capture cannot start before this returns. Close the failed channel and
            // release our reference; waiting here would stall the collector's exit
            // while the guard itself waits for that exit before recovery/reporting.
            watch.Cancel(); pipe.Dispose(); child.Dispose();
            throw;
        }
        finally { watch.Cancel(); }
    }
    private static async Task ConnectBroker(FileGuardStartup startup, Stream data, FileGuardHello identity)
    {
        await startup.Wait(token => FileGuardWire.Write(data, identity, token));
        var ack = await startup.Wait(token => FileGuardWire.Read<FileGuardCommand>(data, token));
        if (ack.kind != "connected" || ack.handle != null || ack.guid != null) throw new InvalidDataException();
    }
    private static async Task ReservePrimary(FileGuardStartup startup, Stream pipe, string reservation)
    {
        await startup.Wait(token => FileGuardWire.Write(pipe, new FileGuardCommand("reserve", null, reservation), token));
        await ReadReserved(startup, pipe);
    }
    private static async Task ReadReserved(FileGuardStartup startup, Stream pipe)
    {
        var reserved = await startup.Wait(token => FileGuardWire.Read<FileGuardCommand>(pipe, token));
        if (reserved.kind != "reserved" || reserved.handle != null || reserved.guid != null)
            throw new InvalidDataException();
    }
    private static void ObserveFailure(Task task)
    {
        // If the other exchange fails first, startup disposal cancels this one.
        // Observe its wrapper task too, without waiting beyond the shared limit.
        _ = task.ContinueWith(static failed => { _ = failed.Exception; }, CancellationToken.None,
            TaskContinuationOptions.OnlyOnFaulted | TaskContinuationOptions.ExecuteSynchronously, TaskScheduler.Default);
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
