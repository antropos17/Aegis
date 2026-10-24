using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Win32.SafeHandles;

namespace Aegis.EtwLifecycle;

// A qualification-only normal-token witness. It has no ETW control path.
internal static class FileOrphanObserver
{
    internal enum FailureStage
    {
        EndpointSetup, NoticeRead, NoticeParse, NoticeIdentity, PeerVerification,
        OriginalHandleObservation, ReservedOutput, ObservationRead, TerminalObservation, PeerExitObservation
    }
    private sealed record FailureObservation(string type, string stage);
    internal static async Task<int> RunWithDiagnostics(Func<Action<FailureStage>, Task<int>> operation,
        bool enabled, Action<object> output)
    {
        var stage = FailureStage.EndpointSetup;
        try
        {
            return await operation(value =>
            {
                if (!Enum.IsDefined(value)) throw new InvalidDataException();
                stage = value;
            });
        }
        catch
        {
            // A failed diagnostic write cannot replace the existing failure exit.
            if (enabled) try { output(new FailureObservation("failure", stage.ToString())); } catch { }
            return 2;
        }
    }
    internal static FileOrphanNotice ParseNotice(JsonElement value, Action<FailureStage> at)
    {
        at(FailureStage.NoticeParse);
        return FileOrphanWire.ParseNotice(value);
    }
    internal sealed record TerminalObservation(string type, JsonElement receipt, int custodianExit, int[]? originalExits);
    internal static async Task<TerminalObservation> ObserveTerminal(JsonElement value, Func<Task> waitPeer,
        Func<int> peerExit, Func<Task<int[]>>? waitOriginals)
    {
        await waitPeer();
        int custodianExit = peerExit();
        int[]? originalExits = waitOriginals == null ? null : await waitOriginals();
        return new("terminal", value, custodianExit, originalExits);
    }
    [DllImport("kernel32.dll")] private static extern bool GetNamedPipeClientProcessId(SafePipeHandle pipe, out uint pid);
    private static void Print(object value)
    {
        string json = JsonSerializer.Serialize(value);
        if (json.Length > 2048) throw new InvalidDataException();
        Console.WriteLine(json);
    }
    internal static Task<int> Run(bool total = false) => RunWithDiagnostics(at => RunCore(total, at),
        FileQualificationDiagnostic.Enabled, Print);
    private static async Task<int> RunCore(bool total, Action<FailureStage> at)
    {
        if (Security.Current().Elevated) return 3;
        string id = Guid.NewGuid().ToString("N"); var self = Security.Current();
        using var pipe = Security.Server(id);
        if (!Security.RestrictedAcl(pipe)) return 3;
        Print(new { type = "endpoint", address = $"{id}:{self.Pid}:{self.Birth}" });
        using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(240));
        at(FailureStage.NoticeRead);
        await pipe.WaitForConnectionAsync(deadline.Token);
        var notice = ParseNotice(await FileGuardWire.Read<JsonElement>(pipe, deadline.Token), at);
        at(FailureStage.NoticeIdentity);
        if (!GetNamedPipeClientProcessId(pipe.SafePipeHandle, out uint pid) || pid > int.MaxValue || pid != notice.custodianPid ||
            notice.kind != "reserved" || notice.originalPids.Length != 5 || notice.originalPids.Any(p => p <= 0 || p == pid) ||
            notice.originalPids.Distinct().Count() != 5) throw new InvalidDataException();
        at(FailureStage.PeerVerification);
        using var peer = new FileGuardPeer((int)pid);
        peer.Verify(pipe, (ulong)FileMainHandles.Positive(notice.custodianBirth));
        at(FailureStage.OriginalHandleObservation);
        using var originals = total ? new FileOriginalObservation(notice.originalPids) : null;
        at(FailureStage.ReservedOutput);
        Print(new { type = "reserved", custodianPid = pid, notice.originalPids, originalObjectsObserved = originals != null,
            notice.journalDigest, notice.previousJournalDigest, notice.previousSameScope });
        try
        {
            // Phase and terminal objects use separate closed shapes on the same bounded channel.
            for (int n = 0; n < 6; n++)
            {
                at(FailureStage.ObservationRead);
                var value = await ReadObservation(pipe, deadline.Token);
                if (value.GetProperty("kind").GetString() != "terminal")
                { Print(new { type = "phase", kind = value.GetProperty("kind").GetString() }); continue; }
                at(FailureStage.TerminalObservation);
                Print(await ObserveTerminal(value, () => peer.WaitForExitAsync(TimeSpan.FromSeconds(8)),
                    () => peer.ExitCode, originals == null ? null : originals.Wait));
                return 0;
            }
            return 2;
        }
        catch (EndOfStreamException)
        {
            at(FailureStage.PeerExitObservation);
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
