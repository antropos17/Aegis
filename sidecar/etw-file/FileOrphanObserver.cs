using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Win32.SafeHandles;

namespace Aegis.EtwLifecycle;

// A qualification-only normal-token witness. It has no ETW control path.
internal static class FileOrphanObserver
{
    [DllImport("kernel32.dll")] private static extern bool GetNamedPipeClientProcessId(SafePipeHandle pipe, out uint pid);
    private static void Print(object value)
    {
        string json = JsonSerializer.Serialize(value);
        if (json.Length > 2048) throw new InvalidDataException();
        Console.WriteLine(json);
    }
    internal static async Task<int> Run(bool total = false)
    {
        if (Security.Current().Elevated) return 3;
        string id = Guid.NewGuid().ToString("N"); var self = Security.Current();
        using var pipe = Security.Server(id);
        if (!Security.RestrictedAcl(pipe)) return 3;
        Print(new { type = "endpoint", address = $"{id}:{self.Pid}:{self.Birth}" });
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(240));
        await pipe.WaitForConnectionAsync(deadline.Token);
        var notice = await FileGuardWire.Read<FileOrphanNotice>(pipe, deadline.Token);
        if (!GetNamedPipeClientProcessId(pipe.SafePipeHandle, out uint pid) || pid > int.MaxValue || pid != notice.custodianPid ||
            notice.kind != "reserved" || notice.originalPids.Length != 5 || notice.originalPids.Any(p => p <= 0 || p == pid) ||
            notice.originalPids.Distinct().Count() != 5) throw new InvalidDataException();
        using var peer = new FileGuardPeer((int)pid);
        peer.Verify(pipe, (ulong)FileMainHandles.Positive(notice.custodianBirth));
        using var originals = total ? new FileOriginalObservation(notice.originalPids) : null;
        Print(new { type = "reserved", custodianPid = pid, notice.originalPids, originalObjectsObserved = originals != null });
        try
        {
            // Phase and terminal objects use separate closed shapes on the same bounded channel.
            for (int n = 0; n < 6; n++)
            {
                var value = await ReadObservation(pipe, deadline.Token);
                if (value.GetProperty("kind").GetString() != "terminal")
                { Print(new { type = "phase", kind = value.GetProperty("kind").GetString() }); continue; }
                await peer.WaitForExitAsync(TimeSpan.FromSeconds(8));
                Print(new { type = "terminal", receipt = value, custodianExit = peer.ExitCode });
                return 0;
            }
            return 2;
        }
        catch (EndOfStreamException)
        {
            await peer.WaitForExitAsync(TimeSpan.FromSeconds(8));
            int[]? originalExits = originals != null ? await originals.Wait() : null;
            Print(new { type = "peer-exit", custodianExit = peer.ExitCode, originalExits });
            return 0;
        }
    }
    private static async Task<JsonElement> ReadObservation(Stream pipe, CancellationToken token)
    {
        byte[] prefix = new byte[4]; await pipe.ReadExactlyAsync(prefix, token);
        int length = System.Buffers.Binary.BinaryPrimitives.ReadInt32LittleEndian(prefix);
        if (length is <= 0 or > 2048) throw new InvalidDataException();
        byte[] body = new byte[length]; await pipe.ReadExactlyAsync(body, token);
        using var json = JsonDocument.Parse(body, new JsonDocumentOptions { MaxDepth = 4 });
        var value = json.RootElement;
        string? kind = value.GetProperty("kind").GetString();
        if (kind == "terminal")
        {
            FileWire.Shape(value, "kind", "recovered", "absent", "exits", "queryStatus", "restrictedProbeStatus", "observationGap", "finalTotals");
            _ = value.Deserialize<FileOrphanTerminal>() ?? throw new InvalidDataException();
        }
        else { FileWire.Shape(value, "kind"); if (!FileOrphanWire.Phase(kind!)) throw new InvalidDataException(); }
        return value.Clone();
    }
}
