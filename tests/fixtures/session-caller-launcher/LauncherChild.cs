using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using Microsoft.Win32.SafeHandles;

internal static class LauncherChild
{
    private static int Main(string[] args)
    {
        try
        {
            if (args.Length == 1 && args[0] == "--controlled-environment") return ControlledEnvironment();
            string root = Environment.GetEnvironmentVariable("AEGIS_LAUNCH_MARKERS");
            if (Environment.GetEnvironmentVariable("AEGIS_LAUNCH_ROLE") == "descendant")
            {
                File.WriteAllText(Path.Combine(root, "descendant.pid"), Process.GetCurrentProcess().Id.ToString());
                Thread.Sleep(Timeout.Infinite); return 0;
            }
            bool matched = false, wrote = false;
            string identity = "unavailable";
            using (var candidate = new SafeFileHandle(new IntPtr(long.Parse(
                Environment.GetEnvironmentVariable("AEGIS_LAUNCH_SENTINEL"))), false))
            {
                LauncherObservation.FileInfo info;
                if (LauncherObservation.GetFileInformationByHandle(candidate, out info))
                {
                    identity = info.Identity;
                    matched = identity == Environment.GetEnvironmentVariable("AEGIS_LAUNCH_SENTINEL_ID");
                    // Only write after matching the actual outside file identity; a recycled
                    // numeric handle to another object is never treated as sentinel access.
                    if (matched)
                    {
                        byte[] bytes = new byte[] { 65, 67, 67, 69, 83, 83 }; uint written;
                        wrote = LauncherObservation.WriteFile(candidate, bytes, (uint)bytes.Length, out written,
                            IntPtr.Zero) && written == bytes.Length;
                    }
                }
            }
            File.WriteAllText(Path.Combine(root, "access.json"), "{\"matched\":" +
                matched.ToString().ToLowerInvariant() + ",\"wrote\":" + wrote.ToString().ToLowerInvariant() +
                ",\"candidateIdentity\":\"" + identity + "\"}");
            var start = new ProcessStartInfo(Process.GetCurrentProcess().MainModule.FileName);
            start.UseShellExecute = false; start.CreateNoWindow = true;
            start.EnvironmentVariables["AEGIS_LAUNCH_ROLE"] = "descendant";
            using (Process descendant = Process.Start(start))
            {
                LauncherObservation.Until(() => File.Exists(Path.Combine(root, "descendant.pid")), "descendant-marker");
                File.WriteAllText(Path.Combine(root, "root.pid"), Process.GetCurrentProcess().Id.ToString());
                if (Environment.GetEnvironmentVariable("AEGIS_LAUNCH_MODE") == "natural") return 0;
                Thread.Sleep(Timeout.Infinite); return 0;
            }
        }
        catch (Exception error) { Console.Error.WriteLine(error.Message); return 1; }
    }
    private static string TextHash(string value)
    {
        using (var hash = System.Security.Cryptography.SHA256.Create())
            return BitConverter.ToString(hash.ComputeHash(System.Text.Encoding.UTF8.GetBytes(value)))
                .Replace("-", "").ToLowerInvariant();
    }
    private static int ControlledEnvironment()
    {
        var values = Environment.GetEnvironmentVariables();
        bool exactKeys = values.Count == 3 && values.Contains("PATH") && values.Contains("SystemRoot") && values.Contains("SystemDrive");
        string system = Environment.SystemDirectory;
        bool trusted = String.Equals(Environment.GetEnvironmentVariable("PATH"), system, StringComparison.Ordinal) &&
            String.Equals(Environment.GetEnvironmentVariable("SystemRoot"), Directory.GetParent(system).FullName, StringComparison.Ordinal) &&
            String.Equals(Environment.GetEnvironmentVariable("SystemDrive"), Path.GetPathRoot(system).TrimEnd('\\'), StringComparison.Ordinal);
        string common = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
        string controlledRoot = Path.Combine(common, "AEGIS", "ProtectedSession");
        string receipt = Path.Combine(Path.GetDirectoryName(Process.GetCurrentProcess().MainModule.FileName),
            "controlled-root-" + Process.GetCurrentProcess().Id + ".txt");
        // Only finite shape/allowlist observations and exact-string digests leave the child.
        File.WriteAllLines(receipt, new[] {
            "controlled-environment-1", exactKeys.ToString().ToLowerInvariant(), trusted.ToString().ToLowerInvariant(),
            (Environment.GetEnvironmentVariable("AEGIS_LAUNCH_ENV_SENTINEL") == null).ToString().ToLowerInvariant(),
            Path.IsPathRooted(common).ToString().ToLowerInvariant(), TextHash(common),
            Path.IsPathRooted(controlledRoot).ToString().ToLowerInvariant(), TextHash(controlledRoot)
        });
        return 0;
    }
}
