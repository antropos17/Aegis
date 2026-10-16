using System;
using System.Diagnostics;
using System.IO;
using Microsoft.Win32.SafeHandles;
using Aegis.ProtectedSession;

internal static class InstalledCompletionServer
{
    internal static void Run(string root)
    {
        string[] config = File.ReadAllLines(Path.Combine(root, "fixture-config.txt"));
        string mode = config[0], control = config[1];
        string[] records = { "enrollment.json", "main-registration.json", "inventory.json" };
        string[] before = Array.ConvertAll(records, name => CompositionFiles.Hash(Path.Combine(root, name)));
        File.WriteAllText(Path.Combine(control, "effect-counter.txt"), "0");
        var observed = new CompletionObservation();
        using (var self = Process.GetCurrentProcess())
        using (var job = new SafeFileHandle(new IntPtr(Int64.Parse(File.ReadAllText(Path.Combine(root, "fixture-job.txt")))), true))
        using (var files = new CompositionFiles(root) { BlockRoot = false })
        using (var lease = EnrollmentLease.AcquireForTest(root, self.Handle, job.DangerousGetHandle(), files))
        using (var server = new CallerRegistration(self.Handle, new string('a', 32)))
        using (var main = new CallerLauncherNative().Create(Path.Combine(root, "aegis-main.exe")))
        {
            bool authorityLive = true;
            var policy = InstalledOwnerPolicy.CreateForTest(mode == "policy-selection" ? new string('f', 32) : new string('c', 32),
                mode == "policy-selection" ? new string('a', 32) : mode == "policy-epoch" ? new string('f', 32) : new string('d', 32),
                mode == "policy-revision" ? 2U : 1U);
            using (var installed = InstalledOwnerRegistration.CreateForTest(policy, server, main.Process.DangerousGetHandle(),
                delegate { CallerNative.Require(authorityLive); }))
            using (var alternate = mode == "foreign-owner" ? InstalledOwnerRegistration.CreateForTest(
                InstalledOwnerPolicy.CreateForTest(new string('c', 32), new string('d', 32), 1), server,
                main.Process.DangerousGetHandle(), delegate { CallerNative.Require(authorityLive); }) : null)
            using (var operation = CallerMainOperation.AcquireInstalledForTest(lease, server, main.Process.DangerousGetHandle(), files, installed))
            {
                try
                {
                    using (var held = CallerNative.Duplicate(self.Handle))
                    {
                        IntPtr remote = MainFixtureTransport.DuplicateTo(held, main.Process, 0x00101000);
                        File.WriteAllLines(Path.Combine(root, "fixture-route.txt"), new[] { control, operation.Labels.Locator,
                            operation.Labels.Session, operation.Labels.Generation, "positive", remote.ToInt64().ToString(), "main" });
                    }
                    CallerNative.Require(CallerLauncherNative.ResumeThread(main.Thread) == 1);
                    var admissionAge = Stopwatch.StartNew();
                    var context = operation.Accept(1000); observed.Admitted = true;
                    MainFixtureTransport.Until(() => File.Exists(Path.Combine(control, "client-ready.txt")));
                    InstalledCompletionScenarios.Run(mode, context, installed, alternate, operation, control, observed,
                        delegate(bool value) { authorityLive = value; }, delegate { CallerLauncherNative.Stop(main); },
                        delegate { return admissionAge.ElapsedMilliseconds; });
                }
                finally
                {
                    File.WriteAllText(Path.Combine(control, "close-client.txt"), "close");
                    CallerLauncherNative.Stop(main);
                    observed.MainJobEmpty = GuestJobNative.Counts(main.Job.DangerousGetHandle()).Active == 0;
                }
            }
            lease.CheckCurrent(); server.CheckCurrent(); observed.BorrowedUsable = true;
        }
        for (int index = 0; index < records.Length; index++)
            CallerNative.Require(before[index] == CompositionFiles.Hash(Path.Combine(root, records[index])));
        observed.RecordsUnchanged = true;
        MainFixtureTransport.Save(Path.Combine(control, "server-observation.json"), observed.Json());
    }
}
