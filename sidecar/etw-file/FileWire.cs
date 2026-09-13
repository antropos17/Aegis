using System.Buffers;
using System.Buffers.Binary;
using System.Text;
using System.Text.Json;

namespace Aegis.EtwLifecycle;

internal sealed record Envelope(string t, string proto, string launchId, string sessionId, string seq, JsonElement data);
internal sealed class FileWire(string launch, string session, FilePerformance? performance = null)
{
    // A validated envelope and its original bounded body travel together. Changing
    // an Envelope via 'with' never silently reuses a stale serialized body.
    internal sealed class ReceivedFrame(Envelope message, ReadOnlyMemory<byte> body)
    {
        internal Envelope Message { get; } = message;
        internal Task Forward(Stream stream, CancellationToken token) => WriteBody(stream, body, token);
    }
    internal const string Protocol = "etw-file/5", Profile = "home-26200-diagnostic-v1";
    internal const int Limit = 256 * 1024;
    internal static readonly string[] Schemas = ["10:0", "12:1", "13:1", "14:1", "15:1"];
    private static readonly UTF8Encoding Utf8 = new(false, true);
    private ulong sent, received;
    internal static bool Id(string value) => value.Length is > 0 and <= 64 && value.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_');
    internal static void Shape(JsonElement value, params string[] names)
    {
        if (value.ValueKind != JsonValueKind.Object) throw new InvalidDataException();
        var actual = value.EnumerateObject().Select(p => p.Name).ToArray();
        if (actual.Length != names.Length || actual.Distinct().Count() != names.Length || names.Any(n => !value.TryGetProperty(n, out _)))
            throw new InvalidDataException();
    }
    internal async Task<Envelope> Read(Stream stream, bool control, CancellationToken token) =>
        (await ReadFrame(stream, control, token)).Message;

    internal async Task<ReceivedFrame> ReadFrame(Stream stream, bool control, CancellationToken token)
    {
        byte[] header = new byte[4];
        await stream.ReadExactlyAsync(header, token);
        uint length = BinaryPrimitives.ReadUInt32LittleEndian(header);
        if (length is 0 or > Limit) throw new InvalidDataException();
        byte[] body = new byte[length];
        await stream.ReadExactlyAsync(body, token);
        using var json = JsonDocument.Parse(Utf8.GetString(body), new JsonDocumentOptions { MaxDepth = 16 });
        Shape(json.RootElement, "t", "proto", "launchId", "sessionId", "seq", "data");
        var frame = json.RootElement.Deserialize<Envelope>() ?? throw new InvalidDataException();
        if (!Id(launch) || !Id(session) || frame.launchId != launch || frame.sessionId != session || frame.proto != Protocol ||
            !ulong.TryParse(frame.seq, out ulong seq) || seq == 0 || seq.ToString() != frame.seq || seq <= received)
            throw new InvalidDataException();
        received = seq;
        if (control)
        {
            if (frame.t == "start")
            {
                Shape(frame.data, "requestId", "profile", "buffersMiB");
                if (frame.data.GetProperty("profile").GetString() != Profile || frame.data.GetProperty("buffersMiB").GetInt32() != 16)
                    throw new InvalidDataException();
            }
            else if (frame.t == "stop") Shape(frame.data, "requestId");
            else if (frame.t == "ping") Shape(frame.data);
            else throw new InvalidDataException();
            if (frame.t != "ping" && !Id(frame.data.GetProperty("requestId").GetString() ?? "")) throw new InvalidDataException();
        }
        else if (frame.t is not ("hello" or "ready" or "observations" or "health" or "heartbeat" or "stopped" or "error"))
            throw new InvalidDataException();
        return new ReceivedFrame(frame with { data = frame.data.Clone() }, body);
    }
    internal Task Write(Stream stream, string kind, object data, CancellationToken token) =>
        WriteCore(stream, kind, writer => { JsonSerializer.Serialize(writer, data); return true; }, token);

    internal Task<bool> WriteObservations(Stream stream, Func<FileObservation?> take, CancellationToken token)
    {
        token.ThrowIfCancellationRequested();
        var first = take();
        if (first == null) return Task.FromResult(false);
        return WriteCore(stream, "observations", writer =>
        {
            writer.WriteStartObject(); writer.WriteStartArray("records");
            long start = writer.BytesCommitted + writer.BytesPending;
            int count = 0;
            FileObservation? record = first;
            while (count < 128 && writer.BytesCommitted + writer.BytesPending - start < 32 * 1024)
            {
                token.ThrowIfCancellationRequested();
                record ??= take();
                if (record == null) break;
                // Encode once into the final frame; actual encoded bytes set the batch budget.
                JsonSerializer.Serialize(writer, record);
                count++;
                record = null;
            }
            writer.WriteEndArray(); writer.WriteEndObject();
            return count != 0;
        }, token);
    }

    private async Task<bool> WriteCore(Stream stream, string kind, Func<Utf8JsonWriter, bool> data, CancellationToken token)
    {
        var buffer = new FileFrameBuffer();
        using (var writer = new Utf8JsonWriter(buffer))
        {
            writer.WriteStartObject();
            writer.WriteString("t", kind); writer.WriteString("proto", Protocol);
            writer.WriteString("launchId", launch); writer.WriteString("sessionId", session);
            writer.WriteString("seq", (sent + 1).ToString()); writer.WritePropertyName("data");
            if (!data(writer)) return false; // Empty polls neither write nor consume a sequence number.
            writer.WriteEndObject(); writer.Flush();
        }
        sent++;
        if (kind != "observations" || performance == null) await WriteBody(stream, buffer.Written, token);
        else
        {
            long start = performance.Now(); bool success = false;
            try { await WriteBody(stream, buffer.Written, token); success = true; }
            finally { performance.OutputWrite.Record(performance.Now() - start, !success); }
        }
        return true;
    }
    internal static async Task Forward(Stream stream, Envelope message, CancellationToken token)
    {
        byte[] bytes = JsonSerializer.SerializeToUtf8Bytes(message);
        await WriteBody(stream, bytes, token);
    }
    private static async Task WriteBody(Stream stream, ReadOnlyMemory<byte> bytes, CancellationToken token)
    {
        if (bytes.Length > Limit) throw new InvalidDataException();
        byte[] header = new byte[4]; BinaryPrimitives.WriteInt32LittleEndian(header, bytes.Length);
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(token);
        deadline.CancelAfter(TimeSpan.FromSeconds(5));
        await stream.WriteAsync(header, deadline.Token);
        await stream.WriteAsync(bytes, deadline.Token);
        await stream.FlushAsync(deadline.Token);
    }
}

// One bounded frame buffer. Utf8JsonWriter can reserve three times the actual
// escaped UTF-8 size for UTF-16 strings. Reservation and committed bytes have
// separate hard limits; oversized JSON never reaches the stream.
internal sealed class FileFrameBuffer : IBufferWriter<byte>
{
    private const int ReserveLimit = 3 * FileWire.Limit;
    private byte[] bytes = new byte[64 * 1024];
    private int written;
    internal ReadOnlyMemory<byte> Written => bytes.AsMemory(0, written);
    public void Advance(int count)
    {
        if (count < 0 || count > Math.Min(bytes.Length, FileWire.Limit) - written) throw new InvalidDataException();
        written += count;
    }
    public Memory<byte> GetMemory(int sizeHint = 0)
    {
        if (sizeHint < 0 || sizeHint > ReserveLimit - written) throw new InvalidDataException();
        int required = written + Math.Max(1, sizeHint);
        if (required > ReserveLimit) throw new InvalidDataException();
        if (required > bytes.Length)
            Array.Resize(ref bytes, Math.Min(ReserveLimit, Math.Max(required, bytes.Length * 2)));
        return bytes.AsMemory(written);
    }
    public Span<byte> GetSpan(int sizeHint = 0) => GetMemory(sizeHint).Span;
}
