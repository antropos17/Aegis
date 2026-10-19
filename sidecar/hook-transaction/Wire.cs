using System.Buffers.Binary;
using System.Text;
using System.Text.Json;

namespace Aegis.HookTransaction;

internal static class Wire
{
    internal const int MaxFrame = 768 * 1024;
    internal static readonly UTF8Encoding Utf8 = new(false, true);

    internal static byte[]? Read(Stream input)
    {
        byte[] prefix = new byte[4];
        int first = input.ReadByte();
        if (first == -1) return null;
        prefix[0] = (byte)first;
        input.ReadExactly(prefix.AsSpan(1));
        int length = BinaryPrimitives.ReadInt32LittleEndian(prefix);
        if (length is <= 0 or > MaxFrame) throw new InvalidDataException();
        byte[] bytes = new byte[length];
        try { input.ReadExactly(bytes); Utf8.GetCharCount(bytes); return bytes; }
        catch { Array.Clear(bytes); throw; }
    }

    internal static void Write(Stream output, object value)
    {
        byte[] body = JsonSerializer.SerializeToUtf8Bytes(value);
        try
        {
            if (body.Length > MaxFrame) throw new InvalidDataException();
            byte[] prefix = new byte[4];
            BinaryPrimitives.WriteInt32LittleEndian(prefix, body.Length);
            output.Write(prefix); output.Write(body); output.Flush();
        }
        finally { Array.Clear(body); }
    }

    internal static void Exact(JsonElement value, params string[] keys)
    {
        if (value.ValueKind != JsonValueKind.Object) throw new InvalidDataException();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in value.EnumerateObject())
            if (!keys.Contains(property.Name, StringComparer.Ordinal) || !seen.Add(property.Name))
                throw new InvalidDataException();
        if (seen.Count != keys.Length) throw new InvalidDataException();
    }

    internal static string Text(JsonElement value, string key, int max)
    {
        string text = value.GetProperty(key).GetString() ?? throw new InvalidDataException();
        if (text.Length > max) throw new InvalidDataException();
        Utf8.GetByteCount(text);
        return text;
    }

    internal static byte[] Bytes(JsonElement value, string key, int max)
    {
        string text = Text(value, key, ((max + 2) / 3) * 4);
        byte[] bytes = Convert.FromBase64String(text);
        if (bytes.Length > max || Convert.ToBase64String(bytes) != text)
        { Array.Clear(bytes); throw new InvalidDataException(); }
        return bytes;
    }
}
