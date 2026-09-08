using System.Diagnostics;
using System.Security.Cryptography;
using System.Text.Json;

namespace Aegis.EtwLifecycle;

internal static class Program
{
    internal static readonly JsonSerializerOptions Json = new() { WriteIndented = true };
    internal static string Executable => Environment.ProcessPath is { } path &&
        Path.GetFileName(path).Equals("EtwLifecycle.exe", StringComparison.OrdinalIgnoreCase)
        ? path : throw new InvalidOperationException("apphost-required");

    public static async Task<int> Main(string[] args)
    {
        try
        {
            if (!OperatingSystem.IsWindows()) throw new PlatformNotSupportedException();
            if (args.Length == 0 || args[0] == "--help")
            {
                Console.WriteLine("Isolated ETW lifecycle experiment; no file provider or Electron connection.\n" +
                    "self-test\ncheck <new-output-directory> (normal token, no ETW/UAC)\n" +
                    "uac <new-output-directory> (normal terminal, one UAC; empty ETW session)\n" +
                    "uac-failures <new-output-directory> (four UAC launches; empty sessions, stop/EOF/lease/blocked write)");
                return 0;
            }
            if (args[0] == "self-test" && args.Length == 1) return await SelfTest.Run();
            if (args[0] == "peer") return await Peer.Run(args);
            if (args[0] == "broker") return await Broker.Run(args);
            if (args[0] == "rogue") return await SelfTest.Rogue(args);
            if (args.Length != 2 || args[0] is not ("check" or "uac" or "uac-failures")) throw new ArgumentException();
            if (Security.Current().Elevated)
            {
                Console.Error.WriteLine("Use a normal PowerShell terminal. No run was started.");
                return 3;
            }
            var output = Path.GetFullPath(args[1]);
            if (Path.Exists(output)) throw new IOException();
            Directory.CreateDirectory(output);
            var started = DateTimeOffset.UtcNow;
            bool live = args[0] != "check";
            var outcomes = new List<object>();
            int result = 0;
            using var abort = new CancellationTokenSource();
            ConsoleCancelEventHandler cancel = (_, e) => { e.Cancel = true; abort.Cancel(); };
            Console.CancelKeyPress += cancel;
            try
            {
                foreach (var scenario in args[0] == "uac-failures" ? new[] { "stop", "parent-eof", "lease", "blocked-write" } : live ? new[] { "stop" } :
                    new[] { "stop", "parent-eof", "broker-kill", "peer-exit", "peer-kill", "lease", "blocked-write", "launch-denied" })
                {
                    var outcome = await Scenarios.Run(live, scenario, abort.Token);
                    outcomes.Add(outcome);
                    if (!outcome.Passed) { result = 2; break; }
                }
            }
            catch (Exception error)
            {
                outcomes.Add(new { Passed = false, Error = ErrorCode(error) });
                result = 2;
            }
            finally { Console.CancelKeyPress -= cancel; }
            Write(output, "result.json", new
            {
                schema = 2,
                experiment = "etw-lifecycle",
                liveEmptySession = live,
                fileProviderEnabled = false,
                started,
                ended = DateTimeOffset.UtcNow,
                os = Environment.OSVersion.VersionString,
                framework = Environment.Version.ToString(),
                executableSha256 = Hash(Executable),
                assemblySha256 = Hash(typeof(Program).Assembly.Location),
                outcomes,
                exitCode = result
            });
            Console.WriteLine(result == 0 ? "Lifecycle checks passed; result.json saved." : "Lifecycle check failed; result.json retained.");
            return result;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine($"Lifecycle failure: {ErrorCode(error)} ({error.GetType().Name}, 0x{error.HResult:X8})");
            return 2;
        }
    }

    internal static string ErrorCode(Exception error) => error switch
    {
        OperationCanceledException or TimeoutException => "timeout",
        EndOfStreamException => "eof",
        UnauthorizedAccessException => "access-denied",
        System.ComponentModel.Win32Exception e when e.NativeErrorCode == 1223 => "uac-denied",
        System.ComponentModel.Win32Exception => "win32-failed",
        _ => "validation-failed"
    };

    internal static ProcessStartInfo Child(params string[] args)
    {
        var info = new ProcessStartInfo(Executable)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        foreach (var argument in args) info.ArgumentList.Add(argument);
        return info;
    }

    internal static string Hash(string path)
    {
        using var file = File.OpenRead(path);
        return Convert.ToHexString(SHA256.HashData(file));
    }

    internal static void Write(string root, string name, object data)
    {
        using var file = new FileStream(Path.Combine(root, name), FileMode.CreateNew, FileAccess.Write);
        JsonSerializer.Serialize(file, data, Json);
    }
}
