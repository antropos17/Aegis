using System.Buffers.Binary;
using System.Globalization;

namespace Aegis.EtwProcess;

internal sealed record ProcessObservation(int EventId, int EventVersion, string Schema, string Kind,
    uint SubjectPid, uint HeaderPid, string Qpc, string? CreationTime100ns, string? CreationTimeSource,
    string? ProviderProcessSequenceNumber, string? SequenceSource, string? ProcessStartKey = null);

internal static class ProcessDecode
{
    // The only retained payload fields are numeric. No command lines, image
    // paths, user SIDs, package names, or raw payload bytes leave this decoder.
    internal static ProcessObservation Decode(Guid provider, int id, int version, int opcode,
        int task, uint headerPid, long qpc, byte[] payload)
    {
        var pin = ProcessSchema.Pins.SingleOrDefault(p => p.Id == id && p.Version == version);
        if (provider != ProcessSchema.Provider || pin == null || pin.Opcode != opcode ||
            pin.Task != task || qpc < 0 || payload.Length > 32768)
            throw new InvalidDataException("unsupported-event");
        int cursor = 0;
        uint pid = 0;
        ulong birth = 0, sequence = 0;
        foreach (var field in pin.Fields)
        {
            int start = cursor;
            int width;
            switch (field.Type)
            {
                case 8: width = 4; break;
                case 10: case 17: width = 8; break;
                case 1: case 2:
                    int step = field.Type == 1 ? 2 : 1;
                    while (cursor + step <= payload.Length && cursor - start <= 8192 &&
                        (step == 2 ? BinaryPrimitives.ReadUInt16LittleEndian(payload.AsSpan(cursor, 2)) != 0 : payload[cursor] != 0))
                        cursor += step;
                    if (cursor + step > payload.Length || cursor - start > 8192)
                        throw new InvalidDataException("invalid-payload");
                    width = cursor - start + step;
                    break;
                case 19:
                    if (cursor + 8 > payload.Length || payload[cursor] != 1 || payload[cursor + 1] > 15)
                        throw new InvalidDataException("invalid-payload");
                    width = 8 + 4 * payload[cursor + 1];
                    break;
                default: throw new InvalidDataException("unsupported-event");
            }
            cursor = start + width;
            if (cursor > payload.Length) throw new InvalidDataException("invalid-payload");
            if (field.Name == "ProcessID") pid = BinaryPrimitives.ReadUInt32LittleEndian(payload.AsSpan(start, 4));
            if (field.Name == "CreateTime") birth = BinaryPrimitives.ReadUInt64LittleEndian(payload.AsSpan(start, 8));
            if (field.Name == "ProcessSequenceNumber") sequence = BinaryPrimitives.ReadUInt64LittleEndian(payload.AsSpan(start, 8));
        }
        if (cursor != payload.Length || pid == 0) throw new InvalidDataException("invalid-payload");
        return new(id, version, pin.Fingerprint, id == 1 ? "start" : id == 2 ? "stop" : "rundown",
            pid, headerPid, qpc.ToString(CultureInfo.InvariantCulture),
            birth == 0 ? null : birth.ToString(CultureInfo.InvariantCulture), birth == 0 ? null : "payload-CreateTime-FILETIME",
            sequence == 0 ? null : sequence.ToString(CultureInfo.InvariantCulture), sequence == 0 ? null : "payload-ProcessSequenceNumber");
    }
}
