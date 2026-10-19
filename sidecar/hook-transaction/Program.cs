using System.Diagnostics;
using System.Text.Json;

namespace Aegis.HookTransaction;

internal static class Program
{
    private static int Main(string[] args)
    {
        if (args.Length != 0 || !OperatingSystem.IsWindows() || Debugger.IsAttached) return 2;
        using var transaction = new Transaction();
        using var input = Console.OpenStandardInput();
        using var output = Console.OpenStandardOutput();
        var clock = Stopwatch.StartNew();
        int expectedId = 1;
        try
        {
            while (expectedId <= 128 && clock.ElapsedMilliseconds < 180000)
            {
                byte[]? frame = Wire.Read(input);
                if (frame is null) return 0;
                int id = 0;
                try
                {
                    using var doc = JsonDocument.Parse(frame, new JsonDocumentOptions { MaxDepth = 8 });
                    var request = doc.RootElement;
                    if (!request.GetProperty("id").TryGetInt32(out id) || id != expectedId)
                        throw new InvalidDataException();
                    var result = transaction.Dispatch(request, id);
                    Wire.Write(output, result);
                    expectedId++;
                }
                catch { if (id == expectedId) Wire.Write(output, new { id, ok = false }); return 2; }
                finally { Array.Clear(frame); }
            }
        }
        catch { /* Fixed exit only: no exceptions or private data reach diagnostic streams. */ }
        return 2;
    }
}
