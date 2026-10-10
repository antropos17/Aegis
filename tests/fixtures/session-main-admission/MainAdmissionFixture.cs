using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using Microsoft.Win32.SafeHandles;
using Aegis.ProtectedSession;

internal static class MainAdmissionFixture
{
    private static int Main(string[] args)
    {
        string image = typeof(MainAdmissionFixture).Assembly.Location, name = Path.GetFileName(image), root = Path.GetDirectoryName(image);
        try
        {
            if (name == "aegis-session.exe") Server(root);
            else if (name == "aegis-main.exe" || name == "aegis-unlisted.exe") MainClientFixture.Run(root);
            else Run(args[0], args[1]);
            return 0;
        }
        catch (Exception error)
        {
            if (name == "aegis-session.exe") MainFixtureTransport.Save(Path.Combine(root, "server-error.txt"), error.ToString());
            else if (name == "aegis-main.exe" || name == "aegis-unlisted.exe") File.WriteAllText(Path.Combine(root, "client-error.txt"), error.ToString());
            else Console.Error.WriteLine(error);
            return 1;
        }
    }
    private static void Run(string mode, string directory)
    {
        string root = Path.Combine(directory, "installed"), control = Path.Combine(directory, "control");
        Directory.CreateDirectory(root); Directory.CreateDirectory(control);
        foreach (string name in new[] { "aegis-session.exe", "aegis-main.exe", "aegis-unlisted.exe" })
            File.Copy(typeof(MainAdmissionFixture).Assembly.Location, Path.Combine(root, name));
        MainFixtureTransport.WriteRecords(root, mode);
        File.WriteAllLines(Path.Combine(root, "fixture-config.txt"), new[] { mode, control });
        File.WriteAllText(Path.Combine(root, "fixture-route.txt"), "");
        var native = new CallerLauncherNative();
        using (var created = native.Create(Path.Combine(root, "aegis-session.exe")))
        {
            try
            {
                IntPtr queryJob = MainFixtureTransport.DuplicateTo(created.Job, created.Process, 4);
                File.WriteAllText(Path.Combine(root, "fixture-job.txt"), queryJob.ToInt64().ToString());
                CallerNative.Require(CallerLauncherNative.ResumeThread(created.Thread) == 1);
                MainFixtureTransport.Until(() => File.Exists(Path.Combine(control, "server-observation.json")) || File.Exists(Path.Combine(root, "server-error.txt")));
                if (File.Exists(Path.Combine(root, "server-error.txt"))) throw new InvalidOperationException(File.ReadAllText(Path.Combine(root, "server-error.txt")));
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
    private static void Server(string root)
    {
        string[] config = File.ReadAllLines(Path.Combine(root, "fixture-config.txt"));
        string mode = config[0], control = config[1];
        bool admitted = false, refused = false, stopped = false, borrowedUsable = false, earlyAssociationRefused = false;
        bool metadataApplied = false, laterRefused = false; int effects = 0;
        using (var self = Process.GetCurrentProcess())
        using (var queryJob = new SafeFileHandle(new IntPtr(Int64.Parse(File.ReadAllText(Path.Combine(root, "fixture-job.txt")))), true))
        using (var files = new CompositionFiles(root))
        {
        files.BlockRoot = false;
        if (mode == "strict-root")
        {
            bool rejected = false;
            try { using (var strict = EnrollmentLease.Acquire(root, self.Handle, queryJob.DangerousGetHandle())) { strict.CheckCurrent(); } }
            catch (InvalidDataException) { rejected = true; }
            MainFixtureTransport.Save(Path.Combine(control, "server-observation.json"), "{\"enrollmentRejected\":" + rejected.ToString().ToLowerInvariant() +
                ",\"childCreated\":false,\"effects\":0,\"protectedDescriptorsModeled\":false}");
            return;
        }
        using (var lease = EnrollmentLease.AcquireForTest(root, self.Handle, queryJob.DangerousGetHandle(), files))
        using (var server = new CallerRegistration(self.Handle, new string('a', 32)))
        using (var main = new CallerLauncherNative().Create(Path.Combine(root, mode == "unlisted" ? "aegis-unlisted.exe" : "aegis-main.exe")))
        {
            CallerMainOperation operation = null;
            try
            {
                if (mode == "server-held-gate")
                {
                    earlyAssociationRefused = HeldGateRefusal(lease, server, main.Process.DangerousGetHandle(), files);
                    throw new InvalidOperationException("fixture-association-observed");
                }
                if (mode == "server-replacement" || mode == "server-reversed")
                {
                    lease.BindServer(server);
                    using (var substitute = mode == "server-replacement" ? new CallerRegistration(self.Handle, server.Session) :
                        CallerRegistration.RegisterMain(main.Process.DangerousGetHandle(), server))
                    using (var unexpected = CallerMainOperation.AcquireForTest(lease, substitute, main.Process.DangerousGetHandle(), files))
                        throw new Exception("fixture-substitute-server-accepted");
                }
                operation = CallerMainOperation.AcquireForTest(lease, server, main.Process.DangerousGetHandle(), files);
                using (var heldServer = CallerNative.Duplicate(self.Handle))
                {
                    IntPtr remote = MainFixtureTransport.DuplicateTo(heldServer, main.Process, 0x00101000);
                    File.WriteAllLines(Path.Combine(root, "fixture-route.txt"), new[] { control, operation.Labels.Locator, operation.Labels.Session,
                        operation.Labels.Generation, mode, remote.ToInt64().ToString(), mode == "legacy-frame" ? "legacy" : "main" });
                }
                CallerNative.Require(CallerLauncherNative.ResumeThread(main.Thread) == 1);
                var context = operation.Accept(1000); admitted = true;
                if (mode == "lease-revoked") lease.Revoke();
                if (mode == "server-revoked") server.Dispose();
                if (mode == "owner-revoked") operation.Dispose();
                if (mode == "main-exit") CallerLauncherNative.Stop(main);
                if (mode == "duplicate-admission") operation.Accept(1000);
                if (mode == "role-metadata" || mode == "inventory-metadata")
                {
                    string selected = Path.Combine(root, mode == "role-metadata" ? "main-registration.json" : "inventory.json");
                    FileAttributes before = File.GetAttributes(selected);
                    File.SetAttributes(selected, before ^ FileAttributes.Hidden);
                    metadataApplied = File.GetAttributes(selected) != before;
                    CallerNative.Require(metadataApplied);
                    try { context.InspectOwned(); }
                    catch (InvalidDataException) { refused = true; }
                    catch (InvalidOperationException) { refused = true; }
                    File.SetAttributes(selected, before);
                    CallerNative.Require(File.GetAttributes(selected) == before);
                    try { context.InspectOwned(); }
                    catch (InvalidDataException) { laterRefused = true; }
                    catch (InvalidOperationException) { laterRefused = true; }
                    if (!refused || !laterRefused) throw new Exception("fixture-retained-metadata-accepted");
                    throw new InvalidOperationException("fixture-metadata-refusal-observed");
                }
                string observation = context.InspectOwned();
                File.WriteAllText(Path.Combine(control, "inspection.json"), observation); effects++;
                File.WriteAllText(Path.Combine(control, "effect-counter.txt"), effects.ToString());
            }
            catch (InvalidOperationException) { refused = true; }
            catch (InvalidDataException) { refused = true; }
            finally
            {
                if (operation != null) operation.Dispose();
                try { lease.CheckCurrent(); server.CheckCurrent(); borrowedUsable = true; }
                catch (InvalidDataException) { }
                catch (InvalidOperationException) { }
                File.WriteAllText(Path.Combine(control, "close-client.txt"), "close");
                CallerLauncherNative.Stop(main); stopped = GuestJobNative.Counts(main.Job.DangerousGetHandle()).Active == 0;
            }
            MainFixtureTransport.Save(Path.Combine(control, "server-observation.json"), "{\"admitted\":" + admitted.ToString().ToLowerInvariant() +
                ",\"refused\":" + refused.ToString().ToLowerInvariant() + ",\"effects\":" + effects + ",\"mainJobEmpty\":" + stopped.ToString().ToLowerInvariant() +
                ",\"borrowedUsable\":" + borrowedUsable.ToString().ToLowerInvariant() + ",\"earlyAssociationRefused\":" + earlyAssociationRefused.ToString().ToLowerInvariant() +
                ",\"metadataApplied\":" + metadataApplied.ToString().ToLowerInvariant() + ",\"laterRefused\":" + laterRefused.ToString().ToLowerInvariant() +
                ",\"protectedDescriptorsModeled\":true,\"legacyObservedOnly\":false}");
        }
        }
    }
    private static bool HeldGateRefusal(EnrollmentLease lease, CallerRegistration server, IntPtr main, IEnrollmentFiles files)
    {
        lease.BindServer(server);
        using (var self = Process.GetCurrentProcess())
        using (var substitute = new CallerRegistration(self.Handle, server.Session))
        using (var held = new ManualResetEvent(false))
        using (var release = new ManualResetEvent(false))
        using (var attempted = new ManualResetEvent(false))
        using (var finished = new ManualResetEvent(false))
        {
            bool refused = false;
            var blocker = new Thread(() => { lock (substitute.Gate) { held.Set(); release.WaitOne(5000); } });
            var attempt = new Thread(() =>
            {
                attempted.Set();
                try { using (var unexpected = CallerMainOperation.AcquireForTest(lease, substitute, main, files)) { } }
                catch (InvalidDataException) { refused = true; }
                catch (InvalidOperationException) { refused = true; }
                finally { finished.Set(); }
            });
            blocker.Start(); CallerNative.Require(held.WaitOne(1000)); attempt.Start(); CallerNative.Require(attempted.WaitOne(1000));
            bool early;
            try { early = finished.WaitOne(500) && refused; }
            finally { release.Set(); CallerNative.Require(blocker.Join(2000) && attempt.Join(2000)); }
            return early;
        }
    }
}
