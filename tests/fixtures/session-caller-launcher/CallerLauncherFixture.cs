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
        internal string ActualImage;
        internal bool MarkerBeforeResume;
        private readonly string route, markers;
        internal CapturingNative(string image, string directory) { route = image; markers = directory; }
        internal override Created Create(string selected)
        {
            Created created = base.Create(route ?? selected);
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
            Run(args); return 0;
        }
        catch (Exception error) { Console.Error.WriteLine(error.Message); return 1; }
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
