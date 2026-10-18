using System.Text.Json;

namespace Aegis.EtwLifecycle;

internal static class FileMainWire
{
    internal static FileMainReservation ValidateRescue(JsonElement data)
    {
        FileWire.Shape(data, "lease", "lastSeq");
        if (!ulong.TryParse(data.GetProperty("lastSeq").GetString(), out ulong last) ||
            last.ToString() != data.GetProperty("lastSeq").GetString()) throw new InvalidDataException();
        var lease = data.GetProperty("lease");
        FileWire.Shape(lease, "guid", "ownerPid", "ownerBirth", "peers");
        var peers = lease.GetProperty("peers");
        if (peers.ValueKind != JsonValueKind.Array || peers.GetArrayLength() != 4) throw new InvalidDataException();
        foreach (var peer in peers.EnumerateArray()) FileWire.Shape(peer, "pid", "birth", "handle");
        var value = lease.Deserialize<FileMainReservation>() ?? throw new InvalidDataException();
        FileBrokerRecovery.Reservation(value.guid, value.guid);
        FileMainHandles.Positive(value.ownerBirth);
        if (value.ownerPid <= 0 || value.peers.Select(p => p.pid).Distinct().Count() != 4 ||
            value.peers.Select(p => p.handle).Distinct().Count() != 4) throw new InvalidDataException();
        foreach (var peer in value.peers)
        {
            if (peer.pid <= 0 || peer.pid == value.ownerPid) throw new InvalidDataException();
            FileMainHandles.Positive(peer.birth); FileMainHandles.Positive(peer.handle);
        }
        return value;
    }
    internal static async Task Deposit(Stream output, Stream input, string launch, string session,
        FileMainReservation lease, CancellationToken token)
    {
        var frame = new Envelope("escrow", FileWire.Protocol, launch, session, "0", JsonSerializer.SerializeToElement(lease));
        if (JsonSerializer.SerializeToUtf8Bytes(frame).Length > 2048) throw new InvalidDataException();
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(token);
        deadline.CancelAfter(TimeSpan.FromSeconds(8));
        await FileWire.Forward(output, frame, deadline.Token);
        var ack = await new FileWire(launch, session).Read(input, true, deadline.Token);
        if (ack.t != "escrow-ack") throw new InvalidDataException();
    }
}
