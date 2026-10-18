using System.Buffers.Binary;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Aegis.EtwLifecycle;

internal sealed record FileGuardHello(int pid, string birth, string guid);
internal sealed record FileGuardCommand(string kind, string? handle = null, string? guid = null);
internal sealed record FileFallbackReservation(string guid, int guardPid, string guardBirth);
internal sealed record FileGuardResult(string kind, bool stopped, bool absent, FileStats? counters, int? collectorExit,
    string asOfQpc = "0", int? guardExit = null);

// Private mutually authenticated channels only. No raw control handle reaches main,
// stdout, logs or a path on disk. All packets and waits have a fixed finite budget.
internal static class FileGuardWire
{
    private static readonly JsonSerializerOptions Options = new()
    { MaxDepth = 8, UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow };
    internal static async Task Write<T>(Stream stream, T value, CancellationToken token)
    {
        byte[] bytes = JsonSerializer.SerializeToUtf8Bytes(value, Options);
        if (bytes.Length is 0 or > 2048) throw new InvalidDataException();
        byte[] header = new byte[4]; BinaryPrimitives.WriteInt32LittleEndian(header, bytes.Length);
        await stream.WriteAsync(header, token); await stream.WriteAsync(bytes, token); await stream.FlushAsync(token);
    }
    internal static async Task<T> Read<T>(Stream stream, CancellationToken token)
    {
        byte[] header = new byte[4]; await stream.ReadExactlyAsync(header, token);
        int length = BinaryPrimitives.ReadInt32LittleEndian(header);
        if (length is <= 0 or > 2048) throw new InvalidDataException();
        byte[] body = new byte[length]; await stream.ReadExactlyAsync(body, token);
        using var json = JsonDocument.Parse(body, new JsonDocumentOptions { MaxDepth = 8 });
        FileWire.Shape(json.RootElement, typeof(T).GetProperties().Select(p => p.Name).ToArray());
        return json.RootElement.Deserialize<T>(Options) ?? throw new InvalidDataException();
    }
}
