using System.Text.Json;

namespace Aegis.EtwLifecycle;

internal sealed record FileOrphanEndpoint(string id, int pid, string birth);
internal sealed record FileOrphanSetup(int mainPid, string mainBirth, string? observer);
internal sealed record FileOrphanLease(string guid, JsonElement peers, string? observer);
internal sealed record FileOrphanNotice(string kind, int custodianPid, string custodianBirth, int[] originalPids,
    string journalDigest, string? previousJournalDigest, bool? previousSameScope);
internal sealed record FileOrphanPhase(string kind);
internal sealed record FileOrphanTerminal(string kind, bool recovered, bool absent, int[] exits,
    uint queryStatus, uint? restrictedProbeStatus, bool observationGap, object? finalTotals);

internal static class FileOrphanWire
{
    internal static FileOrphanEndpoint? Observer(string? value)
    {
        if (value == null) return null;
        if (value.Length > 80) throw new InvalidDataException();
        var parts = value.Split(':');
        if (parts.Length != 3 || !Guid.TryParseExact(parts[0], "N", out var id) || id == Guid.Empty ||
            id.ToString("N") != parts[0] || !int.TryParse(parts[1], out int pid) || pid <= 0 || pid.ToString() != parts[1])
            throw new InvalidDataException();
        FileMainHandles.Positive(parts[2]);
        return new(parts[0], pid, parts[2]);
    }
    internal static FileMainWitness[] Witnesses(FileOrphanLease lease)
    {
        FileBrokerRecovery.Reservation(lease.guid, lease.guid); Observer(lease.observer);
        if (lease.peers.ValueKind != JsonValueKind.Array || lease.peers.GetArrayLength() != 5) throw new InvalidDataException();
        foreach (var item in lease.peers.EnumerateArray()) FileWire.Shape(item, "pid", "birth", "handle");
        var peers = lease.peers.Deserialize<FileMainWitness[]>() ?? throw new InvalidDataException();
        if (peers.Any(p => p.pid <= 0 || p.pid == Environment.ProcessId) || peers.Select(p => p.pid).Distinct().Count() != 5 ||
            peers.Select(p => p.handle).Distinct().Count() != 5) throw new InvalidDataException();
        foreach (var peer in peers) { FileMainHandles.Positive(peer.birth); FileMainHandles.Positive(peer.handle); }
        return peers;
    }
    internal static bool Phase(string kind) => kind is "before-start" or "before-arm" or "running" or "triple-exited" or "journal-recovered" or "journal-denied";
}
