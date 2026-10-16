using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
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
        bool contenderRefused = false, contenderFinishedWhileHeld = false, ownerContextPreserved = false, callerThreadsUnimpersonated = false;
        bool publicationBarrierEntered = false, publicationTimedOut = false, validFrameQueued = false;
        using (var self = Process.GetCurrentProcess())
        using (var queryJob = new SafeFileHandle(new IntPtr(Int64.Parse(File.ReadAllText(Path.Combine(root, "fixture-job.txt")))), true))
        using (var files = new CompositionFiles(root))
        using (var publicationFiles = new PublicationFiles(files, root))
        {
        files.BlockRoot = false;
        IEnrollmentFiles selectedFiles = mode == "publication-deadline" ? (IEnrollmentFiles)publicationFiles : files;
        if (mode == "strict-root")
        {
            bool rejected = false;
            try { using (var strict = EnrollmentLease.Acquire(root, self.Handle, queryJob.DangerousGetHandle())) { strict.CheckCurrent(); } }
            catch (InvalidDataException) { rejected = true; }
            MainFixtureTransport.Save(Path.Combine(control, "server-observation.json"), "{\"enrollmentRejected\":" + rejected.ToString().ToLowerInvariant() +
                ",\"childCreated\":false,\"effects\":0,\"protectedDescriptorsModeled\":false}");
            return;
        }
        using (var lease = EnrollmentLease.AcquireForTest(root, self.Handle, queryJob.DangerousGetHandle(), selectedFiles))
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
                operation = CallerMainOperation.AcquireForTest(lease, server, main.Process.DangerousGetHandle(), selectedFiles);
                using (var heldServer = CallerNative.Duplicate(self.Handle))
                {
                    IntPtr remote = MainFixtureTransport.DuplicateTo(heldServer, main.Process, 0x00101000);
                    File.WriteAllLines(Path.Combine(root, "fixture-route.txt"), new[] { control, operation.Labels.Locator, operation.Labels.Session,
                        operation.Labels.Generation, mode, remote.ToInt64().ToString(), mode == "legacy-frame" ? "legacy" : "main" });
                }
                CallerNative.Require(CallerLauncherNative.ResumeThread(main.Thread) == 1);
                var context = mode == "admission-gate-contention"
                    ? AdmissionGateContention(operation, files, control, out contenderRefused, out contenderFinishedWhileHeld, out callerThreadsUnimpersonated)
                    : mode == "publication-deadline"
                    ? PublicationDeadline(operation, publicationFiles, control, out publicationBarrierEntered, out publicationTimedOut,
                        out validFrameQueued, out callerThreadsUnimpersonated)
                    : operation.Accept(1000);
                admitted = true;
                if (mode == "admission-gate-contention") { context.CheckCurrent(); ownerContextPreserved = true; }
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
            catch (TimeoutException) { if (mode != "publication-deadline") throw; refused = true; }
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
                ",\"contenderRefused\":" + contenderRefused.ToString().ToLowerInvariant() + ",\"contenderFinishedWhileHeld\":" + contenderFinishedWhileHeld.ToString().ToLowerInvariant() +
                ",\"ownerContextPreserved\":" + ownerContextPreserved.ToString().ToLowerInvariant() + ",\"callerThreadsUnimpersonated\":" + callerThreadsUnimpersonated.ToString().ToLowerInvariant() +
                ",\"publicationBarrierEntered\":" + publicationBarrierEntered.ToString().ToLowerInvariant() + ",\"publicationTimedOut\":" + publicationTimedOut.ToString().ToLowerInvariant() +
                ",\"validFrameQueued\":" + validFrameQueued.ToString().ToLowerInvariant() +
                ",\"protectedDescriptorsModeled\":true,\"legacyObservedOnly\":false}");
        }
        }
    }
    // Forward the original native held-file behavior. The only added seam waits
    // after the already-queued actual frame has been consumed, so the barrier is
    // in the post-authentication proof check before Main context publication.
    private sealed class PublicationFiles : IEnrollmentFiles, IDisposable
    {
        private readonly IEnrollmentFiles original;
        private readonly string root;
        internal SafeFileHandle Pipe;
        internal volatile bool Armed;
        internal readonly ManualResetEvent Entered = new ManualResetEvent(false), Continue = new ManualResetEvent(false);
        internal PublicationFiles(IEnrollmentFiles files, string path) { original = files; root = path; }
        public EnrollmentHeld Open(string path, bool directory) { return new Held(this, original.Open(path, directory)); }
        private sealed class Held : EnrollmentHeld
        {
            private readonly PublicationFiles owner;
            private readonly EnrollmentHeld original;
            internal Held(PublicationFiles files, EnrollmentHeld value) { owner = files; original = value; }
            internal override string PathName { get { return original.PathName; } }
            internal override string Volume { get { return original.Volume; } }
            internal override string FileId { get { return original.FileId; } }
            internal override bool Directory { get { return original.Directory; } }
            internal override bool Reparse { get { return original.Reparse; } }
            internal override bool Protected(bool ancestor) { return original.Protected(ancestor); }
            internal override string BindingMetadata { get { return original.BindingMetadata; } }
            internal override byte[] SecurityDescriptor { get { return original.SecurityDescriptor; } }
            internal override void RequireStandaloneDisk() { original.RequireStandaloneDisk(); }
            internal override byte[] Read(int maximum) { return original.Read(maximum); }
            internal override void Recheck(bool ancestor)
            {
                original.Recheck(ancestor);
                if (owner.Armed && String.Equals(PathName, owner.root, StringComparison.OrdinalIgnoreCase))
                {
                    uint available, left;
                    CallerNative.Require(CallerNative.PeekNamedPipe(owner.Pipe, IntPtr.Zero, 0, IntPtr.Zero, out available, out left));
                    if (available == 0)
                    {
                        CallerNative.Require(!CallerNative.HasThreadToken());
                        owner.Entered.Set();
                        CallerNative.Require(owner.Continue.WaitOne(4000));
                    }
                }
            }
            public override void Dispose() { original.Dispose(); }
        }
        public void Dispose() { Continue.Set(); Entered.Dispose(); Continue.Dispose(); }
    }
    private static CallerMainOperation.Context PublicationDeadline(CallerMainOperation operation, PublicationFiles files, string control,
        out bool barrierEntered, out bool timedOut, out bool frameQueued, out bool unimpersonated)
    {
        MainFixtureTransport.Until(() => File.Exists(Path.Combine(control, "client-ready.txt")));
        var endpoint = (CallerEndpoint)typeof(CallerMainOperation).GetField("endpoint", BindingFlags.NonPublic | BindingFlags.Instance).GetValue(operation);
        files.Pipe = (SafeFileHandle)typeof(CallerEndpoint).GetField("pipe", BindingFlags.NonPublic | BindingFlags.Instance).GetValue(endpoint);
        uint available, left;
        frameQueued = CallerNative.PeekNamedPipe(files.Pipe, IntPtr.Zero, 0, IntPtr.Zero, out available, out left) && available == left && left > 4;
        CallerNative.Require(frameQueued);
        CallerMainOperation.Context context = null; Exception failure = null;
        bool expired = false, clean = false;
        Stopwatch clock = null;
        var attempt = new Thread(() => {
            try { clock = Stopwatch.StartNew(); context = operation.Accept(1000); }
            catch (TimeoutException) { expired = true; }
            catch (Exception error) { failure = error; }
            finally { clean = !CallerNative.HasThreadToken(); }
        });
        attempt.IsBackground = true; files.Armed = true; attempt.Start();
        try
        {
            barrierEntered = files.Entered.WaitOne(2000); CallerNative.Require(barrierEntered);
            // A monotonic phase checkpoint deliberately crosses the original
            // budget while the real post-auth proof check is still outstanding.
            using (var never = new ManualResetEvent(false))
                while (true)
                {
                    long remaining = 1250 - clock.ElapsedMilliseconds;
                    if (remaining <= 0) break;
                    never.WaitOne((int)remaining);
                }
        }
        finally
        {
            files.Continue.Set();
            try { CallerNative.Require(attempt.Join(3000)); } finally { files.Armed = false; }
        }
        timedOut = expired; unimpersonated = clean;
        CallerNative.Require(failure == null && clean);
        if (expired) { CallerNative.Require(context == null); throw new TimeoutException("fixture-original-publication-budget-expired"); }
        return context;
    }
    private static CallerMainOperation.Context AdmissionGateContention(CallerMainOperation operation, CompositionFiles files, string control,
        out bool contenderRefused, out bool contenderFinishedWhileHeld, out bool callerThreadsUnimpersonated)
    {
        // The real enrolled child has already connected, verified the server and
        // queued its valid frame. No startup delay consumes the tested budgets.
        MainFixtureTransport.Until(() => File.Exists(Path.Combine(control, "client-ready.txt")));
        CallerMainOperation.Context firstContext = null;
        Exception firstError = null, secondError = null;
        bool secondRefused = false, early = false, firstClean = false, secondClean = false;
        using (var firstFinished = new ManualResetEvent(false))
        using (var secondStarted = new ManualResetEvent(false))
        using (var secondFinished = new ManualResetEvent(false))
        {
            var first = new Thread(() => {
                try { firstContext = operation.Accept(2000); }
                catch (Exception error) { firstError = error; }
                finally { firstClean = !CallerNative.HasThreadToken(); firstFinished.Set(); }
            });
            var second = new Thread(() => {
                secondStarted.Set();
                try { operation.Accept(100); secondError = new Exception("fixture-contender-admitted"); }
                catch (TimeoutException) { secondRefused = true; }
                catch (Exception error) { secondError = error; }
                finally { secondClean = !CallerNative.HasThreadToken(); secondFinished.Set(); }
            });
            first.IsBackground = true; second.IsBackground = true;
            bool firstStarted = false, contenderStarted = false;
            files.Entered.Reset(); files.Continue.Reset(); files.BlockRoot = true;
            try
            {
                first.Start(); firstStarted = true;
                CallerNative.Require(files.Entered.WaitOne(1000));
                // Existing root barrier proves A holds the original operation's
                // server gate. It remains held until our explicit finally release.
                second.Start(); contenderStarted = true;
                CallerNative.Require(secondStarted.WaitOne(250));
                early = secondFinished.WaitOne(500) && !firstFinished.WaitOne(0) && !files.Continue.WaitOne(0);
            }
            finally
            {
                files.Continue.Set();
                try { if (firstStarted) CallerNative.Require(first.Join(3000)); }
                finally { try { if (contenderStarted) CallerNative.Require(second.Join(3000)); } finally { files.BlockRoot = false; } }
            }
        }
        contenderRefused = secondRefused; contenderFinishedWhileHeld = early; callerThreadsUnimpersonated = firstClean && secondClean;
        CallerNative.Require(firstError == null && secondError == null && firstContext != null && secondRefused && early && callerThreadsUnimpersonated);
        // B's failed acquisition must leave A's real endpoint/admission state
        // usable after A completes, rather than closing it through B's catch.
        firstContext.CheckCurrent();
        return firstContext;
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
