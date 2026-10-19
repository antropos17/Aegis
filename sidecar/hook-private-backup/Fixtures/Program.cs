using Aegis.HookPrivateBackup;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;

// Owned disposable fixtures only. A failure never prints exceptions, paths, SIDs, ACLs or payloads.
internal static class Program
{
    private static readonly byte[] Bytes = [0, 255, 128, 13, 10, 0, 61, 62, 63];
    private static readonly byte[] Manifest = Encoding.UTF8.GetBytes("{\"fixture\":\"Ə 日本語 😀\",\"version\":1}");
    private static int passed;
    private static string fixtureRoot = "";
    private static readonly HashSet<string> ownedFiles = new(StringComparer.OrdinalIgnoreCase);
    private static readonly HashSet<string> ownedDirs = new(StringComparer.OrdinalIgnoreCase);

    private static int Main(string[] args)
    {
        if (args.Length == 2 && args[0] == "--owned-dpapi-child") return ExtraCases.DpapiChild(args[1]);
        if (args.Length == 2 && args[0] == "--owned-quota-child") return ExtraCases.QuotaChild(args[1]);
        if (!OperatingSystem.IsWindows() || args.Length != 1) { Console.WriteLine("fixture-input-rejected"); return 2; }
        try
        {
            fixtureRoot = Path.GetFullPath(args[0]);
            if (!Path.IsPathFullyQualified(args[0]) || Directory.Exists(fixtureRoot) || File.Exists(fixtureRoot) ||
                !Directory.Exists(Path.GetDirectoryName(fixtureRoot))) throw new Exception();
            Directory.CreateDirectory(fixtureRoot);
            ownedDirs.Add(fixtureRoot);
            Run("exact-dpapi-unicode-acl", Roundtrip);
            Run("limits-and-utf8", Limits);
            Run("foreign-reference-and-reopen", Foreign);
            Run("cipher-corruption-truncation", Corruption);
            Run("record-delete-substitute-hardlink", Replacement);
            Run("root-and-ancestor-pins", RootPins);
            Run("persistent-count-and-orphans", Quota);
            Run("persistent-byte-quota", ByteQuota);
            Run("partial-write-flush-faults", Faults);
            Run("lock-and-unknown-inventory", LockAndUnknown);
            Run("unsupported-paths-and-private-existing", Unsupported);
            ExtraCases.Run(fixtureRoot, ownedFiles, ownedDirs, Assert, Run);
            Assert(Cleanup(), "cleanup-confirmed");
            Console.WriteLine($"fixture-pass cases={passed} cleanup=confirmed dpapi=real-windows");
            return 0;
        }
        catch
        {
            Console.WriteLine("fixture-failed artifacts-retained-for-owner-review");
            return 1;
        }
    }

    private static void Run(string name, Action test)
    { test(); passed++; Console.WriteLine("pass " + name); }

    private static void Assert(bool condition, string label)
    { if (!condition) { Console.WriteLine("assert-failed " + label); throw new Exception(); } }

    private static string NewPath(string name) => Path.Combine(fixtureRoot, name);
    private static PrivateBackupStore Create(string name)
    {
        string path = NewPath(name);
        Assert(PrivateBackupStore.TryOpen(path, true, out var store) == BackupStatus.Success && store is not null, "create");
        ownedDirs.Add(path);
        ownedFiles.Add(Path.Combine(path, ".store.lock"));
        return store!;
    }

    private static PrivateBackupStore.Reference Retain(PrivateBackupStore store, string name,
        byte[]? bytes = null, byte[]? manifest = null)
    {
        Assert(store.Retain(bytes ?? Bytes, manifest ?? Manifest, out var reference) == BackupStatus.Success && reference is not null, "retain");
        Track(name);
        return reference!;
    }

    private static string[] Track(string name)
    {
        string[] files = Directory.GetFiles(NewPath(name), "*.rec");
        foreach (string file in files) ownedFiles.Add(file);
        return files;
    }

    private static void Roundtrip()
    {
        using var store = Create("roundtrip");
        var reference = Retain(store, "roundtrip");
        Assert(reference.ToString() == "[private-backup-reference]", "opaque");
        Assert(store.Read(reference, out var payload) == BackupStatus.Success && payload is not null &&
            payload.Bytes.AsSpan().SequenceEqual(Bytes) && payload.ManifestUtf8.AsSpan().SequenceEqual(Manifest), "exact");
        byte[] cipher = File.ReadAllBytes(Track("roundtrip").Single());
        Assert(cipher.AsSpan().IndexOf(Manifest) < 0 && cipher.AsSpan().IndexOf(Bytes) < 0, "encrypted");
        using var root = new PrivateRoot(NewPath("roundtrip"), false);
        root.Verify(); // Handle-based owner + protected exact two-principal DACL is real, never mocked.
        var independentAcl = new DirectoryInfo(NewPath("roundtrip")).GetAccessControl();
        Assert(independentAcl.AreAccessRulesProtected && root.Owner.Equals(independentAcl.GetOwner(typeof(SecurityIdentifier))) &&
            independentAcl.GetAccessRules(true, true, typeof(SecurityIdentifier)).Count == 2, "independent-root-acl");
        using var file = PrivateRoot.Open(Track("roundtrip").Single(), Native.ReadControl | 0x80, 3);
        Native.CheckPrivate(file, false, root.Owner);
        byte[] plain = Dpapi.Transform(cipher, false);
        Assert(plain.AsSpan(12, Bytes.Length).SequenceEqual(Bytes), "independent-dpapi");
        CryptographicOperations.ZeroMemory(plain);
    }

    private static void Limits()
    {
        using var store = Create("limits");
        byte[] bytes = new byte[PrivateBackupStore.MaxBytes];
        RandomNumberGenerator.Fill(bytes);
        byte[] manifest = Enumerable.Repeat((byte)'x', PrivateBackupStore.MaxManifest).ToArray();
        var reference = Retain(store, "limits", bytes, manifest);
        Assert(store.Read(reference, out var payload) == BackupStatus.Success && payload is not null &&
            payload.Bytes.AsSpan().SequenceEqual(bytes) && payload.ManifestUtf8.AsSpan().SequenceEqual(manifest), "max-exact");
        reference = Retain(store, "limits", [], []);
        Assert(store.Read(reference, out payload) == BackupStatus.Success && payload is not null &&
            payload.Bytes.Length == 0 && payload.ManifestUtf8.Length == 0, "empty-exact");
        Assert(store.Retain(new byte[PrivateBackupStore.MaxBytes + 1], [], out _) == BackupStatus.InvalidInput, "byte-limit");
        Assert(store.Retain([], new byte[PrivateBackupStore.MaxManifest + 1], out _) == BackupStatus.InvalidInput, "manifest-limit");
        Assert(store.Retain([], [0xc0, 0xaf], out _) == BackupStatus.InvalidInput, "invalid-utf8");
        Assert(Track("limits").Length == 2, "invalid-no-files");
    }

    private static void Foreign()
    {
        var first = Create("foreign-a");
        using var second = Create("foreign-b");
        var reference = Retain(first, "foreign-a");
        Assert(second.Read(reference, out _) == BackupStatus.InvalidReference, "foreign");
        Assert(first.Read(null, out _) == BackupStatus.InvalidReference, "null-reference");
        Assert(first.Read(new PrivateBackupStore.Reference(), out _) == BackupStatus.InvalidReference, "unissued-reference");
        first.Dispose();
        Assert(first.Read(reference, out _) == BackupStatus.Disposed, "disposed");
        Assert(PrivateBackupStore.TryOpen(NewPath("foreign-a"), false, out var reopened) == BackupStatus.Success, "reopen");
        using (reopened) Assert(reopened!.Read(reference, out _) == BackupStatus.InvalidReference, "no-restart-adoption");
        byte[] plain = Dpapi.Transform(File.ReadAllBytes(Track("foreign-a").Single()), false);
        Assert(plain.AsSpan(12, Bytes.Length).SequenceEqual(Bytes), "dpapi-persists-after-dispose");
        CryptographicOperations.ZeroMemory(plain);
    }

    private static void Corruption()
    {
        using var store = Create("corrupt");
        var reference = Retain(store, "corrupt");
        string file = Track("corrupt").Single();
        byte[] cipher = File.ReadAllBytes(file);
        byte[] changed = (byte[])cipher.Clone(); changed[changed.Length / 2] ^= 0xff;
        File.WriteAllBytes(file, changed);
        Assert(store.Read(reference, out _) == BackupStatus.IntegrityFailure, "cipher-tamper");
        File.WriteAllBytes(file, cipher.AsSpan(0, cipher.Length / 2).ToArray());
        Assert(store.Read(reference, out _) == BackupStatus.IntegrityFailure, "cipher-truncate");
        File.WriteAllBytes(file, cipher);
        Assert(store.Read(reference, out _) == BackupStatus.Success, "owned-cipher-restored");
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreateHardLinkW(string link, string existing, IntPtr security);

    private static void Replacement()
    {
        using var store = Create("replace");
        var reference = Retain(store, "replace");
        string file = Track("replace").Single(), saved = file + ".owned";
        File.Move(file, saved); ownedFiles.Add(saved);
        Assert(store.Read(reference, out _) == BackupStatus.StorageUnavailable, "missing");
        // A byte-identical fresh private record still has another identity and is refused.
        using (var root = new PrivateRoot(NewPath("replace"), false))
        using (var security = new Native.PrivateSecurity(root.Owner, false))
        using (var created = security.Create(file))
        using (var stream = new FileStream(created, FileAccess.Write)) stream.Write(File.ReadAllBytes(saved));
        Assert(store.Read(reference, out _) == BackupStatus.IntegrityFailure, "same-cipher-substitute");
        File.Delete(file); File.Move(saved, file); ownedFiles.Remove(saved);
        string link = NewPath("owned-hardlink.rec");
        Assert(CreateHardLinkW(link, file, IntPtr.Zero), "hardlink-created"); ownedFiles.Add(link);
        Assert(store.Read(reference, out _) == BackupStatus.UnsafeStorage, "hardlink-refused");
        File.Delete(link); ownedFiles.Remove(link);
        Assert(store.Read(reference, out _) == BackupStatus.Success, "link-removed");
    }

    private static void RootPins()
    {
        using var store = Create("pins");
        var reference = Retain(store, "pins");
        bool rootDenied = false, ancestorDenied = false;
        try { Directory.Move(NewPath("pins"), NewPath("pins-moved")); } catch (IOException) { rootDenied = true; }
        try { Directory.Move(fixtureRoot, fixtureRoot + "-moved"); } catch (IOException) { ancestorDenied = true; }
        Assert(rootDenied && ancestorDenied, "root-ancestor-rename-denied");
        Assert(store.Read(reference, out _) == BackupStatus.Success, "pins-still-owned");
    }

    private static void Quota()
    {
        var first = Create("quota");
        for (int i = 0; i < 3; i++) Retain(first, "quota");
        Assert(PrivateBackupStore.TryOpen(NewPath("quota"), false, out var second) == BackupStatus.Success, "second-instance");
        using (second)
        {
            for (int i = 0; i < 5; i++) Retain(second!, "quota");
            Assert(first.Retain(Bytes, Manifest, out _) == BackupStatus.Capacity, "cross-instance-quota");
        }
        first.Dispose();
        Assert(PrivateBackupStore.TryOpen(NewPath("quota"), false, out var reopened) == BackupStatus.Success, "quota-reopen");
        using (reopened) Assert(reopened!.Retain(Bytes, Manifest, out _) == BackupStatus.Capacity, "orphan-quota");
        Assert(Track("quota").Length == PrivateBackupStore.MaxRecords, "count-bounded");
    }

    private static void ByteQuota()
    {
        using var store = Create("byte-quota");
        byte[] bytes = RandomNumberGenerator.GetBytes(PrivateBackupStore.MaxBytes);
        byte[] manifest = Enumerable.Repeat((byte)'m', PrivateBackupStore.MaxManifest).ToArray();
        string Inventory() => string.Join("|", Directory.GetFiles(NewPath("byte-quota"))
            .OrderBy(path => path, StringComparer.Ordinal)
            .Select(path => Path.GetFileName(path) + ":" + new FileInfo(path).Length + ":" +
                Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path)))));
        int retained = 0;
        BackupStatus terminal;
        PrivateBackupStore.Reference? refused;
        string beforeRefusal;
        do
        {
            beforeRefusal = Inventory();
            terminal = store.Retain(bytes, manifest, out refused);
            if (terminal == BackupStatus.Success) retained++;
        } while (terminal == BackupStatus.Success && retained <= PrivateBackupStore.MaxRecords);
        Track("byte-quota");
        Assert(terminal == BackupStatus.Capacity && refused is null, "byte-quota-terminal-capacity");
        Assert(Inventory() == beforeRefusal, "byte-quota-refusal-unchanged");
        Assert(retained is > 0 and < PrivateBackupStore.MaxRecords &&
            Directory.GetFiles(NewPath("byte-quota"), "*.rec").Sum(p => new FileInfo(p).Length) <= PrivateBackupStore.MaxStoredBytes,
            "aggregate-bytes-bounded");
        store.Dispose();
        Assert(PrivateBackupStore.TryOpen(NewPath("byte-quota"), false, out var reopened) == BackupStatus.Success &&
            reopened is not null, "byte-quota-reopen");
        using (reopened)
        {
            string beforeReopenedRefusal = Inventory();
            Assert(reopened!.Retain(bytes, manifest, out refused) == BackupStatus.Capacity && refused is null,
                "byte-quota-reopened-capacity");
            Assert(Inventory() == beforeReopenedRefusal, "byte-quota-reopened-refusal-unchanged");
        }
    }

    private static void Faults()
    {
        using var store = Create("faults");
        foreach (var point in Enum.GetValues<PrivateBackupStore.FaultPoint>())
        {
            store.FaultForFixture = current => { if (current == point) throw new IOException(); };
            Assert(store.Retain(Bytes, Manifest, out var reference) == BackupStatus.StorageUnavailable && reference is null, "fault-no-reference");
        }
        store.FaultForFixture = null;
        string[] partials = Track("faults");
        Assert(partials.Length == 5 && partials.Any(p => new FileInfo(p).Length == 0), "partial-retained");
        Assert(PrivateBackupStore.TryOpen(NewPath("faults"), false, out var reopened) == BackupStatus.Success, "partial-reopen");
        using (reopened)
        {
            for (int i = 0; i < 3; i++) Retain(reopened!, "faults");
            Assert(reopened!.Retain(Bytes, Manifest, out _) == BackupStatus.Capacity, "partial-counted");
        }
    }

    private static void LockAndUnknown()
    {
        using var store = Create("unknown");
        var reference = Retain(store, "unknown");
        using (var lockFile = new FileStream(Path.Combine(NewPath("unknown"), ".store.lock"), FileMode.Open, FileAccess.ReadWrite, FileShare.None))
        {
            Assert(store.Retain(Bytes, Manifest, out _) == BackupStatus.StorageUnavailable, "locked-write");
            Assert(store.Read(reference, out _) == BackupStatus.StorageUnavailable, "locked-read");
        }
        string unknown = Path.Combine(NewPath("unknown"), "unrecognized");
        File.WriteAllBytes(unknown, [1]); ownedFiles.Add(unknown);
        Assert(store.Retain(Bytes, Manifest, out _) == BackupStatus.UnsafeStorage, "unknown-refused");
        Assert(PrivateBackupStore.TryOpen(NewPath("unknown"), false, out _) == BackupStatus.UnsafeStorage, "unknown-reopen-refused");
        File.Delete(unknown); ownedFiles.Remove(unknown);
    }

    private static void Unsupported()
    {
        Assert(PrivateBackupStore.TryOpen("\\\\server\\share\\private", true, out _) == BackupStatus.Unsupported, "unc");
        Assert(PrivateBackupStore.TryOpen(NewPath("a") + ":stream", true, out _) == BackupStatus.Unsupported, "ads-path");
        Assert(PrivateBackupStore.TryOpen(NewPath("..") + "\\escape", true, out _) == BackupStatus.Unsupported, "traversal");
        string existing = NewPath("nonprivate"); Directory.CreateDirectory(existing); ownedDirs.Add(existing);
        string normalLock = Path.Combine(existing, ".store.lock"); File.WriteAllBytes(normalLock, []); ownedFiles.Add(normalLock);
        Assert(PrivateBackupStore.TryOpen(existing, true, out _) == BackupStatus.StorageUnavailable, "fresh-rejects-existing");
        Assert(PrivateBackupStore.TryOpen(existing, false, out _) == BackupStatus.UnsafeStorage, "existing-acl-refused");
    }

    private static bool Cleanup() => ExtraCases.Cleanup(fixtureRoot, ownedFiles, ownedDirs);
}
