using System.ComponentModel;
using System.Text.Json;

namespace Aegis.EtwLifecycle;

internal sealed record FileCollectorDiagnostic(string stage, string kind, int code);

// Finite failure checkpoints for the explicitly selected local qualification path.
// No exception text, reservation, handle, identity string or file path is emitted.
internal static class FileQualificationDiagnostic
{
    internal const string CollectorVariable = "AEGIS_ETW_QUALIFICATION_COLLECTOR_DIAGNOSTICS";
    private static bool collector;
    private static string stage = "peer";
    internal static readonly string[] Stages = ["peer", "pipeline", "guard", "fallback", "custody", "hello", "authorize",
        "trace-start", "guard-arm", "capture-start", "trace-enable", "trace-query", "ready", "running", "stop"];
    internal static int Step;
    internal static bool Enabled => Environment.GetEnvironmentVariable(FileQualificationPolicy.Variable) != null;
    // Once the child reference is accepted, preserve every existing runtime exit contract.
    internal static int Failure => Enabled && Step is > 0 and < 6 ? 128 + Step : 2;
    internal static void BeginCollector()
    {
        collector = Environment.GetEnvironmentVariable(CollectorVariable) == "1";
        stage = "peer";
    }
    internal static void Stage(string value)
    {
        if (collector && Stages.Contains(value, StringComparer.Ordinal)) stage = value;
    }
    internal static void Report(Exception error, TextWriter? output = null)
    {
        if (!collector) return;
        try
        {
            var diagnostic = new FileCollectorDiagnostic(stage, error is Win32Exception ? "win32" : "hresult",
                error is Win32Exception native ? native.NativeErrorCode : error.HResult);
            (output ?? Console.Error).WriteLine(JsonSerializer.Serialize(diagnostic));
        }
        catch { } // Diagnostics never replace the original exit contract.
    }
    internal static async Task<FileCollectorDiagnostic?> Drain(TextReader input)
    {
        // Continue draining after overflow so stderr can never block collector exit.
        // Retain at most 256 characters, regardless of producer behavior.
        char[] buffer = new char[128], retained = new char[256]; int length = 0; bool overflow = false;
        try
        {
            int count;
            while ((count = await input.ReadAsync(buffer.AsMemory())) != 0)
            {
                if (length > retained.Length - count) { overflow = true; continue; }
                if (!overflow) { buffer.AsSpan(0, count).CopyTo(retained.AsSpan(length)); length += count; }
            }
            if (overflow || length == 0) return null;
            using var document = JsonDocument.Parse(new string(retained, 0, length), new JsonDocumentOptions { MaxDepth = 2 });
            var value = document.RootElement;
            FileWire.Shape(value, ["stage", "kind", "code"]);
            string? checkpoint = value.GetProperty("stage").GetString(), kind = value.GetProperty("kind").GetString();
            if (!Stages.Contains(checkpoint, StringComparer.Ordinal) || kind is not ("win32" or "hresult") ||
                !value.GetProperty("code").TryGetInt32(out int code)) return null;
            return new(checkpoint!, kind, code);
        }
        catch { return null; }
    }
}
