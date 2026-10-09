using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using Microsoft.Win32.SafeHandles;

internal static class LauncherChild
{
    private static int Main()
    {
        try
        {
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
}
