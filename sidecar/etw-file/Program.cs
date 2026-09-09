using System.Diagnostics;

namespace Aegis.EtwLifecycle;

internal static class Program
{
    internal static string Executable => Environment.ProcessPath ?? throw new InvalidOperationException();
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
        foreach (string arg in args) info.ArgumentList.Add(arg);
        return info;
    }
    private static async Task<int> Main(string[] args)
    {
        try
        {
            if (args is ["self-test"]) return FileTests.Run();
            if (args.Length == 4 && args[0] is "broker" or "check-broker") return await FileBroker.Run(args);
            if (args.Length == 8 && args[0] is "collector" or "check-collector") return await FileCollector.Run(args);
            return 3;
        }
        catch { return 2; } // No raw exception, path, SID or pipe nonce on either stream.
    }
}
