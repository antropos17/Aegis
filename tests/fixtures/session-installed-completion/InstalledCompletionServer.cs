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
        string[] records = Array.FindAll(new[] { "enrollment.json", "main-registration.json", "inventory.json", "owner-policy.json",
            "registered-operation.json", "fixed-fixture.json" }, name => File.Exists(Path.Combine(root, name)));
        string[] before = Array.ConvertAll(records, name => CompositionFiles.Hash(Path.Combine(root, name)));
        File.WriteAllText(Path.Combine(control, "effect-counter.txt"), "0");
        var observed = new CompletionObservation();
        using (var self = Process.GetCurrentProcess())
        using (var job = new SafeFileHandle(new IntPtr(Int64.Parse(File.ReadAllText(Path.Combine(root, "fixture-job.txt")))), true))
        using (var files = new FixedOperationFiles(root, mode))
        using (var lease = EnrollmentLease.AcquireForTest(root, self.Handle, job.DangerousGetHandle(), files))
        using (var server = new CallerRegistration(self.Handle, new string('a', 32)))
        using (var main = new CallerLauncherNative().Create(Path.Combine(root, "aegis-main.exe")))
        {
            bool authorityLive = true;
            var policy = FixedOperationRecords.Policy(root);
            using (var installed = InstalledOwnerRegistration.CreateForTest(policy, server, main.Process.DangerousGetHandle(),
                delegate { CallerNative.Require(authorityLive); }))
            using (var alternate = mode == "foreign-owner" ? InstalledOwnerRegistration.CreateForTest(
                FixedOperationRecords.Policy(root), server,
                main.Process.DangerousGetHandle(), delegate { CallerNative.Require(authorityLive); }) : null)
            using (var mutation = FixedOperationMutation.Prepare(root, mode))
            using (var writePin = FixedOperationWritePin.Prepare(root, mode))
            {
                CallerMainOperation operation = null;
                try
                {
                    operation = CallerMainOperation.AcquireInstalledForTest(lease, server, main.Process.DangerousGetHandle(), files, installed);
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
                    if (mode.StartsWith("fixed-", StringComparison.Ordinal))
                        FixedOperationScenarios.Run(mode, root, context, installed, control, observed, mutation);
                    else
                        InstalledCompletionScenarios.Run(mode, context, installed, alternate, operation, control, observed,
                            delegate(bool value) { authorityLive = value; }, delegate { CallerLauncherNative.Stop(main); },
                            delegate { return admissionAge.ElapsedMilliseconds; });
                }
                catch (InvalidDataException error) { if (observed.Admitted) throw; observed.Refused = true; observed.PreAdmissionRefusal = error.ToString(); }
                catch (InvalidOperationException error) { if (observed.Admitted) throw; observed.Refused = true; observed.PreAdmissionRefusal = error.ToString(); }
                finally
                {
                    if (operation != null) operation.Dispose();
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
