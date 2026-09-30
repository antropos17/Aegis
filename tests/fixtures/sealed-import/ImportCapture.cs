using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using Microsoft.Win32.SafeHandles;

internal sealed class ImportCapture : IDisposable
{
    internal const int MaxFiles = 128, MaxDirectories = 32, MaxDepth = 8;
    internal const int MaxFileBytes = 65536, MaxBytes = 1048576, MaxManifestBytes = 65536;
    internal const string Profile = "windows-x64-ntfs-dummy-v1";
    internal sealed class PinnedDirectory
    {
        internal string Path, Relative;
        internal SafeFileHandle Handle;
        internal ImportNative.Identity Identity;
        internal List<ImportNative.Entry> Entries;
    }
    internal sealed class CapturedFile
    {
        internal string Path, Relative, Hash;
        internal ImportNative.Identity Identity;
        internal byte[] Bytes;
    }
    internal readonly List<PinnedDirectory> Ancestors = new List<PinnedDirectory>();
    internal readonly List<PinnedDirectory> Directories = new List<PinnedDirectory>();
    internal readonly List<CapturedFile> Files = new List<CapturedFile>();
    private readonly HashSet<string> fileIds = new HashSet<string>(StringComparer.Ordinal);
    internal readonly Stopwatch Clock = Stopwatch.StartNew();
    internal long TotalBytes;
    private int enumerationCalls, entryCount;
    internal static Action<string> BeforeOpenForTest = null;

    internal void Deadline()
    { ImportNative.Require(Clock.ElapsedMilliseconds < 30000, "import-time-budget"); }

    internal static string Hash(byte[] bytes)
    {
        using (SHA256 sha = SHA256.Create())
            return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
    }

    internal static List<PinnedDirectory> PinChain(string selected)
    {
        string[] parts = ImportNative.ValidatePath(selected);
        List<PinnedDirectory> result = new List<PinnedDirectory>();
        try
        {
            string at = Path.GetPathRoot(selected);
            result.Add(Pin(at, null));
            ImportNative.FixedNtfs(at, result[0].Handle);
            foreach (string part in parts) { at = Path.Combine(at, part); result.Add(Pin(at, null)); }
            return result;
        }
        catch { foreach (PinnedDirectory directory in result) directory.Handle.Dispose(); throw; }
    }

    internal static PinnedDirectory Pin(string path, string relative)
    {
        SafeFileHandle handle = ImportNative.Open(path, ImportNative.DirectoryAccess, 3, 3);
        try
        {
            ImportNative.Identity identity = ImportNative.Inspect(handle, true);
            ImportNative.NoStreams(handle, true);
            return new PinnedDirectory { Path = path, Relative = relative, Handle = handle, Identity = identity };
        }
        catch { handle.Dispose(); throw; }
    }

    internal static ImportCapture Capture(string source)
    {
        ImportCapture captured = new ImportCapture();
        try
        {
            captured.Ancestors.AddRange(PinChain(source));
            PinnedDirectory root = captured.Ancestors[captured.Ancestors.Count - 1];
            root.Relative = "";
            captured.Directories.Add(root);
            captured.Walk(root, 0);
            captured.Files.Sort(delegate(CapturedFile a, CapturedFile b) {
                return StringComparer.Ordinal.Compare(a.Relative, b.Relative); });
            captured.Directories.Sort(delegate(PinnedDirectory a, PinnedDirectory b) {
                return StringComparer.Ordinal.Compare(a.Relative, b.Relative); });
            return captured;
        }
        catch { captured.Dispose(); throw; }
    }

    private void Walk(PinnedDirectory directory, int depth)
    {
        Deadline();
        directory.Entries = ImportNative.Entries(directory.Handle, ref enumerationCalls);
        foreach (ImportNative.Entry entry in directory.Entries)
        {
            Deadline();
            ImportNative.Require(++entryCount <= MaxFiles + MaxDirectories - 1, "import-entry-budget");
            ImportNative.Require((entry.Attributes & ImportNative.Reparse) == 0, "import-reparse");
            ImportNative.Require(!Excluded(entry.Name), "import-excluded");
            ImportNative.Component(entry.Name, true);
            string relative = directory.Relative.Length == 0 ? entry.Name : directory.Relative + "/" + entry.Name;
            ImportNative.Require(relative.Length <= 240, "import-relative-path-budget");
            ImportNative.Require(depth + 1 <= MaxDepth, "import-depth-budget");
            string selected = Path.Combine(directory.Path, entry.Name);
            if (BeforeOpenForTest != null) BeforeOpenForTest(selected);
            if (entry.Directory)
            {
                ImportNative.Require(Directories.Count < MaxDirectories, "import-directory-budget");
                PinnedDirectory child = Pin(selected, relative);
                try { Expected(directory.Identity, entry, child.Identity); }
                catch { child.Handle.Dispose(); throw; }
                Directories.Add(child);
                Walk(child, depth + 1);
            }
            else
            {
                ImportNative.Require(Files.Count < MaxFiles, "import-file-budget");
                ImportNative.Require(entry.Size >= 0 && entry.Size <= MaxFileBytes, "import-file-size-budget");
                ImportNative.Require(TotalBytes <= MaxBytes - entry.Size, "import-byte-budget");
                using (SafeFileHandle handle = ImportNative.Open(selected, ImportNative.Read, 1, 3))
                {
                    ImportNative.Identity identity = ImportNative.Inspect(handle, false);
                    Expected(directory.Identity, entry, identity);
                    ImportNative.Require(identity.Size == entry.Size, "import-size-changed");
                    ImportNative.NoStreams(handle, false);
                    ImportNative.Require(fileIds.Add(ImportNative.Token(identity)), "import-duplicate-identity");
                    byte[] bytes = Read(handle, identity.Size);
                    try
                    {
                        Stable(handle, identity);
                        Files.Add(new CapturedFile { Path = selected, Relative = relative, Identity = identity,
                            Bytes = bytes, Hash = Hash(bytes) });
                        TotalBytes = checked(TotalBytes + bytes.Length);
                    }
                    catch { Array.Clear(bytes, 0, bytes.Length); throw; }
                }
            }
        }
    }

    private static bool Excluded(string name)
    {
        string lower = name.ToLowerInvariant();
        string stem = lower.TrimStart('.').Split('.')[0];
        return lower == ".git" || lower == ".ssh" || lower == ".aws" || lower == ".claude" ||
            lower == ".codex" || lower == ".config" || lower == ".npmrc" || lower == ".netrc" ||
            lower == ".gitconfig" || lower == ".git-credentials" || lower == ".env" ||
            lower.StartsWith(".env.") || lower.StartsWith("git-credential-") ||
            stem == "config" || stem == "credentials" || stem == "credential" || stem == "profile" ||
            stem == "auth" || stem == "settings";
    }

    private static void Expected(ImportNative.Identity parent, ImportNative.Entry entry,
        ImportNative.Identity actual)
    {
        ImportNative.Require(parent.Volume == actual.Volume && ImportNative.Equal(entry.Id, actual.Id),
            "import-identity-changed");
        ImportNative.Require(entry.Directory == actual.Directory, "import-type-changed");
    }

    internal static byte[] Read(SafeFileHandle handle, long size)
    {
        ImportNative.Require(size >= 0 && size <= MaxFileBytes, "import-file-size-budget");
        byte[] bytes = new byte[(int)size];
        // A non-owning wrapper lets the caller retain the identity-bearing handle.
        using (SafeFileHandle borrowed = new SafeFileHandle(handle.DangerousGetHandle(), false))
        using (FileStream stream = new FileStream(borrowed, FileAccess.Read, 4096, false))
        {
            stream.Position = 0;
            int total = 0;
            while (total < bytes.Length)
            {
                int count = stream.Read(bytes, total, bytes.Length - total);
                ImportNative.Require(count > 0, "import-short-read");
                total += count;
            }
            ImportNative.Require(stream.ReadByte() == -1, "import-size-changed");
        }
        return bytes;
    }

    internal static void Stable(SafeFileHandle handle, ImportNative.Identity expected)
    {
        ImportNative.Identity actual = ImportNative.Inspect(handle, expected.Directory);
        ImportNative.Require(ImportNative.Same(expected, actual), "import-identity-changed");
        if (!expected.Directory) ImportNative.Require(expected.Size == actual.Size, "import-size-changed");
        ImportNative.NoStreams(handle, expected.Directory);
    }

    internal void CheckDirectories()
    {
        int calls = 0;
        foreach (PinnedDirectory directory in Ancestors) { Deadline(); Stable(directory.Handle, directory.Identity); }
        foreach (PinnedDirectory directory in Directories)
        {
            Deadline();
            Stable(directory.Handle, directory.Identity);
            List<ImportNative.Entry> now = ImportNative.Entries(directory.Handle, ref calls);
            ImportNative.Require(now.Count == directory.Entries.Count, "import-directory-changed");
            for (int index = 0; index < now.Count; index++)
            {
                ImportNative.Entry before = directory.Entries[index], after = now[index];
                ImportNative.Require(before.Name == after.Name && before.Directory == after.Directory &&
                    ImportNative.Equal(before.Id, after.Id) && (after.Attributes & ImportNative.Reparse) == 0,
                    "import-directory-changed");
            }
        }
    }

    public void Dispose()
    {
        foreach (CapturedFile file in Files) { Array.Clear(file.Bytes, 0, file.Bytes.Length); }
        for (int index = Directories.Count - 1; index >= 0; index--)
            if (!Ancestors.Contains(Directories[index])) Directories[index].Handle.Dispose();
        for (int index = Ancestors.Count - 1; index >= 0; index--) Ancestors[index].Handle.Dispose();
        Files.Clear(); Directories.Clear(); Ancestors.Clear();
    }
}
