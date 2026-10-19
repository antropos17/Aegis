using System.Text.Json;

namespace Aegis.EtwProcess;

internal static class Program
{
    internal static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
    private static async Task<int> Main(string[] args)
    {
        try
        {
            if (args.SequenceEqual(["--self-test"]))
                Console.WriteLine(JsonSerializer.Serialize(await ProcessTests.Run(), Json));
            else if (args.SequenceEqual(["--fixture"]))
                Console.WriteLine(JsonSerializer.Serialize(ProcessTests.Frames(), Json));
            else if (args.SequenceEqual(["--metadata"]))
            {
                ProcessSchema.VerifyInstalled();
                Console.WriteLine(JsonSerializer.Serialize(new { provider = ProcessSchema.Provider,
                    pins = ProcessSchema.Pins.Select(p => new { p.Id, p.Version, p.Opcode, p.Task, p.Fingerprint }),
                    launchAllowed = false }, Json));
            }
            else return 2; // Capture is deliberately absent from the executable surface.
            return 0;
        }
        catch { Console.Error.WriteLine("process-diagnostic-failed"); return 1; }
    }
}
