using System.Diagnostics;
using System.Reflection;
using System.Security.Principal;
using System.Text.Json;
using Microsoft.Diagnostics.Tracing.Parsers;

namespace Aegis.EtwProbe;

internal static class Program
{
    internal static readonly Guid Provider = new("edd08927-9cc4-4e65-b970-c2560fb5c289");
    internal static readonly JsonSerializerOptions Json = new() { WriteIndented = true };

    public static async Task<int> Main(string[] args)
    {
        try
        {
            if (args.Length == 0 || args[0] == "--help")
            {
                Console.WriteLine("AEGIS ETW measurement probe (not a production sensor)\n" +
                    "self-test\npreflight <new-output-directory>\nstudy <new-output-directory> (normal terminal; one UAC prompt)\n" +
                    "capture <new-output-directory> [--seconds 5..120] [--scenario buffered|async|mapped|preopened|churn|idle]\n" +
                    "  [--keywords 0x1B0] [--events 10,12,13,14,15|all] [--pid-filter none|target]\n" +
                    "  [--evict close|cleanup|none] [--buffers-mb 16..256]\n" +
                    "fixture-check <new-output-directory> (no ETW, no elevation)");
                return 0;
            }
            if (args[0] == "self-test") return SelfTest.Run();
            if (args[0] == "actor") return await Fixture.Run(args);
            if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException("Windows required");
            if (args.Length < 2) throw new ArgumentException("Output directory required");
            if (args[0] is "study" or "study-check")
            {
                if (Elevated()) throw new InvalidOperationException("Study workloads must run without elevation");
                string output = NewOutput(args[1]);
                bool simulation = args[0] == "study-check";
                int result = await LoadStudy.Run(output, simulation);
                if (simulation && result == 0) StudyCheck.Verify(output);
                return result;
            }
            if (args[0] is "study-collector" or "study-collector-check")
                return await LoadStudy.Collect(args[1], args[0] == "study-collector-check");
            if (args[0] == "preflight") { Preflight(NewOutput(args[1])); return 0; }
            if (args[0] == "fixture-check") return await Capture.CheckFixtures(NewOutput(args[1]));
            if (args[0] != "capture") throw new ArgumentException("Unknown command");
            var options = Options.Parse(args);
            if (!Elevated())
            {
                Console.Error.WriteLine("ETW capture requires an administrator terminal. No session was started.");
                return 3;
            }
            return await Capture.Run(NewOutput(args[1]), options);
        }
        catch (Exception error)
        {
            // Exception messages can contain paths. Error type/code suffice for the console.
            Console.Error.WriteLine($"Probe failed: {error.GetType().Name} (0x{error.HResult:X8}).");
            return 2;
        }
    }

    internal static bool Elevated() => new WindowsPrincipal(WindowsIdentity.GetCurrent())
        .IsInRole(WindowsBuiltInRole.Administrator);

    internal static string NewOutput(string directory)
    {
        var full = Path.GetFullPath(directory);
        if (Path.Exists(full)) throw new IOException("Output must not already exist");
        Directory.CreateDirectory(full);
        return full;
    }

    internal static void Write(string directory, string name, object value)
    {
        using var stream = new FileStream(Path.Combine(directory, name), FileMode.CreateNew, FileAccess.Write);
        JsonSerializer.Serialize(stream, value, Json);
    }

    internal static void Preflight(string directory)
    {
        using var windows = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows NT\CurrentVersion");
        Write(directory, "environment.json", new
        {
            schema = 1,
            at = DateTimeOffset.UtcNow,
            os = Environment.OSVersion.VersionString,
            build = windows?.GetValue("CurrentBuild"),
            revision = windows?.GetValue("UBR"),
            edition = windows?.GetValue("EditionID"),
            displayVersion = windows?.GetValue("DisplayVersion"),
            framework = System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription,
            architecture = System.Runtime.InteropServices.RuntimeInformation.OSArchitecture.ToString(),
            logicalProcessors = Environment.ProcessorCount,
            elevated = Elevated(),
            provider = Provider,
            traceEvent = typeof(RegisteredTraceEventParser).Assembly.GetName().Version?.ToString(),
            stopwatchFrequency = Stopwatch.Frequency
        });
        // TDH reads the registered provider metadata, including templates. No trace is started.
        var manifest = RegisteredTraceEventParser.GetManifestForRegisteredProvider(Provider);
        File.WriteAllText(Path.Combine(directory, "kernel-file.manifest.xml"), manifest);
    }

    internal static ProcessStartInfo Child(params string[] arguments)
    {
        var executable = Environment.ProcessPath ?? throw new InvalidOperationException("No executable");
        var start = new ProcessStartInfo(executable)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        if (Path.GetFileNameWithoutExtension(executable).Equals("dotnet", StringComparison.OrdinalIgnoreCase))
            start.ArgumentList.Add(Assembly.GetExecutingAssembly().Location);
        foreach (var argument in arguments) start.ArgumentList.Add(argument);
        return start;
    }
}

internal sealed record Options(int Seconds, string Scenario, ulong Keywords, List<int>? Events,
    bool PidFilter, string Evict, int BuffersMb)
{
    internal static Options Parse(string[] args)
    {
        var values = new Dictionary<string, string>();
        var allowed = new[] { "--seconds", "--scenario", "--keywords", "--events", "--pid-filter", "--evict", "--buffers-mb" };
        for (int i = 2; i < args.Length; i += 2)
        {
            if (i + 1 >= args.Length || !allowed.Contains(args[i]) || !values.TryAdd(args[i], args[i + 1]))
                throw new ArgumentException("Invalid or repeated option");
        }
        string Get(string key, string fallback) => values.GetValueOrDefault(key, fallback);
        int seconds = int.Parse(Get("--seconds", "10")), buffers = int.Parse(Get("--buffers-mb", "64"));
        string scenario = Get("--scenario", "buffered"), evict = Get("--evict", "close"), filter = Get("--pid-filter", "none");
        if (seconds is < 5 or > 120 || buffers is < 16 or > 256 ||
            !Fixture.Scenarios.Contains(scenario) || !new[] { "close", "cleanup", "none" }.Contains(evict) ||
            !new[] { "none", "target" }.Contains(filter)) throw new ArgumentException("Option outside bounds");
        string keywordText = Get("--keywords", "0x1B0");
        ulong keywords = keywordText.StartsWith("0x", StringComparison.OrdinalIgnoreCase)
            ? Convert.ToUInt64(keywordText[2..], 16) : ulong.Parse(keywordText);
        if (keywords == 0) throw new ArgumentException("Explicit nonzero keyword mask required");
        string eventText = Get("--events", "10,12,13,14,15");
        var events = eventText == "all" ? null : eventText.Split(',').Select(int.Parse).Distinct().ToList();
        if (events != null && (events.Count > 64 || events.Any(e => e is < 0 or > 65535)))
            throw new ArgumentException("Invalid event IDs");
        return new(seconds, scenario, keywords, events, filter == "target", evict, buffers);
    }
}
