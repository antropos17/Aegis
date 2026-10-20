using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Security.Cryptography;

namespace Aegis.EtwLifecycle;

internal sealed record FileDurablePeer(int pid, string birth);
internal sealed record FileDurableLease(int version, string guid, string user, string logon, string image, FileDurablePeer[] peers);
internal sealed record FileDurableSummary(int recovered, uint? restrictedProbeStatus, bool observationGap, object? finalTotals,
    string journalDigest, string? previousJournalDigest, bool? previousSameScope);

// A protected write-ahead reservation survives every original process. Recovery
// runs only at the next explicitly consented capture; no resident seventh helper.
internal static class FileDurableRecovery
{
    // Complete validated protected-record correlation for the private qualification
    // observer only. The digest supplies no cleanup or capture authority.
    internal static string Digest(FileDurableLease lease)
    {
        Validate(lease);
        return Convert.ToHexStringLower(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(lease)));
    }
    internal static bool ValidDigest(string? value) => value?.Length == 64 && value.All(c => c is >= '0' and <= '9' or >= 'a' and <= 'f');

    internal static FileDurableLease Parse(byte[] bytes)
    {
        if (bytes.Length is 0 or > 8192) throw new InvalidDataException();
        using var json = JsonDocument.Parse(bytes, new JsonDocumentOptions { MaxDepth = 4 });
        FileWire.Shape(json.RootElement, "version", "guid", "user", "logon", "image", "peers");
        foreach (var peer in json.RootElement.GetProperty("peers").EnumerateArray()) FileWire.Shape(peer, "pid", "birth");
        var lease = json.RootElement.Deserialize<FileDurableLease>() ?? throw new InvalidDataException();
        Validate(lease); return lease;
    }

    internal static void Validate(FileDurableLease lease)
    {
        FileBrokerRecovery.Reservation(lease.guid, lease.guid);
        if (lease.version != 1 || lease.peers == null || lease.peers.Length != 6 ||
            lease.peers.Any(p => p == null || p.pid <= 0) || lease.peers.Select(p => p.pid).Distinct().Count() != 6 ||
            string.IsNullOrEmpty(lease.user) || string.IsNullOrEmpty(lease.logon) || string.IsNullOrEmpty(lease.image) ||
            lease.user.Length > 256 || lease.logon.Length > 256 || lease.image.Length > 1024) throw new InvalidDataException();
        foreach (var peer in lease.peers) FileMainHandles.Positive(peer.birth);
    }

    internal static FileGuardResult Recover(FileDurableLease lease, Func<FileDurablePeer, bool?> probe,
        Func<string, FileGuardResult>? recover = null)
    {
        Validate(lease);
        if (!lease.peers.All(peer => probe(peer) == true)) return new("unverified", false, false, null, null);
        return recover != null ? recover(lease.guid) : FileTrace.RecoverReservation(lease.guid);
    }

    // Reopening a PID grants observation only. An exact full birth comparison
    // distinguishes a replacement process; no remote handle is imported/closed.
    internal static bool? Gone(FileDurablePeer peer)
    {
        using var handle = FileMainHandles.OpenProcess(FileMainHandles.ObserveRights, false, peer.pid);
        if (handle.IsInvalid) return Marshal.GetLastWin32Error() == 87 ? true : null;
        try { return FileMainHandles.Birth(handle).ToString() != peer.birth || FileMainHandles.Gone(handle); }
        catch (Win32Exception) { return null; }
    }

    internal static bool SameScope(FileDurableLease lease, PeerIdentity self) =>
        lease.user == self.User && lease.logon == self.Logon && lease.image.Equals(self.Image, StringComparison.OrdinalIgnoreCase);

    // Absence permits retiring stale metadata after a logon/package change,
    // never controlling a foreign trace. Original identities must still be gone.
    internal static bool Retirable(FileDurableLease lease, uint queryStatus, Func<FileDurablePeer, bool?> probe)
    {
        Validate(lease);
        return queryStatus == 4201 && lease.peers.All(peer => probe(peer) == true);
    }
}
