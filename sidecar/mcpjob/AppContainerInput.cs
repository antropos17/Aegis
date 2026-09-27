using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using Microsoft.Win32.SafeHandles;

// Imports one operator-approved byte snapshot. No source ACL is changed and no
// source handle is inherited by the suspended AppContainer process.
internal static class AppContainerInput
{
    private const uint GENERIC_READ = 0x80000000;
    private const uint GENERIC_WRITE = 0x40000000;
    private const uint DELETE = 0x00010000;
    private const uint FILE_READ_ATTRIBUTES = 0x80;
    private const uint FILE_SHARE_READ = 1;
    private const uint OPEN_EXISTING = 3;
    private const uint CREATE_NEW = 1;
    private const uint FILE_FLAG_BACKUP_SEMANTICS = 0x02000000;
    private const uint FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000;
    private const uint FILE_ATTRIBUTE_REPARSE_POINT = 0x00000400;
    private const int MaxInputBytes = 65536;
    private const uint DRIVE_FIXED = 3;

    [StructLayout(LayoutKind.Sequential)]
    private struct FILE_DISPOSITION_INFO
    {
        [MarshalAs(UnmanagedType.U1)] public bool DeleteFile;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct FILETIME { public uint low, high; }
    [StructLayout(LayoutKind.Sequential)]
    internal struct BY_HANDLE_FILE_INFORMATION
    {
        public uint attributes;
        public FILETIME created, accessed, written;
        public uint volume, sizeHigh, sizeLow, links, indexHigh, indexLow;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(string path, uint access, uint sharing,
        IntPtr security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetFileInformationByHandle(SafeFileHandle handle,
        out BY_HANDLE_FILE_INFORMATION information);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetDriveType(string root);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetFileInformationByHandle(SafeFileHandle handle, int informationClass,
        ref FILE_DISPOSITION_INFO information, uint size);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool WriteFile(SafeFileHandle handle, byte[] bytes, uint count,
        out uint written, IntPtr overlapped);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool FlushFileBuffers(SafeFileHandle handle);
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

    private static BY_HANDLE_FILE_INFORMATION Information(SafeFileHandle handle, bool directory)
    {
        BY_HANDLE_FILE_INFORMATION info;
        if (handle.IsInvalid || !GetFileInformationByHandle(handle, out info) ||
            (info.attributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0 ||
            ((info.attributes & (uint)FileAttributes.Directory) != 0) != directory)
            throw new InvalidDataException("input-path-unsafe");
        return info;
    }

    private static bool Same(BY_HANDLE_FILE_INFORMATION a, BY_HANDLE_FILE_INFORMATION b)
    {
        return a.volume == b.volume && a.indexHigh == b.indexHigh && a.indexLow == b.indexLow &&
            a.links == b.links;
    }

    internal sealed class ImportedFile : IDisposable
    {
        private SafeFileHandle handle;
        private readonly AppContainerWorkspace workspace;
        private readonly BY_HANDLE_FILE_INFORMATION identity;

        internal ImportedFile(SafeFileHandle selected, AppContainerWorkspace pinnedWorkspace,
            BY_HANDLE_FILE_INFORMATION selectedIdentity)
        {
            handle = selected;
            workspace = pinnedWorkspace;
            identity = selectedIdentity;
        }

        // Delete only the exact still-open file created by this import. A failed
        // identity/retention check preserves uncertainty instead of deleting by path.
        internal bool Remove()
        {
            try
            {
                if (handle == null || handle.IsInvalid || !workspace.IsRetained() ||
                    !Same(identity, Information(handle, false))) return false;
                FILE_DISPOSITION_INFO disposition = new FILE_DISPOSITION_INFO();
                disposition.DeleteFile = true;
                return SetFileInformationByHandle(handle, 4, ref disposition, 1);
            }
            catch { return false; }
            finally { Dispose(); }
        }

        public void Dispose()
        {
            if (handle != null) { handle.Dispose(); handle = null; }
        }
    }

    internal static ImportedFile Copy(string selected, int expectedSize, string expectedHash,
        AppContainerWorkspace workspace, string workspacePath)
    {
        if (string.IsNullOrEmpty(selected) || selected.Length > 32000 || selected.Length < 4 ||
            !char.IsLetter(selected[0]) || selected[1] != ':' || selected[2] != '\\' ||
            selected.IndexOf(':', 2) >= 0 || selected.StartsWith(@"\\") ||
            selected.StartsWith(@"\\?\") ||
            !string.Equals(Path.GetFullPath(selected), selected, StringComparison.OrdinalIgnoreCase) ||
            expectedSize < 0 || expectedSize > MaxInputBytes ||
            expectedHash == null || expectedHash.Length != 64)
            throw new InvalidDataException("input-path-invalid");
        foreach (char c in expectedHash)
            if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')))
                throw new InvalidDataException("input-hash-invalid");
        string root = Path.GetPathRoot(selected);
        if (SourceDriveType(root) != DRIVE_FIXED)
            throw new InvalidDataException("input-drive-not-fixed");
        string[] parts = selected.Substring(root.Length).Split('\\');
        if (parts.Length == 0) throw new InvalidDataException("input-path-invalid");
        foreach (string part in parts)
            if (part.Length == 0 || part == "." || part == ".." ||
                part.EndsWith(" ") || part.EndsWith("."))
                throw new InvalidDataException("input-path-invalid");

        List<SafeFileHandle> pinned = new List<SafeFileHandle>();
        byte[] bytes = new byte[expectedSize];
        try
        {
            string ancestor = root;
            for (int i = 0; i < parts.Length; i++)
            {
                if (i > 0) ancestor = Path.Combine(ancestor, parts[i - 1]);
                SafeFileHandle directory = CreateFile(ancestor, FILE_READ_ATTRIBUTES,
                    FILE_SHARE_READ, IntPtr.Zero, OPEN_EXISTING,
                    FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, IntPtr.Zero);
                try { Information(directory, true); pinned.Add(directory); }
                catch { directory.Dispose(); throw; }
            }
            using (SafeFileHandle source = CreateFile(selected, GENERIC_READ, FILE_SHARE_READ,
                IntPtr.Zero, OPEN_EXISTING, FILE_FLAG_OPEN_REPARSE_POINT, IntPtr.Zero))
            {
                BY_HANDLE_FILE_INFORMATION before = Information(source, false);
                long size = ((long)before.sizeHigh << 32) | before.sizeLow;
                if (size != expectedSize) throw new InvalidDataException("input-size-changed");
                using (FileStream stream = new FileStream(source, FileAccess.Read, 4096, false))
                {
                    int total = 0;
                    while (total < bytes.Length)
                    {
                        int count = stream.Read(bytes, total, bytes.Length - total);
                        if (count <= 0) throw new InvalidDataException("input-short-read");
                        total += count;
                    }
                    if (stream.ReadByte() != -1) throw new InvalidDataException("input-size-changed");
                    using (SHA256 sha = SHA256.Create())
                    {
                        string actual = BitConverter.ToString(sha.ComputeHash(bytes))
                            .Replace("-", "").ToLowerInvariant();
                        if (!string.Equals(actual, expectedHash, StringComparison.Ordinal))
                            throw new InvalidDataException("input-content-changed");
                    }
                    BY_HANDLE_FILE_INFORMATION after = Information(source, false);
                    if (!Same(before, after) || before.sizeHigh != after.sizeHigh ||
                        before.sizeLow != after.sizeLow)
                        throw new InvalidDataException("input-identity-changed");
                    if (!workspace.IsRetained()) throw new InvalidDataException("workspace-changed");
                    string target = Path.Combine(workspacePath, "input.bin");
                    SafeFileHandle destination = CreateFile(target, GENERIC_WRITE | DELETE,
                        FILE_SHARE_READ, IntPtr.Zero, CREATE_NEW,
                        FILE_FLAG_OPEN_REPARSE_POINT, IntPtr.Zero);
                    if (destination.IsInvalid)
                    {
                        destination.Dispose();
                        throw new IOException("input-create-failed");
                    }
                    try
                    {
                        uint written;
#if APPCONTAINER_TEST
                        if (Path.GetFileName(selected) == "copy-fail-source.bin")
                        {
                            if (bytes.Length > 0 && !WriteFile(destination, bytes, 1,
                                out written, IntPtr.Zero)) throw new IOException("fixture-write-failure");
                            throw new IOException("fixture-copy-failure");
                        }
#endif
                        if (!WriteFile(destination, bytes, (uint)bytes.Length,
                            out written, IntPtr.Zero) || written != bytes.Length ||
                            !FlushFileBuffers(destination))
                            throw new IOException("input-copy-incomplete");
                        BY_HANDLE_FILE_INFORMATION copied = Information(destination, false);
                        long copiedSize = ((long)copied.sizeHigh << 32) | copied.sizeLow;
                        if (copiedSize != bytes.Length || !workspace.IsRetained())
                            throw new InvalidDataException("input-copy-incomplete");
                        return new ImportedFile(destination, workspace, copied);
                    }
                    catch
                    {
                        FILE_DISPOSITION_INFO disposition = new FILE_DISPOSITION_INFO();
                        disposition.DeleteFile = true;
                        bool removed = SetFileInformationByHandle(destination, 4, ref disposition, 1);
                        destination.Dispose();
                        if (!removed) throw new InvalidOperationException("input-cleanup-uncertain");
                        throw;
                    }
                }
            }
        }
        finally
        {
            Array.Clear(bytes, 0, bytes.Length);
            for (int i = pinned.Count - 1; i >= 0; i--) pinned[i].Dispose();
        }
    }
}
