using Aegis.HookPrivateBackup;
using System.Diagnostics;
using System.Reflection;
using System.Security.Cryptography;

internal static class ExtraCases
{
    internal static int QuotaChild(string path)
    {
        try
        {
            if (Environment.GetEnvironmentVariable("AEGIS_OWNED_DPAPI_FIXTURE_CHILD") != "1") return 2;
            if (PrivateBackupStore.TryOpen(path, false, out var store) != BackupStatus.Success) return 1;
            using (store)
            {
                bool valid = store!.Retain([], [], out var reference) == BackupStatus.Capacity && reference is null;
                Console.WriteLine(valid ? "pass independent-process-quota" : "fixture-child-failed");
                return valid ? 0 : 1;
            }
        }
        catch { Console.WriteLine("fixture-child-failed"); return 1; }
    }

    internal static int DpapiChild(string path)
    {
        try
        {
            if (Environment.GetEnvironmentVariable("AEGIS_OWNED_DPAPI_FIXTURE_CHILD") != "1") return 2;
            using var root = new PrivateRoot(path, false);
            string file = Directory.GetFiles(path, "*.rec").Single();
            using var handle = PrivateRoot.Open(file, Native.Read | Native.ReadControl, 1);
            Native.Inspect(handle, false);
            Native.CheckPrivate(handle, false, root.Owner);
            using var stream = new FileStream(handle, FileAccess.Read);
            if (stream.Length is <= 0 or > PrivateBackupStore.MaxCiphertext) return 1;
            byte[] cipher = new byte[stream.Length]; stream.ReadExactly(cipher);
            byte[] plain = Dpapi.Transform(cipher, false);
            bool valid = plain.AsSpan(12).SequenceEqual(new byte[] { 0, 255, 0, 42, 123, 125 });
            CryptographicOperations.ZeroMemory(plain);
            Console.WriteLine(valid ? "pass independent-process-dpapi" : "fixture-child-failed");
            return valid ? 0 : 1;
        }
        catch { Console.WriteLine("fixture-child-failed"); return 1; }
    }

    internal static void Run(string fixtureRoot, HashSet<string> files, HashSet<string> dirs,
        Action<bool, string> assert, Action<string, Action> run)
    {
        run("independent-process-dpapi", () =>
        {
            string path = Path.Combine(fixtureRoot, "child");
            assert(PrivateBackupStore.TryOpen(path, true, out var store) == BackupStatus.Success, "child-create");
            dirs.Add(path); files.Add(Path.Combine(path, ".store.lock"));
            using (store) assert(store!.Retain([0, 255, 0, 42], [123, 125], out _) == BackupStatus.Success, "child-retain");
            foreach (string file in Directory.GetFiles(path)) files.Add(file);
            assert(LaunchOwnedChild(path, "--owned-dpapi-child", "pass independent-process-dpapi"), "child-dpapi");
        });

        run("independent-process-quota", () => assert(LaunchOwnedChild(Path.Combine(fixtureRoot, "quota"),
            "--owned-quota-child", "pass independent-process-quota"), "child-persistent-quota"));

        run("reparse-ancestor-root-and-record", () =>
        {
            string target = Path.Combine(fixtureRoot, "junction-target");
            Directory.CreateDirectory(target); dirs.Add(target);
            string link = Path.Combine(fixtureRoot, "owned-junction");
            // PowerShell creates a directory junction without elevation or Developer Mode changes.
            var start = new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),
                "WindowsPowerShell", "v1.0", "powershell.exe")) { UseShellExecute = false,
                CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
            start.ArgumentList.Add("-NoProfile"); start.ArgumentList.Add("-NonInteractive"); start.ArgumentList.Add("-Command");
            start.ArgumentList.Add("$ErrorActionPreference='Stop'; $null=New-Item -ItemType Junction -Path '" +
                link.Replace("'", "''") + "' -Target '" + target.Replace("'", "''") + "'; 'junction-created'");
            using (var child = Process.Start(start)!)
            {
                bool exited = child.WaitForExit(10000);
                if (!exited) { child.Kill(true); child.WaitForExit(5000); }
                assert(exited && child.ExitCode == 0 && child.StandardOutput.ReadToEnd().Trim() == "junction-created" &&
                    child.StandardError.ReadToEnd().Length == 0, "junction-created");
            }
            assert((File.GetAttributes(link) & FileAttributes.ReparsePoint) != 0, "junction-real");
            assert(PrivateBackupStore.TryOpen(link, false, out _) == BackupStatus.UnsafeStorage, "reparse-root-refused");
            assert(PrivateBackupStore.TryOpen(Path.Combine(link, "child"), true, out _) == BackupStatus.UnsafeStorage,
                "reparse-ancestor-refused");
            assert(!Directory.Exists(Path.Combine(target, "child")), "no-target-write");
            string privatePath = Path.Combine(fixtureRoot, "reparse-record");
            assert(PrivateBackupStore.TryOpen(privatePath, true, out var store) == BackupStatus.Success, "reparse-record-create");
            dirs.Add(privatePath); files.Add(Path.Combine(privatePath, ".store.lock"));
            using (store)
            {
                assert(store!.Retain([1, 2, 3], [], out var reference) == BackupStatus.Success, "reparse-record-retain");
                string record = Directory.GetFiles(privatePath, "*.rec").Single(); files.Add(record);
                string saved = record + ".owned";
                File.Move(record, saved); files.Add(saved);
                Directory.Move(link, record);
                assert(store.Read(reference, out _) != BackupStatus.Success, "reparse-record-refused");
                assert(store.Retain([4], [], out _) != BackupStatus.Success, "reparse-inventory-refused");
                Directory.Move(record, link);
                File.Move(saved, record); files.Remove(saved);
                assert(store.Read(reference, out _) == BackupStatus.Success, "reparse-record-owner-restored");
            }
            // Cleanup first refuses the reparse without following it. Only its known owner removes the link itself.
            dirs.Add(link);
            assert(!Cleanup(fixtureRoot, files, dirs), "cleanup-refuses-reparse");
            Directory.Delete(link, false); dirs.Remove(link);
            assert(Directory.Exists(target), "junction-target-preserved");
        });

        run("locked-record-and-full-storage-seam", () =>
        {
            string path = Path.Combine(fixtureRoot, "locked-record");
            assert(PrivateBackupStore.TryOpen(path, true, out var store) == BackupStatus.Success, "locked-create");
            dirs.Add(path); files.Add(Path.Combine(path, ".store.lock"));
            using (store)
            {
                assert(store!.Retain([1, 2, 3], [123, 125], out var reference) == BackupStatus.Success, "locked-retain");
                string record = Directory.GetFiles(path, "*.rec").Single(); files.Add(record);
                using (var held = new FileStream(record, FileMode.Open, FileAccess.ReadWrite, FileShare.None))
                {
                    assert(store.Read(reference, out _) == BackupStatus.StorageUnavailable, "record-lock-read");
                    assert(store.Retain([4], [], out _) == BackupStatus.StorageUnavailable, "record-lock-inventory");
                }
                // Deterministic ENOSPC-like partial-write exception; never fills the actual disk.
                store.FaultForFixture = point => { if (point == PrivateBackupStore.FaultPoint.AfterPartialWrite) throw new IOException(); };
                assert(store.Retain([4], [], out var failed) == BackupStatus.StorageUnavailable && failed is null, "full-disk-seam");
                store.FaultForFixture = null;
                foreach (string file in Directory.GetFiles(path)) files.Add(file);
                assert(Directory.GetFiles(path, "*.rec").Length == 2, "full-partial-retained");
            }
        });

        run("unknown-and-locked-cleanup-refusal", () =>
        {
            string extra = Path.Combine(fixtureRoot, "unexpected");
            File.WriteAllBytes(extra, [0]);
            assert(!Cleanup(fixtureRoot, files, dirs) && File.Exists(extra), "cleanup-unknown-retained");
            File.Delete(extra);
            string owned = files.First(File.Exists);
            using var held = new FileStream(owned, FileMode.Open, FileAccess.ReadWrite, FileShare.None);
            assert(!Cleanup(fixtureRoot, files, dirs), "cleanup-locked-retained");
        });
    }

    private static bool LaunchOwnedChild(string path, string mode, string expected)
    {
        var start = new ProcessStartInfo(Environment.ProcessPath!) { UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardOutput = true, RedirectStandardError = true };
        if (string.Equals(Path.GetFileNameWithoutExtension(Environment.ProcessPath), "dotnet", StringComparison.OrdinalIgnoreCase))
            start.ArgumentList.Add(Assembly.GetExecutingAssembly().Location);
        start.ArgumentList.Add(mode); start.ArgumentList.Add(path);
        start.Environment["AEGIS_OWNED_DPAPI_FIXTURE_CHILD"] = "1";
        using var child = Process.Start(start)!;
        bool exited = child.WaitForExit(10000);
        if (!exited) { child.Kill(true); child.WaitForExit(5000); }
        return exited && child.ExitCode == 0 && child.StandardOutput.ReadToEnd().Trim() == expected &&
            child.StandardError.ReadToEnd().Length == 0;
    }

    internal static bool Cleanup(string fixtureRoot, HashSet<string> files, HashSet<string> dirs)
    {
        var probes = new List<Microsoft.Win32.SafeHandles.SafeFileHandle>();
        try
        {
            string full = Path.GetFullPath(fixtureRoot);
            if (!dirs.Contains(full) || !Path.IsPathFullyQualified(full) || full.Length < 10) return false;
            var stack = new Stack<string>(); stack.Push(full);
            var seenFiles = new List<string>(); var seenDirs = new List<string>();
            while (stack.TryPop(out string? dir))
            {
                if (!dirs.Contains(dir) || (File.GetAttributes(dir) & FileAttributes.ReparsePoint) != 0) return false;
                seenDirs.Add(dir);
                foreach (string entry in Directory.EnumerateFileSystemEntries(dir))
                {
                    if (!Path.GetFullPath(entry).StartsWith(full + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) return false;
                    FileAttributes attrs = File.GetAttributes(entry);
                    if ((attrs & FileAttributes.ReparsePoint) != 0) return false;
                    if ((attrs & FileAttributes.Directory) != 0) { stack.Push(entry); continue; }
                    if (!files.Contains(entry)) return false;
                    // Check all files first. No deletion begins if any unknown, linked or locked object exists.
                    var probe = PrivateRoot.Open(entry, Native.Read | Native.Write | Native.ReadControl, 0);
                    probes.Add(probe); Native.Inspect(probe, false);
                    seenFiles.Add(entry);
                }
            }
            foreach (var probe in probes) probe.Dispose(); probes.Clear();
            foreach (string file in seenFiles) File.Delete(file);
            foreach (string dir in seenDirs.OrderByDescending(p => p.Length)) Directory.Delete(dir, false);
            return !Directory.Exists(full);
        }
        catch { return false; }
        finally { foreach (var probe in probes) probe.Dispose(); }
    }
}
