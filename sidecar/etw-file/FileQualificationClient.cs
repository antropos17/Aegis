using System.Diagnostics;
using Microsoft.Win32.SafeHandles;

namespace Aegis.EtwLifecycle;

internal sealed record FileQualificationRequest(string[] args);
internal sealed record FileQualificationReady(string address);
internal sealed record FileQualificationFinished(int launches, int liveChildren, int[] childExitCodes);

internal static class FileQualificationClient
{
    internal static async Task<FileNativeChild> Start(ProcessStartInfo info, string address)
    {
        FileQualificationDiagnostic.Step = 1;
        if (Security.Current().Elevated || info.FileName != Program.Executable) throw new UnauthorizedAccessException();
        var endpoint = FileOrphanWire.Observer(address) ?? throw new InvalidDataException();
        using var host = new FileGuardPeer(endpoint.pid);
        using var limit = new CancellationTokenSource(TimeSpan.FromSeconds(8));
        FileQualificationDiagnostic.Step = 2;
        using var pipe = Security.Client(endpoint.id);
        Security.Verify(pipe, host.Handle, host.Id, ulong.Parse(endpoint.birth), false, true);
        FileQualificationDiagnostic.Step = 3;
        await FileGuardWire.Write(pipe, new FileQualificationRequest(info.ArgumentList.ToArray()), limit.Token);
        var witness = await FileGuardWire.Read<FileMainWitness>(pipe, limit.Token);
        using var self = new SafeProcessHandle(new IntPtr(-1), false);
        FileQualificationDiagnostic.Step = 4;
        var handle = FileMainHandles.Retrieve(self, witness);
        try
        {
            var peer = Security.Observe(handle, witness.pid); var current = Security.Current();
            if (!peer.Elevated || peer.User != current.User || peer.Logon != current.Logon ||
                !peer.Image.Equals(Program.Executable, StringComparison.OrdinalIgnoreCase) || FileMainHandles.Gone(handle))
                throw new UnauthorizedAccessException();
            FileQualificationDiagnostic.Step = 5;
            FileMainHandles.Release(self, witness); // Only the fully verified local deposit; never retry.
            FileQualificationDiagnostic.Step = 6;
            return new(witness.pid, handle);
        }
        catch { handle.Dispose(); throw; }
    }

    internal static async Task<int> Launcher(string root)
    {
        if (Security.Current().Elevated) return 3;
        FileQualificationPolicy.OrdinaryDirectory(root);
        var self = Security.Current(); string id = Guid.NewGuid().ToString("N");
        using var pipe = Security.Server(id);
        if (!Security.RestrictedAcl(pipe)) return 3;
        var info = Program.Child("qualification-host", id, self.Pid.ToString(), self.Birth.ToString(), root);
        info.UseShellExecute = true; info.Verb = "runas"; info.WindowStyle = ProcessWindowStyle.Hidden;
        info.RedirectStandardInput = info.RedirectStandardOutput = info.RedirectStandardError = false;
        using var child = Process.Start(info) ?? throw new IOException();
        var identity = Security.Observe(child);
        using var startup = new CancellationTokenSource(TimeSpan.FromSeconds(120));
        await pipe.WaitForConnectionAsync(startup.Token);
        Security.Verify(pipe, child, identity.Birth, true, true);
        var ready = await FileGuardWire.Read<FileQualificationReady>(pipe, startup.Token);
        var endpoint = FileOrphanWire.Observer(ready.address) ?? throw new InvalidDataException();
        if (endpoint.pid != child.Id || endpoint.birth != identity.Birth.ToString()) return 3;
        Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(new { type = "host-ready", address = ready.address }));
        // The normal harness owns this lifetime. EOF never grants another launch.
        await Console.In.ReadLineAsync().WaitAsync(TimeSpan.FromMinutes(40));
        using var finish = new CancellationTokenSource(TimeSpan.FromSeconds(35));
        await FileGuardWire.Write(pipe, new FileGuardCommand("finish"), finish.Token);
        var result = await FileGuardWire.Read<FileQualificationFinished>(pipe, finish.Token);
        await child.WaitForExitAsync(finish.Token);
        Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(new { type = "host-finished", result.launches, result.liveChildren, result.childExitCodes, exitCode = child.ExitCode }));
        return result.liveChildren == 0 && child.ExitCode == 0 ? 0 : 2;
    }
}
