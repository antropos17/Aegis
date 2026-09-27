using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Win32.SafeHandles;

// Rechecks the approved executable while its file and every path ancestor are
// pinned against write/delete sharing. The pins outlive CreateProcess and ResumeThread.
internal static class AppContainerExecutable
{
    private const uint GENERIC_READ = 0x80000000;
    private const uint FILE_READ_ATTRIBUTES = 0x80;
    private const uint FILE_SHARE_READ = 1;
    private const uint OPEN_EXISTING = 3;
    private const uint FILE_FLAG_BACKUP_SEMANTICS = 0x02000000;
    private const uint FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000;
    private const uint FILE_ATTRIBUTE_REPARSE_POINT = 0x00000400;
    private const uint DRIVE_FIXED = 3;
    private const int MaxBytes = 128 * 1024 * 1024;
    private const uint VOLUME_NAME_NT = 2;
    private const uint PROCESS_NAME_NATIVE = 1;
#if APPCONTAINER_TEST
    internal static Func<string, uint> DriveTypeForTest;
#endif

    private static uint SourceDriveType(string root)
    {
#if APPCONTAINER_TEST
        if (DriveTypeForTest != null) return DriveTypeForTest(root);
#endif
        return GetDriveType(root);
    }

    [StructLayout(LayoutKind.Sequential)] private struct FILETIME { public uint low, high; }
    [StructLayout(LayoutKind.Sequential)] private struct FILE_INFO
    {
        public uint attributes;
        public FILETIME created, accessed, written;
        public uint volume, sizeHigh, sizeLow, links, indexHigh, indexLow;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(string path, uint access, uint sharing,
        IntPtr security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetFileInformationByHandle(SafeFileHandle handle, out FILE_INFO info);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetDriveType(string root);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool ReadFile(SafeFileHandle handle, byte[] buffer, uint count,
        out uint read, IntPtr overlapped);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetFinalPathNameByHandle(SafeFileHandle handle, StringBuilder name,
        uint length, uint flags);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool QueryFullProcessImageName(IntPtr process, uint flags,
        StringBuilder name, ref uint length);

    private static FILE_INFO Information(SafeFileHandle handle, bool directory)
    {
        FILE_INFO info;
        if (handle.IsInvalid || !GetFileInformationByHandle(handle, out info) ||
            (info.attributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0 ||
            ((info.attributes & (uint)FileAttributes.Directory) != 0) != directory ||
            info.volume == 0 || (info.indexHigh == 0 && info.indexLow == 0))
            throw new InvalidDataException("executable-path-unsafe");
        return info;
    }

    private static bool Same(FILE_INFO a, FILE_INFO b)
    {
        return a.volume == b.volume && a.indexHigh == b.indexHigh &&
            a.indexLow == b.indexLow && a.links == b.links;
    }

    internal sealed class PinnedFile : IDisposable
    {
        private SafeFileHandle file;
        private readonly List<SafeFileHandle> ancestors;
        internal readonly string Path;
        private readonly string nativePath;
        internal PinnedFile(string path, string ntPath, SafeFileHandle selected,
            List<SafeFileHandle> parents)
        {
            Path = path;
            nativePath = ntPath;
            file = selected;
            ancestors = parents;
        }
        internal bool IsPinned { get { return file != null && !file.IsInvalid && !file.IsClosed; } }
        internal bool MatchesProcessImage(IntPtr process)
        {
            if (!IsPinned) return false;
            StringBuilder name = new StringBuilder(32768);
            uint length = (uint)name.Capacity;
            if (!QueryFullProcessImageName(process, PROCESS_NAME_NATIVE, name, ref length) ||
                length == 0 || length >= name.Capacity) return false;
            string processPath = name.ToString();
#if APPCONTAINER_TEST
            if (System.IO.Path.GetFileName(Path) == "image-mismatch-probe.exe") return false;
            if (System.IO.Path.GetFileName(Path) == "image-case-mismatch-probe.exe")
            {
                // Simulate a case-only image path mismatch without changing the
                // host volume's case-sensitivity or remapping a DOS drive.
                int at = processPath.LastIndexOf('\\') + 1;
                if (at <= 0 || at >= processPath.Length) return false;
                char original = processPath[at];
                char changed = char.IsUpper(original) ? char.ToLowerInvariant(original) : char.ToUpperInvariant(original);
                if (changed == original) return false;
                processPath = processPath.Substring(0, at) + changed + processPath.Substring(at + 1);
            }
#endif
            return string.Equals(processPath, nativePath, StringComparison.Ordinal);
        }
        public void Dispose()
        {
            if (file != null) { file.Dispose(); file = null; }
            for (int i = ancestors.Count - 1; i >= 0; i--) ancestors[i].Dispose();
            ancestors.Clear();
        }
    }

    internal static PinnedFile Open(string selected, int expectedSize, string expectedHash)
    {
        if (string.IsNullOrEmpty(selected) || selected.Length > 32000 || selected.Length < 4 ||
            !char.IsLetter(selected[0]) || selected[1] != ':' || selected[2] != '\\' ||
            selected.IndexOf(':', 2) >= 0 || selected.StartsWith(@"\\") ||
            selected.StartsWith(@"\\?\") ||
            !string.Equals(System.IO.Path.GetFullPath(selected), selected,
                StringComparison.OrdinalIgnoreCase) ||
            expectedSize < 1 || expectedSize > MaxBytes ||
            expectedHash == null || expectedHash.Length != 64)
            throw new InvalidDataException("executable-descriptor-invalid");
        foreach (char c in expectedHash)
            if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')))
                throw new InvalidDataException("executable-hash-invalid");
        string root = System.IO.Path.GetPathRoot(selected);
        if (SourceDriveType(root) != DRIVE_FIXED)
            throw new InvalidDataException("executable-drive-not-fixed");
        string[] parts = selected.Substring(root.Length).Split('\\');
        foreach (string part in parts)
            if (part.Length == 0 || part == "." || part == ".." ||
                part.EndsWith(" ") || part.EndsWith("."))
                throw new InvalidDataException("executable-path-invalid");

        List<SafeFileHandle> pinned = new List<SafeFileHandle>();
        SafeFileHandle source = null;
        bool transferred = false;
        byte[] buffer = new byte[256 * 1024];
        try
        {
            string ancestor = root;
            for (int i = 0; i < parts.Length; i++)
            {
                if (i > 0) ancestor = System.IO.Path.Combine(ancestor, parts[i - 1]);
                SafeFileHandle directory = CreateFile(ancestor, FILE_READ_ATTRIBUTES,
                    FILE_SHARE_READ, IntPtr.Zero, OPEN_EXISTING,
                    FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, IntPtr.Zero);
                try { Information(directory, true); pinned.Add(directory); }
                catch { directory.Dispose(); throw; }
            }
            source = CreateFile(selected, GENERIC_READ, FILE_SHARE_READ, IntPtr.Zero,
                OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT, IntPtr.Zero);
            FILE_INFO before = Information(source, false);
            long size = ((long)before.sizeHigh << 32) | before.sizeLow;
            if (size != expectedSize) throw new InvalidDataException("executable-size-changed");
            using (SHA256 hash = SHA256.Create())
            {
                long total = 0;
                while (true)
                {
                    uint read;
                    uint request = (uint)Math.Min(buffer.Length, MaxBytes + 1L - total);
                    if (!ReadFile(source, buffer, request, out read, IntPtr.Zero))
                        throw new IOException("executable-read-failed");
                    if (read == 0) break;
                    total += read;
                    if (total > MaxBytes) throw new InvalidDataException("executable-oversize");
                    hash.TransformBlock(buffer, 0, (int)read, buffer, 0);
                }
                hash.TransformFinalBlock(new byte[0], 0, 0);
                string actual = BitConverter.ToString(hash.Hash).Replace("-", "").ToLowerInvariant();
                FILE_INFO after = Information(source, false);
                if (total != expectedSize || !Same(before, after) ||
                    before.sizeHigh != after.sizeHigh || before.sizeLow != after.sizeLow ||
                    !string.Equals(actual, expectedHash, StringComparison.Ordinal))
                    throw new InvalidDataException("executable-content-changed");
            }
            StringBuilder nativeName = new StringBuilder(32768);
            uint nativeLength = GetFinalPathNameByHandle(source, nativeName,
                (uint)nativeName.Capacity, VOLUME_NAME_NT);
            if (nativeLength == 0 || nativeLength >= nativeName.Capacity)
                throw new InvalidDataException("executable-image-path-unavailable");
            PinnedFile result = new PinnedFile(selected, nativeName.ToString(), source, pinned);
            transferred = true;
            return result;
        }
        finally
        {
            Array.Clear(buffer, 0, buffer.Length);
            if (!transferred)
            {
                if (source != null) source.Dispose();
                for (int i = pinned.Count - 1; i >= 0; i--) pinned[i].Dispose();
            }
        }
    }
}
