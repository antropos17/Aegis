using System.Diagnostics;
using System.Text.Json;

namespace Aegis.EtwLifecycle;

internal sealed record FileSessionState(uint status, bool? present, bool elevatedWitness);

// Fixed-name, query-only qualification witness. No GUID/handle leaves this helper,
// no output path or stop command exists, and access denial is never absence.
internal static class FileInspect
{
    private static FileSessionState Query()
    {
        uint code = FileTrace.Lookup().Stats.Status;
        return new(code, code == 0 ? true : code == 4201 ? false : null, Security.Current().Elevated);
    }
    internal static async Task<int> Run(string[] args)
    {
        if (args[0] == "inspect-peer")
        {
            if (!Security.Current().Elevated) return 3;
            using var parent = Process.GetProcessById(int.Parse(args[2]));
            using var client = Security.Client(args[1]);
            Security.Verify(client, parent, ulong.Parse(args[3]), false, false);
            using var limit = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            await FileGuardWire.Write(client, Query(), limit.Token);
            return 0;
        }
        FileSessionState result;
        if (args[0] == "inspect") result = Query();
        else
        {
            if (Security.Current().Elevated) return 3;
            var self = Security.Current();
            string id = Guid.NewGuid().ToString("N");
            using var pipe = Security.Server(id);
            if (!Security.RestrictedAcl(pipe)) return 3;
            var info = Program.Child("inspect-peer", id, self.Pid.ToString(), self.Birth.ToString());
            info.UseShellExecute = true; info.Verb = "runas"; info.WindowStyle = ProcessWindowStyle.Hidden;
            info.RedirectStandardInput = info.RedirectStandardOutput = info.RedirectStandardError = false;
            using var child = Process.Start(info) ?? throw new IOException();
            using var limit = new CancellationTokenSource(TimeSpan.FromSeconds(120));
            using var expiry = limit.Token.Register(() => pipe.Dispose());
            var peer = Security.Observe(child);
            await pipe.WaitForConnectionAsync(limit.Token);
            Security.Verify(pipe, child, peer.Birth, true, true);
            result = await FileGuardWire.Read<FileSessionState>(pipe, limit.Token);
            await child.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(5));
            if (child.ExitCode != 0) return 2;
        }
        Console.WriteLine(JsonSerializer.Serialize(result));
        return 0;
    }
}
