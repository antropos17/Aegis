using System;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using Microsoft.Win32.SafeHandles;
using Aegis.ProtectedSession;

internal static class CallerLauncherFixture
{
    private sealed class CapturingNative : CallerLauncherNative
    {
        internal SafeFileHandle Held;
        internal SafeFileHandle Job;
        internal string ActualImage;
        internal bool MarkerBeforeResume;
        private readonly string route, markers;
        internal CapturingNative(string image, string directory) { route = image; markers = directory; }
        internal override Created Create(string selected)
        {
            Created created = base.Create(route ?? selected);
            Job = created.Job;
            LauncherObservation.JobAndHandles(created.Process, created.Thread, created.Job);
            Held = Aegis.ProtectedSession.CallerNative.Duplicate(created.Process.DangerousGetHandle());
            ActualImage = LauncherObservation.Image(Held);
            // A fixed observation interval detects early-execution mutations, including
            // invalid-registration paths that must never execute even one child statement.
            System.Threading.Thread.Sleep(200);
            MarkerBeforeResume = File.Exists(Path.Combine(markers, "access.json"));
            return created;
        }
    }
    private static string Hash(string path)
    {
        using (var hash = SHA256.Create())
            return BitConverter.ToString(hash.ComputeHash(File.ReadAllBytes(path))).Replace("-", "").ToLowerInvariant();
    }
    private static int Main(string[] args)
    {
        try
        {
            if (args[0] == "owner-death") return OwnerDeath(args);
            if (args[0] == "pid-marker-race") return PidMarkerRace(args[3]);
            if (args[0] == "controlled-environment") return ControlledEnvironment(args[1]);
            if (args[0].StartsWith("deferred-", StringComparison.Ordinal)) return DeferredRelease(args);
            Run(args); return 0;
        }
        catch (Exception error) { Console.Error.WriteLine(error.Message); return 1; }
    }
    private static string TextHash(string value)
    {
        using (var hash = SHA256.Create())
            return BitConverter.ToString(hash.ComputeHash(System.Text.Encoding.UTF8.GetBytes(value)))
                .Replace("-", "").ToLowerInvariant();
    }
    private static int ControlledEnvironment(string image)
    {
        string common = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
        LauncherObservation.Require(Path.IsPathRooted(common), "parent-common-root-refused");
        string expectedRoot = Path.Combine(common, "AEGIS", "ProtectedSession");
        string oldDrive = Environment.GetEnvironmentVariable("SystemDrive");
        string oldSentinel = Environment.GetEnvironmentVariable("AEGIS_LAUNCH_ENV_SENTINEL");
        CallerLauncherNative.Created created = null; bool stopped = false;
        try
        {
            // Both untrusted parent values must be excluded from the actual native block.
            Environment.SetEnvironmentVariable("SystemDrive", "not-a-trusted-drive");
            Environment.SetEnvironmentVariable("AEGIS_LAUNCH_ENV_SENTINEL", "parent-only");
            created = new CallerLauncherNative().CreateControlledFixture(image);
            CallerLauncherNative.CheckCreated(created);
            LauncherObservation.JobAndHandles(created.Process, created.Thread, created.Job);
            string receipt = Path.Combine(Path.GetDirectoryName(image), "controlled-root-" + created.Pid + ".txt");
            System.Threading.Thread.Sleep(200);
            bool receiptBeforeResume = File.Exists(receipt);
            CallerLauncherNative.CheckCreated(created);
            LauncherObservation.Require(CallerLauncherNative.ResumeThread(created.Thread) == 1, "controlled-child-resume-refused");
            bool exited = LauncherObservation.WaitForSingleObject(created.Process, 4000) == 0;
            LauncherObservation.Require(exited && File.Exists(receipt) && new FileInfo(receipt).Length <= 4096,
                "controlled-child-receipt-refused");
            string[] rows = File.ReadAllLines(receipt);
            LauncherObservation.Require(rows.Length == 8 && rows[0] == "controlled-environment-1", "controlled-receipt-schema-refused");
            CallerLauncherNative.Stop(created); stopped = true;
            Console.WriteLine("{\"receiptBeforeResume\":" + receiptBeforeResume.ToString().ToLowerInvariant() +
                ",\"exactEnvironmentKeys\":" + (rows[1] == "true").ToString().ToLowerInvariant() +
                ",\"trustedNativeValues\":" + (rows[2] == "true").ToString().ToLowerInvariant() +
                ",\"parentSentinelAbsent\":" + (rows[3] == "true").ToString().ToLowerInvariant() +
                ",\"commonApplicationDataRooted\":" + (rows[4] == "true").ToString().ToLowerInvariant() +
                ",\"sameCommonApplicationData\":" + (rows[5] == TextHash(common)).ToString().ToLowerInvariant() +
                ",\"controlledRootRooted\":" + (rows[6] == "true").ToString().ToLowerInvariant() +
                ",\"sameControlledRoot\":" + (rows[7] == TextHash(expectedRoot)).ToString().ToLowerInvariant() +
                ",\"rootExited\":true,\"ownedJobEmpty\":true}");
            return 0;
        }
        finally
        {
            try { if (created != null) { try { if (!stopped) CallerLauncherNative.Stop(created); } finally { created.Dispose(); } } }
            finally
            {
                Environment.SetEnvironmentVariable("SystemDrive", oldDrive);
                Environment.SetEnvironmentVariable("AEGIS_LAUNCH_ENV_SENTINEL", oldSentinel);
            }
        }
    }
    private static void Run(string[] args)
    {
        string mode = args[0], image = args[1], wrong = args[2], root = args[3];
        Directory.CreateDirectory(root);
        Environment.SetEnvironmentVariable("AEGIS_LAUNCH_MARKERS", root);
        Environment.SetEnvironmentVariable("AEGIS_LAUNCH_MODE", mode);
        string outside = root + "-outside-file";
        using (SafeFileHandle sentinel = LauncherObservation.Sentinel(outside))
        {
            LauncherObservation.FileInfo info;
            LauncherObservation.Require(LauncherObservation.GetFileInformationByHandle(sentinel, out info), "sentinel-identity");
            Environment.SetEnvironmentVariable("AEGIS_LAUNCH_SENTINEL", sentinel.DangerousGetHandle().ToInt64().ToString());
            Environment.SetEnvironmentVariable("AEGIS_LAUNCH_SENTINEL_ID", info.Identity);
            var native = new CapturingNative(mode == "wrong-image" ? wrong : null, root);
            CallerLauncher.Instance instance = null;
            bool refused = false, revoked = false, natural = false, rootExited = false, descendantExited = false, pinned = false;
            try
            {
                try
                {
                    instance = CallerLauncher.Start(image, (int)new FileInfo(image).Length,
                        mode == "wrong-hash" ? new string('0', 64) : Hash(image),
                        mode == "registration-refusal" ? "invalid" : new string('a', 32), native);
                }
                catch (InvalidOperationException) { refused = true; }
                catch (InvalidDataException) { refused = true; }
                if (refused)
                {
                    rootExited = native.Held == null || LauncherObservation.WaitForSingleObject(native.Held, 4000) == 0;
                    LauncherObservation.Require(!File.Exists(Path.Combine(root, "access.json")), "refused-child-executed");
                }
                else
                {
                    LauncherObservation.ReadPid(Path.Combine(root, "root.pid"));
                    using (SafeFileHandle descendant = LauncherObservation.Hold(LauncherObservation.ReadPid(Path.Combine(root, "descendant.pid"))))
                    {
                        if (mode == "owner")
                        {
                            File.WriteAllText(Path.Combine(root, "owner-ready"), instance.Pid.ToString());
                            System.Threading.Thread.Sleep(System.Threading.Timeout.Infinite);
                        }
                        if (mode == "natural")
                        {
                            natural = LauncherObservation.WaitForSingleObject(native.Held, 4000) == 0;
                            try { instance.CheckCurrent(); } catch (InvalidOperationException) { revoked = true; }
                            LauncherObservation.Require(LauncherObservation.WaitForSingleObject(descendant, 0) == 0x102,
                                "descendant-not-retained-after-natural-root-exit");
                        }
                        else
                        {
                            instance.CheckCurrent(); instance.Registration.CheckCurrent();
                            bool writeDenied = false, renameDenied = false;
                            try { using (FileStream writer = File.Open(image, FileMode.Open, FileAccess.Write, FileShare.ReadWrite | FileShare.Delete)) { } }
                            catch (IOException) { writeDenied = true; }
                            try { File.Move(image, image + ".unexpected-rename"); }
                            catch (IOException) { renameDenied = true; }
                            pinned = writeDenied && renameDenied;
                            LauncherObservation.Require(pinned, "held-image-write-or-rename-succeeded");
                        }
                        instance.Dispose(); instance.Dispose();
                        try { instance.Registration.CheckCurrent(); } catch (InvalidOperationException) { revoked = true; }
                        rootExited = LauncherObservation.WaitForSingleObject(native.Held, 4000) == 0;
                        descendantExited = LauncherObservation.WaitForSingleObject(descendant, 4000) == 0;
                    }
                }
                LauncherObservation.Require(!native.MarkerBeforeResume && rootExited, "execution-order-or-exit");
                // Independently obtain write access only after failed-launch cleanup or
                // disposal, without writing bytes, to detect leaked image-file pins.
                using (FileStream writer = File.Open(image, FileMode.Open, FileAccess.Write,
                    FileShare.ReadWrite | FileShare.Delete)) { }
                string access = File.Exists(Path.Combine(root, "access.json")) ? File.ReadAllText(Path.Combine(root, "access.json")) : "null";
                Console.WriteLine("{\"refused\":" + Bool(refused) + ",\"created\":" + Bool(native.Held != null) +
                    ",\"rootExited\":" + Bool(rootExited) + ",\"descendantExited\":" + Bool(descendantExited) +
                    ",\"revoked\":" + Bool(revoked) + ",\"natural\":" + Bool(natural) +
                    ",\"pinned\":" + Bool(pinned) + ",\"imagePinsReleased\":true" +
                    ",\"imageMatchesSelected\":" + Bool(native.ActualImage == image) +
                    ",\"imageMatchesInjected\":" + Bool(native.ActualImage == wrong) + ",\"access\":" + access + "}");
            }
            finally { if (instance != null) instance.Dispose(); if (native.Held != null) native.Held.Dispose(); }
        }
        LauncherObservation.Require(new FileInfo(outside).Length == 0, "outside-sentinel-changed");
    }
    private static string Bool(bool value) { return value.ToString().ToLowerInvariant(); }
    private static int PidMarkerRace(string root)
    {
        string marker = Path.Combine(root, "controlled.pid");
        uint expected = (uint)Process.GetCurrentProcess().Id, observed = 0;
        Exception readerError = null;
        using (var started = new System.Threading.ManualResetEvent(false))
        using (var finished = new System.Threading.ManualResetEvent(false))
        {
            var reader = new System.Threading.Thread(() => {
                started.Set();
                try { observed = LauncherObservation.ReadPid(marker); }
                catch (Exception error) { readerError = error; }
                finally { finished.Set(); }
            });
            reader.IsBackground = true;
            bool completedBeforeClose;
            // File.WriteAllText creates a visible write handle with FileShare.Read.
            // A reader's read-only sharing cannot coexist with that writer.
            using (var writer = new FileStream(marker, FileMode.CreateNew, FileAccess.Write, FileShare.Read))
            {
                LauncherObservation.Require(File.Exists(marker), "controlled-marker-not-visible");
                reader.Start();
                LauncherObservation.Require(started.WaitOne(2000), "controlled-reader-not-started");
                completedBeforeClose = finished.WaitOne(200);
                byte[] bytes = System.Text.Encoding.UTF8.GetBytes(expected.ToString());
                writer.Write(bytes, 0, bytes.Length); writer.Flush();
            }
            LauncherObservation.Require(reader.Join(4000), "controlled-reader-not-settled");
            Console.WriteLine("{\"completedBeforeClose\":" + Bool(completedBeforeClose) +
                ",\"readerError\":" + (readerError == null ? "null" : "\"" + readerError.GetType().Name + "\"") +
                ",\"readerErrorCode\":" + (readerError == null ? "null" : (readerError.HResult & 0xffff).ToString()) +
                ",\"observedPidMatches\":" + Bool(observed == expected) + "}");
        }
        return 0;
    }
    private static int DeferredRelease(string[] args)
    {
        string image = args[1], root = args[3];
        Directory.CreateDirectory(root);
        Environment.SetEnvironmentVariable("AEGIS_LAUNCH_MARKERS", root);
        Environment.SetEnvironmentVariable("AEGIS_LAUNCH_MODE", args[0]);
        Environment.SetEnvironmentVariable("AEGIS_LAUNCH_SENTINEL", "-1");
        Environment.SetEnvironmentVariable("AEGIS_LAUNCH_SENTINEL_ID", "unavailable");
        var native = new CapturingNative(null, root);
        try
        {
            using (var instance = CallerLauncher.Prepare(image, (int)new FileInfo(image).Length,
                Hash(image), new string('a', 32), native))
            {
                // The controller needs this intervening setup interval before payload execution.
                System.Threading.Thread.Sleep(200);
                bool markerAtSetup = File.Exists(Path.Combine(root, "access.json"));
                instance.CheckCurrent();
                LauncherObservation.JobAndHandles(instance.Process, instance.Thread, native.Job);
                bool imagePinnedAtSetup = false;
                try { using (FileStream writer = File.Open(image, FileMode.Open, FileAccess.Write,
                    FileShare.ReadWrite | FileShare.Delete)) { } }
                catch (IOException) { imagePinnedAtSetup = true; }
                LauncherObservation.Require(imagePinnedAtSetup, "deferred-image-pin-missing");
                if (args[0] == "deferred-cancel" || args[0] == "deferred-revoke" ||
                    args[0] == "deferred-impersonated" || args[0] == "deferred-extra-suspend")
                {
                    bool releaseRejected = false, laterReleaseRejected = false, tokenObserved = false;
                    if (args[0] == "deferred-cancel") instance.Dispose();
                    if (args[0] == "deferred-revoke") instance.Registration.Dispose();
                    if (args[0] == "deferred-extra-suspend")
                        LauncherObservation.Require(LauncherObservation.SuspendThread(instance.Thread) == 1,
                            "fixture-initial-suspension-missing");
                    Action attempt = () => {
                        try { instance.Release(); } catch (InvalidOperationException) { releaseRejected = true; }
                    };
                    if (args[0] == "deferred-impersonated")
                        LauncherObservation.WithThreadToken(() => { tokenObserved = true; attempt(); });
                    else attempt();
                    try { instance.Release(); } catch (InvalidOperationException) { laterReleaseRejected = true; }
                    bool rootExited = LauncherObservation.WaitForSingleObject(native.Held, 4000) == 0;
                    using (FileStream writer = File.Open(image, FileMode.Open, FileAccess.Write,
                        FileShare.ReadWrite | FileShare.Delete)) { }
                    Console.WriteLine("{\"markerAtSetup\":" + Bool(markerAtSetup) +
                        ",\"markerAfterRelease\":" + Bool(File.Exists(Path.Combine(root, "access.json"))) +
                        ",\"rootExited\":" + Bool(rootExited) + ",\"releaseRejected\":" + Bool(releaseRejected) +
                        ",\"laterReleaseRejected\":" + Bool(laterReleaseRejected) +
                        ",\"threadTokenObserved\":" + Bool(tokenObserved) + ",\"imagePinsReleased\":true}");
                    return 0;
                }
                instance.Release();
                using (SafeFileHandle descendant = LauncherObservation.Hold(
                    LauncherObservation.ReadPid(Path.Combine(root, "descendant.pid"))))
                {
                    bool markerAfterRelease = File.Exists(Path.Combine(root, "access.json"));
                    bool duplicateRejected = false;
                    if (args[0] == "deferred-double")
                    {
                        try { instance.Release(); } catch (InvalidOperationException) { duplicateRejected = true; }
                        instance.CheckCurrent();
                        LauncherObservation.Require(LauncherObservation.WaitForSingleObject(native.Held, 0) == 0x102,
                            "duplicate-release-lost-owned-child");
                    }
                    instance.Dispose();
                    bool rootExited = LauncherObservation.WaitForSingleObject(native.Held, 4000) == 0;
                    bool descendantExited = LauncherObservation.WaitForSingleObject(descendant, 4000) == 0;
                    LauncherObservation.Require(rootExited && descendantExited, "deferred-owned-exit");
                    Console.WriteLine("{\"markerAtSetup\":" + Bool(markerAtSetup) +
                        ",\"markerAfterRelease\":" + Bool(markerAfterRelease) +
                        ",\"imagePinnedAtSetup\":" + Bool(imagePinnedAtSetup) +
                        ",\"duplicateRejected\":" + Bool(duplicateRejected) +
                        ",\"rootExited\":true,\"descendantExited\":true}");
                }
            }
        }
        finally { if (native.Held != null) native.Held.Dispose(); }
        return 0;
    }
    private static int OwnerDeath(string[] args)
    {
        string root = args[3]; Directory.CreateDirectory(root);
        var start = new ProcessStartInfo(Process.GetCurrentProcess().MainModule.FileName,
            "owner \"" + args[1] + "\" \"" + args[2] + "\" \"" + root + "\"");
        start.UseShellExecute = false; start.CreateNoWindow = true;
        using (Process owner = Process.Start(start))
        {
            try
            {
                uint pid = LauncherObservation.ReadPid(Path.Combine(root, "owner-ready"));
                using (SafeFileHandle child = LauncherObservation.Hold(pid))
                using (SafeFileHandle descendant = LauncherObservation.Hold(LauncherObservation.ReadPid(Path.Combine(root, "descendant.pid"))))
                {
                    LauncherObservation.Require(LauncherObservation.WaitForSingleObject(child, 0) == 0x102 &&
                        LauncherObservation.WaitForSingleObject(descendant, 0) == 0x102, "owner-children-not-live");
                    owner.Kill(); LauncherObservation.Require(owner.WaitForExit(4000), "owner-exit");
                    bool rootExited = LauncherObservation.WaitForSingleObject(child, 4000) == 0;
                    bool descendantExited = LauncherObservation.WaitForSingleObject(descendant, 4000) == 0;
                    LauncherObservation.Require(rootExited && descendantExited, "owner-death-job-closure");
                    using (FileStream writer = File.Open(args[1], FileMode.Open, FileAccess.Write,
                        FileShare.ReadWrite | FileShare.Delete)) { }
                    Console.WriteLine("{\"ownerExited\":true,\"rootExited\":true,\"descendantExited\":true}");
                }
            }
            finally { if (!owner.HasExited) { owner.Kill(); owner.WaitForExit(4000); } }
        }
        return 0;
    }
}

namespace Aegis.ProtectedSession
{
    internal partial class CallerLauncherNative
    {
        // Fixture-only entry reaches the maintained fixed-argument environment branch.
        internal Created CreateControlledFixture(string image)
        { return CreateCore(image, null, null, null, "--controlled-environment"); }
    }
}
