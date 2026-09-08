using System.Buffers.Binary;
using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Aegis.EtwLifecycle;

// Deliberately separate from etw-file/1: simulated checks cannot masquerade as
// a ready file sensor. No file data, paths or raw process identifiers on this wire.
internal sealed record Frame(string Protocol, string Id, string Seq, string Kind,
    bool Live, string Code, TraceStats? Stats, string Padding);

internal static class Wire
{
    internal const int MaxBytes = 64 * 1024;
    internal static readonly JsonSerializerOptions Json = new()
    {
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        RespectNullableAnnotations = true,
        RespectRequiredConstructorParameters = true,
        MaxDepth = 8
    };
    private static readonly UTF8Encoding Utf8 = new(false, true);
    private static readonly string[] Kinds = ["hello", "authorize", "ready", "ping", "pong", "stop", "stopped", "padding", "cleanup"];
    private static readonly string[] Codes = ["none", "stop", "parent-eof", "lease-expired", "peer-failed", "write-timeout"];

    internal static Frame Make(string id, ulong seq, string kind, bool live,
        string code = "none", TraceStats? stats = null, string padding = "") =>
        new("etw-lifecycle/2", id, seq.ToString(CultureInfo.InvariantCulture), kind, live, code, stats, padding);

    internal static void Validate(Frame frame, string id, bool live)
    {
        if (frame.Protocol != "etw-lifecycle/2" || frame.Id != id || !Guid.TryParseExact(id, "N", out _) ||
            frame.Live != live || !Kinds.Contains(frame.Kind) || !Codes.Contains(frame.Code) ||
            !ulong.TryParse(frame.Seq, NumberStyles.None, CultureInfo.InvariantCulture, out var seq) || seq == 0 ||
            frame.Seq != seq.ToString(CultureInfo.InvariantCulture) ||
            frame.Padding.Length > 16384 || (frame.Kind != "padding" && frame.Padding != "") ||
            (!live && frame.Stats != null)) throw new InvalidDataException();
    }

    internal static async Task Write(Stream stream, Frame frame, CancellationToken token)
    {
        Validate(frame, frame.Id, frame.Live);
        byte[] payload = JsonSerializer.SerializeToUtf8Bytes(frame, Json);
        if (payload.Length > MaxBytes) throw new InvalidDataException();
        byte[] prefix = new byte[4];
        BinaryPrimitives.WriteInt32LittleEndian(prefix, payload.Length);
        await stream.WriteAsync(prefix, token);
        await stream.WriteAsync(payload, token);
        await stream.FlushAsync(token);
    }

    internal static async Task<Frame> Read(Stream stream, string id, bool live, CancellationToken token)
    {
        byte[] prefix = new byte[4];
        await stream.ReadExactlyAsync(prefix, token);
        int size = BinaryPrimitives.ReadInt32LittleEndian(prefix);
        if (size <= 0 || size > MaxBytes) throw new InvalidDataException();
        byte[] payload = new byte[size];
        await stream.ReadExactlyAsync(payload, token);
        var value = JsonSerializer.Deserialize<Frame>(Utf8.GetString(payload), Json) ?? throw new InvalidDataException();
        Validate(value, id, live);
        return value;
    }

    internal static void Next(Frame frame, ref ulong sequence)
    {
        ulong actual = ulong.Parse(frame.Seq, CultureInfo.InvariantCulture);
        if (sequence == ulong.MaxValue || actual != sequence + 1) throw new InvalidDataException();
        sequence = actual;
    }
}
