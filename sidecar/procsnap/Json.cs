using System.Text;

/// <summary>
/// Just enough JSON for one request shape and one response shape.
///
/// Hand-rolled on purpose: .NET Framework 4.8 has no System.Text.Json, and pulling a
/// serialiser in would mean shipping a dependency for a sidecar whose entire job is
/// to be small. Writing it by hand also makes the one rule that matters explicit —
/// 64-bit values are emitted as decimal STRINGS, never as JSON numbers, because the
/// JavaScript side would silently round them and a rounded witness compares equal
/// across generations.
/// </summary>
public static class Json {
    /// <summary>Append a JSON string literal, escaped per RFC 8259.</summary>
    public static void AppendString(StringBuilder sb, string value) {
        sb.Append('"');
        if (value != null) {
            for (int i = 0; i < value.Length; i++) {
                char c = value[i];
                switch (c) {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\b': sb.Append("\\b"); break;
                    case '\f': sb.Append("\\f"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20 || c == 0x7F) sb.Append("\\u").Append(((int)c).ToString("x4"));
                        else sb.Append(c);
                        break;
                }
            }
        }
        sb.Append('"');
    }

    /// <summary>
    /// Read a top-level string field. Deliberately simple — the only requests this
    /// sidecar ever receives come from proc-snapshot-client.js, and anything it
    /// cannot read becomes an err frame rather than an exception.
    /// </summary>
    public static string ReadStringField(string text, string name) {
        int at = IndexOfKey(text, name);
        if (at < 0) return null;
        int i = SkipToValue(text, at);
        if (i < 0 || i >= text.Length || text[i] != '"') return null;
        i++;
        StringBuilder sb = new StringBuilder();
        while (i < text.Length && text[i] != '"') {
            if (text[i] == '\\' && i + 1 < text.Length) i++;
            sb.Append(text[i]);
            i++;
        }
        return sb.ToString();
    }

    /// <summary>Read a top-level non-negative integer field, or -1.</summary>
    public static long ReadNumberField(string text, string name) {
        int at = IndexOfKey(text, name);
        if (at < 0) return -1;
        int i = SkipToValue(text, at);
        if (i < 0) return -1;
        long value = 0;
        bool any = false;
        while (i < text.Length && text[i] >= '0' && text[i] <= '9') {
            value = value * 10 + (text[i] - '0');
            any = true;
            i++;
            if (value > 4503599627370496L) return -1;
        }
        return any ? value : -1;
    }

    /// <summary>An error response for one request id.</summary>
    public static string ErrorFrame(long id, string code, string detail) {
        StringBuilder sb = new StringBuilder(128);
        sb.Append("{\"t\":\"err\",\"id\":").Append(id).Append(",\"code\":");
        AppendString(sb, code);
        sb.Append(",\"detail\":");
        AppendString(sb, detail);
        sb.Append('}');
        return sb.ToString();
    }

    private static int IndexOfKey(string text, string name) {
        return text.IndexOf("\"" + name + "\"");
    }

    private static int SkipToValue(string text, int keyAt) {
        int i = text.IndexOf(':', keyAt);
        if (i < 0) return -1;
        i++;
        while (i < text.Length && (text[i] == ' ' || text[i] == '\t')) i++;
        return i;
    }
}
