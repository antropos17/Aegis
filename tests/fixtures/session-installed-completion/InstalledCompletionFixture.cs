using System;
using System.Diagnostics;
using System.IO;
using Microsoft.Win32.SafeHandles;
using Aegis.ProtectedSession;

// Ordinary local processes and native pipes. Protected descriptors and installed
// authority are explicitly synthetic; this fixture never installs a service.
internal static class InstalledCompletionFixture
{
    private static int Main(string[] args)
    {
        string image = typeof(InstalledCompletionFixture).Assembly.Location;
        string root = Path.GetDirectoryName(image), name = Path.GetFileName(image);
        try
        {
            if (name == "aegis-session.exe") InstalledCompletionServer.Run(root);
            else if (name == "aegis-main.exe") InstalledCompletionClient.Run(root);
            else Run(args[0], args[1]);
            return 0;
        }
        catch (Exception error)
        {
            if (name == "aegis-session.exe") MainFixtureTransport.Save(Path.Combine(root, "server-error.txt"), error.ToString());
            else if (name == "aegis-main.exe") File.WriteAllText(Path.Combine(root, "client-error.txt"), error.ToString());
            else Console.Error.WriteLine(error);
            return 1;
        }
    }
    private static void Run(string mode, string directory)
    {
        string root = Path.Combine(directory, "installed"), control = Path.Combine(directory, "control");
        Directory.CreateDirectory(root); Directory.CreateDirectory(control);
        foreach (string name in new[] { "aegis-session.exe", "aegis-main.exe" })
            File.Copy(typeof(InstalledCompletionFixture).Assembly.Location, Path.Combine(root, name));
        MainFixtureTransport.WriteRecords(root, "positive");
        if (mode == "policy-selection")
        {
            string inventory = Path.Combine(root, "inventory.json");
            File.WriteAllText(inventory, File.ReadAllText(inventory).Replace("}]}", "},{\"id\":\"" + new string('f', 32) +
                "\",\"epoch\":\"" + new string('a', 32) + "\",\"operation\":\"inspect-owned\"}]}"));
            string role = Path.Combine(root, "main-registration.json");
            string original = File.ReadAllText(role), marker = "\"inventorySha256\":\"";
            int at = original.IndexOf(marker, StringComparison.Ordinal) + marker.Length;
            File.WriteAllText(role, original.Substring(0, at) + CompositionFiles.Hash(inventory) + original.Substring(at + 64));
        }
        File.WriteAllLines(Path.Combine(root, "fixture-config.txt"), new[] { mode, control });
        File.WriteAllText(Path.Combine(root, "fixture-route.txt"), "");
        using (var created = new CallerLauncherNative().Create(Path.Combine(root, "aegis-session.exe")))
        {
            try
            {
                IntPtr query = MainFixtureTransport.DuplicateTo(created.Job, created.Process, 4);
                File.WriteAllText(Path.Combine(root, "fixture-job.txt"), query.ToInt64().ToString());
                CallerNative.Require(CallerLauncherNative.ResumeThread(created.Thread) == 1);
                MainFixtureTransport.Until(() => File.Exists(Path.Combine(control, "server-observation.json")) || File.Exists(Path.Combine(root, "server-error.txt")));
                if (File.Exists(Path.Combine(root, "server-error.txt"))) throw new Exception(File.ReadAllText(Path.Combine(root, "server-error.txt")));
                Console.WriteLine(File.ReadAllText(Path.Combine(control, "server-observation.json")));
            }
            finally
            {
                CallerLauncherNative.Stop(created);
                CallerNative.Require(GuestJobNative.Counts(created.Job.DangerousGetHandle()).Active == 0);
                File.WriteAllText(Path.Combine(control, "supervisor-job-empty.txt"), "true");
            }
        }
    }
}
