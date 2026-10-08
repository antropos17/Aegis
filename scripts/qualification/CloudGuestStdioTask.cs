using System;
using System.IO;
using System.Security.Principal;
using System.Diagnostics;
using Aegis.ProtectedSession;

// Fixed guest consumer, compiled separately. Hosting/bootstrap wiring is deliberately pending.
// The trusted caller must pin this executable and stdio-fixed-task.cjs before release.
internal static class CloudGuestStdioTask
{
    private static int Main(string[] args)
    {
        try
        {
            if (args.Length != 0 || Environment.GetEnvironmentVariable("AEGIS_CLOUD_GUEST_TASK") != "1")
                throw new InvalidOperationException("guest-stdio-launch-refused");
            using (var process = Process.GetCurrentProcess())
                GuestJobNative.RequireStandardPrincipal(process.Handle, WindowsIdentity.GetCurrent().User.Value, process.SessionId);
            const string trusted = @"C:\ProgramData\AegisCloudLab\trusted";
            uint owner;
            if (!uint.TryParse(Environment.GetEnvironmentVariable("AEGIS_STDIO_OWNER_PID"), out owner) || owner == 0)
                throw new InvalidOperationException("guest-stdio-launch-refused");
            return CloudGuestStdioLauncher.RunFixed(Environment.GetEnvironmentVariable("AEGIS_STDIO_PREFIX"), owner,
                Path.Combine(trusted, "node.exe"), "\"" + Path.Combine(trusted, "stdio-fixed-task.cjs") + "\"", @"C:\AegisLab\work", false);
        }
        catch { return 125; }
    }
}
