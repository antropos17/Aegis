using System.Buffers.Binary;
using System.Text;
using System.Text.Json;

namespace Aegis.EtwLifecycle;

internal sealed record Envelope(string t, string proto, string launchId, string sessionId, string seq, JsonElement data);
internal sealed class FileWire(string launch, string session)
{
    internal const string Protocol = "etw-file/2", Profile = "home-26200-diagnostic-v1";
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
    internal async Task<Envelope> Read(Stream stream, bool control, CancellationToken token)
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
        return frame with { data = frame.data.Clone() };
    }
    internal async Task Write(Stream stream, string kind, object data, CancellationToken token)
    {
        await Forward(stream, new Envelope(kind, Protocol, launch, session, (++sent).ToString(), JsonSerializer.SerializeToElement(data)), token);
    }
    internal static async Task Forward(Stream stream, Envelope message, CancellationToken token)
    {
        byte[] bytes = JsonSerializer.SerializeToUtf8Bytes(message);
        if (bytes.Length > Limit) throw new InvalidDataException();
        byte[] header = new byte[4]; BinaryPrimitives.WriteInt32LittleEndian(header, bytes.Length);
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(token);
        deadline.CancelAfter(TimeSpan.FromSeconds(5));
        await stream.WriteAsync(header, deadline.Token);
        await stream.WriteAsync(bytes, deadline.Token);
        await stream.FlushAsync(deadline.Token);
    }
}
