using System.Diagnostics;

namespace Aegis.EtwLifecycle;

// One cleanup-only consent attempt after all original peers are confirmed dead.
// No caller-selected name, provider, file, new capture or arbitrary command exists.
internal static class FileRecoveryConsent
{
    internal static async Task<FileGuardResult> Start(string reservation)
    {
        if (Security.Current().Elevated) throw new UnauthorizedAccessException();
        FileBrokerRecovery.Reservation(reservation, reservation);
        var self = Security.Current(); string id = Guid.NewGuid().ToString("N");
        using var pipe = Security.Server(id);
        if (!Security.RestrictedAcl(pipe)) throw new UnauthorizedAccessException();
        var info = Program.Child("recover-peer", id, self.Pid.ToString(), self.Birth.ToString());
        info.UseShellExecute = true; info.Verb = "runas"; info.WindowStyle = ProcessWindowStyle.Hidden;
        info.RedirectStandardInput = info.RedirectStandardOutput = info.RedirectStandardError = false;
        using var limit = new CancellationTokenSource(TimeSpan.FromSeconds(120));
        using var expiry = limit.Token.Register(() => pipe.Dispose());
        using var child = Process.Start(info) ?? throw new IOException();
        var peer = Security.Observe(child);
        await pipe.WaitForConnectionAsync(limit.Token);
        Security.Verify(pipe, child, peer.Birth, true, true);
        await FileGuardWire.Write(pipe, new FileGuardCommand("recover-owned", null, reservation), limit.Token);
        var receipt = await FileGuardWire.Read<FileGuardResult>(pipe, limit.Token);
        await child.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(5));
        if (child.ExitCode != 0 || receipt.kind != "recovered" || !receipt.stopped || !receipt.absent) throw new IOException();
        return receipt;
    }

    internal static async Task<int> Run(string[] args)
    {
        if (!Security.Current().Elevated) return 3;
        using var parent = Process.GetProcessById(int.Parse(args[2]));
        using var pipe = Security.Client(args[1]);
        Security.Verify(pipe, parent, ulong.Parse(args[3]), false, false);
        using var limit = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        var command = await FileGuardWire.Read<FileGuardCommand>(pipe, limit.Token);
        if (command.kind != "recover-owned" || command.handle != null || command.guid == null) return 3;
        string reservation = FileBrokerRecovery.Reservation(command.guid, command.guid);
        var receipt = FileTrace.RecoverReservation(reservation);
        await FileGuardWire.Write(pipe, receipt, limit.Token);
        return receipt.stopped && receipt.absent ? 0 : 2;
    }
}
