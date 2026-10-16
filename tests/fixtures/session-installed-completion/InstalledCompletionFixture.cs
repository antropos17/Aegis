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
            else Run(args[0], args[1], args);
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
    private static string Quote(string argument)
    {
        CallerNative.Require(argument.IndexOf('"') < 0 && !argument.EndsWith("\\", StringComparison.Ordinal));
        return "\"" + argument + "\"";
    }
    private static void ProduceGui(string root, string[] args)
    {
        CallerNative.Require(args.Length == 6);
        string policyPath = Path.Combine(root, "owner-policy.json"), operationPath = Path.Combine(root, "registered-operation.json");
        string priorHash = CompositionFiles.Hash(policyPath), policy = FixedOperationRecords.Text(policyPath);
        using (var original = new EnrollmentNative().Open(root, true))
            FixedOperationRecords.Save(policyPath, policy.Substring(0, policy.Length - 1) +
                ",\"rootVolumeSerial\":\"" + original.Volume + "\",\"rootFileId\":\"" + original.FileId + "\"}");
        FixedOperationRecords.Save(operationPath, FixedOperationRecords.Text(operationPath).Replace(priorHash, CompositionFiles.Hash(policyPath)));
        string[] records = { "enrollment.json", "main-registration.json", "owner-policy.json", "registered-operation.json", "inventory.json", "fixed-fixture.json" };
        string[] before = Array.ConvertAll(records, name => CompositionFiles.Hash(Path.Combine(root, name)));
        string script = Path.Combine(args[2], "tests", "fixtures", "protected-installation", "vm-record-producer-fixture.ps1");
        var start = new ProcessStartInfo("powershell.exe", "-NoProfile -NonInteractive -File " + Quote(script) +
            " -Scratch " + Quote(root) + " -VmId 11111111-2222-4333-8444-555555555555 -IdentityHash " + new string('a', 64) +
            " -StorageHash " + new string('b', 64) + " -CompatibilityMode gui-inspection -GuiAssembly " + Quote(args[3]) +
            " -GuiSource " + Quote(args[4]) + " -GuiManifest " + Quote(args[5]));
        start.UseShellExecute = false; start.CreateNoWindow = true; start.RedirectStandardOutput = true; start.RedirectStandardError = true;
        using (var producer = Process.Start(start))
        {
            var output = producer.StandardOutput.ReadToEndAsync(); var error = producer.StandardError.ReadToEndAsync();
            if (!producer.WaitForExit(10000)) { producer.Kill(); producer.WaitForExit(); throw new Exception("gui-producer-deadline"); }
            if (producer.ExitCode != 0 || error.Result.Length != 0) throw new Exception("gui-producer-failed: " + output.Result + error.Result);
            CallerNative.Require(output.Result.Contains("\"produced\":true"));
        }
        for (int index = 0; index < records.Length; index++)
            CallerNative.Require(before[index] == CompositionFiles.Hash(Path.Combine(root, records[index])));
        CallerNative.Require(Directory.Exists(Path.Combine(root, "GuiBundle")) && File.Exists(Path.Combine(root, "registered-gui-candidate.json")));
    }
    private static void Run(string mode, string directory, string[] args)
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
        FixedOperationRecords.Write(root, mode);
        bool gui = mode == "gui-present";
        if (gui) ProduceGui(root, args);
        string guiRecordHash = gui ? CompositionFiles.Hash(Path.Combine(root, "registered-gui-candidate.json")) : null;
        string[] guiFiles = gui ? Directory.GetFiles(Path.Combine(root, "GuiBundle"), "*", SearchOption.AllDirectories) : new string[0];
        string[] guiHashes = Array.ConvertAll(guiFiles, CompositionFiles.Hash);
        File.WriteAllLines(Path.Combine(root, "fixture-config.txt"), new[] { gui ? "positive" : mode, control });
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
                string observed = File.ReadAllText(Path.Combine(control, "server-observation.json"));
                if (gui)
                {
                    CallerNative.Require(guiRecordHash == CompositionFiles.Hash(Path.Combine(root, "registered-gui-candidate.json")));
                    CallerNative.Require(Directory.GetFiles(Path.Combine(root, "GuiBundle"), "*", SearchOption.AllDirectories).Length == guiFiles.Length);
                    for (int index = 0; index < guiFiles.Length; index++) CallerNative.Require(guiHashes[index] == CompositionFiles.Hash(guiFiles[index]));
                    observed = observed.TrimEnd('}') + ",\"guiCandidateProduced\":true,\"guiBytesPreserved\":true,\"inspectionBytesPreserved\":true,\"guiPrincipalAndProtectionModeled\":true,\"guiEnrollment\":false}";
                }
                Console.WriteLine(observed);
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
