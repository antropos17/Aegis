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
            if (args.Length == 2 && args[0] == "qualification-launcher") return await FileQualificationClient.Launcher(args[1]);
            if (args.Length == 5 && args[0] == "qualification-host") return await FileQualificationHost.Run(args);
            if (args is ["observe-custodian"]) return await FileOrphanObserver.Run();
            if (args.Length == 5 && args[0] == "custodian" && args[4] is "normal" or "denial-check" or "exit-check")
                return await FileOrphanCustodian.Run(args);
            if (args is ["lease-test-child"])
            {
                try { await Console.In.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(5)); } catch (TimeoutException) { }
                return 77; // Bounded normal-token self-test child; no ETW or UAC.
            }
            if (args.Length == 1 && args[0] is "inspect" or "inspect-elevated") return await FileInspect.Run(args);
            if (args.Length == 4 && args[0] == "inspect-peer") return await FileInspect.Run(args);
            if (args.Length == 4 && args[0] == "recover-peer") return await FileRecoveryConsent.Run(args);
            if (args.Length == 3 && args[0] is "rescue" or "rescue-denial-check") return await FileGroupRescue.Run(args);
            if (args.Length > 0 && (args[0].StartsWith("broker-group-", StringComparison.Ordinal) ||
                args[0].StartsWith("broker-orphan-", StringComparison.Ordinal) || args[0] == "broker-custodian-exit-check") &&
                (args.Length is not (5 or 6) || args[4] != "main-escrow")) return 3;
            if ((args.Length == 4 || args.Length is 5 or 6 && args[4] == "main-escrow") && args[0] is "broker" or "broker-crash-check" or "broker-prestart-check" or
                "broker-prearm-check" or "broker-guard-check" or "broker-exit-check" or
                "broker-dual-guard-check" or "broker-dual-collector-check" or "broker-dual-prearm-check" or
                "broker-dual-prestart-check" or "broker-triple-collector-check" or "broker-triple-guard-check" or
                "broker-triple-fallback-check" or "broker-triple-prearm-check" or "broker-triple-prestart-check" or
                "broker-triple-denial-check" or "broker-group-prestart-check" or "broker-group-prearm-check" or
                "broker-group-first-check" or "broker-group-triple-check" or "broker-group-denial-check" or
                "broker-orphan-prestart-check" or "broker-orphan-prearm-check" or "broker-orphan-main-check" or
                "broker-orphan-native-check" or "broker-orphan-denial-check" or "broker-custodian-exit-check" or
                "check-broker" or "check-loss-broker") return await FileBroker.Run(args);
            if (args.Length == 8 && args[0] == "guard" && args[7] is "normal" or "exit-after-arm" or "exit-with-owner") return await FileGuard.Run(args);
            if (args.Length == 8 && args[0] == "fallback" && args[7] is "normal" or "exit-with-owner" or "exit-after-reserve") return await FileFallback.Run(args);
            if ((args.Length == 10 || args.Length == 11 && args[10] == "orphan-custody") &&
                FileQualificationPolicy.Collector(args[0])) return await FileCollector.Run(args);
            if (args.Length == 8 && args[0] is "check-collector" or "check-loss-collector") return await FileCollector.Run(args);
            return 3;
        }
        catch { return FileQualificationDiagnostic.Failure; } // Finite qualification checkpoint only; no raw exception/path/SID/nonce.
    }
}
