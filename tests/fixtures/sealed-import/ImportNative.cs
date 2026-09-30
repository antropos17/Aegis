using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

// Developer-only Win32 primitives. Locator paths never substitute for full IDs.
internal static class ImportNative
{
    internal const uint Read = 0x80000000, Write = 0x40000000, Delete = 0x10000;
    internal const uint DirectoryAccess = 0x81, Reparse = 0x400, DirectoryAttribute = 0x10;
    internal const int BufferSize = 65536;
    internal static bool FileIdUnavailable;
    internal static string DirectoryStreamProfile = "unobserved";
    internal sealed class Identity
    {
        internal ulong Volume;
        internal byte[] Id;
        internal long Size;
        internal uint Attributes, Links;
        internal bool Directory;
    }
    internal sealed class Entry
    {
        internal string Name;
        internal byte[] Id;
        internal long Size;
        internal uint Attributes;
        internal bool Directory { get { return (Attributes & DirectoryAttribute) != 0; } }
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(string path, uint access, uint sharing,
        IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    internal static extern bool GetFileInformationByHandleEx(SafeFileHandle handle, int kind,
        IntPtr buffer, uint size);
    [DllImport("kernel32.dll", SetLastError = true)]
    internal static extern bool SetFileInformationByHandle(SafeFileHandle handle, int kind,
        IntPtr buffer, uint size);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool GetVolumeInformationByHandleW(SafeFileHandle handle,
        StringBuilder name, uint nameSize, out uint serial, out uint component,
        out uint flags, StringBuilder filesystem, uint filesystemSize);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern uint GetDriveType(string root);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateDirectory(string path, IntPtr security);
    [DllImport("kernel32.dll", SetLastError = true)]
    internal static extern bool FlushFileBuffers(SafeFileHandle handle);
    [StructLayout(LayoutKind.Sequential)]
    internal struct IoStatus { internal IntPtr Status; internal UIntPtr Information; }
    [DllImport("ntdll.dll")]
    internal static extern int NtSetInformationFile(SafeFileHandle handle, IntPtr status,
        IntPtr information, uint length, int kind);

    internal static void Require(bool condition, string code)
    { if (!condition) throw new InvalidDataException(code); }

    internal static SafeFileHandle Open(string path, uint access, uint sharing, uint creation)
    {
        // Deliberately synchronous: FILE_FLAG_OVERLAPPED is never requested.
        // The external canonical drive path was checked before traversal. Only
        // internally constructed Win32 locators use long-path spelling.
        SafeFileHandle handle = CreateFile(@"\\?\" + path, access, sharing, IntPtr.Zero, creation,
            0x02000000 | 0x00200000, IntPtr.Zero);
        if (handle.IsInvalid) { handle.Dispose(); throw new InvalidDataException("import-open-failed"); }
        return handle;
    }

    internal static bool CreateOwnedDirectory(string path)
    { return CreateDirectory(@"\\?\" + path, IntPtr.Zero); }

    internal static Identity Inspect(SafeFileHandle handle, bool directory)
    {
        IntPtr buffer = Marshal.AllocHGlobal(24);
        try
        {
            Require(GetFileInformationByHandleEx(handle, 9, buffer, 8), "import-metadata-unavailable");
            uint attributes = unchecked((uint)Marshal.ReadInt32(buffer));
            Require((attributes & Reparse) == 0, "import-reparse");
            Require((attributes & (0x40 | 0x1000 | 0x4000)) == 0, "import-type-unsupported");
            Require(((attributes & DirectoryAttribute) != 0) == directory, "import-type-changed");
            Require(GetFileInformationByHandleEx(handle, 1, buffer, 24), "import-metadata-unavailable");
            long size = Marshal.ReadInt64(buffer, 8);
            uint links = unchecked((uint)Marshal.ReadInt32(buffer, 16));
            Require(Marshal.ReadByte(buffer, 20) == 0, "import-delete-pending");
            Require((Marshal.ReadByte(buffer, 21) != 0) == directory, "import-type-changed");
            if (!directory) Require(links == 1, "import-hardlink");
            Require(!FileIdUnavailable && GetFileInformationByHandleEx(handle, 18, buffer, 24),
                "import-file-id-unavailable");
            Identity identity = new Identity { Volume = unchecked((ulong)Marshal.ReadInt64(buffer)),
                Id = new byte[16], Size = size, Links = links, Attributes = attributes,
                Directory = directory };
            Marshal.Copy(IntPtr.Add(buffer, 8), identity.Id, 0, 16);
            return identity;
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }

    internal static bool Same(Identity expected, Identity actual)
    { return expected.Volume == actual.Volume && Equal(expected.Id, actual.Id); }
    internal static bool Equal(byte[] expected, byte[] actual)
    {
        if (expected == null || actual == null || expected.Length != actual.Length) return false;
        for (int index = 0; index < expected.Length; index++)
            if (expected[index] != actual[index]) return false;
        return true;
    }
    internal static string Token(Identity identity)
    { return identity.Volume.ToString("x16") + BitConverter.ToString(identity.Id).Replace("-", ""); }

    internal static void NoStreams(SafeFileHandle handle, bool directory)
    {
        IntPtr buffer = Marshal.AllocHGlobal(BufferSize);
        try
        {
            Marshal.Copy(new byte[BufferSize], 0, buffer, BufferSize);
            if (!GetFileInformationByHandleEx(handle, 7, buffer, BufferSize))
            {
                Require(directory && Marshal.GetLastWin32Error() == 38, "import-stream-query-failed");
                DirectoryStreamProfile = "directory-handle-eof";
                return;
            }
            int offset = 0, count = 0;
            while (true)
            {
                Require(offset >= 0 && offset <= BufferSize - 24 && ++count <= 256,
                    "import-stream-buffer-invalid");
                int next = Marshal.ReadInt32(buffer, offset), length = Marshal.ReadInt32(buffer, offset + 4);
                Require(length >= 0 && length % 2 == 0 && length <= BufferSize - offset - 24,
                    "import-stream-buffer-invalid");
                if (directory && count == 1 && next == 0 && length == 0)
                { DirectoryStreamProfile = "directory-empty-record"; return; }
                string name = Marshal.PtrToStringUni(IntPtr.Add(buffer, offset + 24), length / 2);
                Require(name == "::$DATA" && count == 1, "import-stream");
                if (directory) DirectoryStreamProfile = "directory-unnamed-stream";
                if (next == 0) return;
                Require(next >= 24 + length && next % 8 == 0 && next <= BufferSize - offset - 24,
                    "import-stream-buffer-invalid");
                offset += next;
            }
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }

    internal static List<Entry> Entries(SafeFileHandle directory, ref int calls)
    {
        List<Entry> entries = new List<Entry>();
        HashSet<string> names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        IntPtr buffer = Marshal.AllocHGlobal(BufferSize);
        try
        {
            int kind = 20;
            while (true)
            {
                Require(++calls <= 512, "import-enumeration-budget");
                Marshal.Copy(new byte[BufferSize], 0, buffer, BufferSize);
                if (!GetFileInformationByHandleEx(directory, kind, buffer, BufferSize))
                {
                    Require(Marshal.GetLastWin32Error() == 18, "import-enumeration-unavailable");
                    break;
                }
                kind = 19;
                int offset = 0;
                while (true)
                {
                    Require(offset >= 0 && offset <= BufferSize - 88, "import-directory-buffer-invalid");
                    int next = Marshal.ReadInt32(buffer, offset), length = Marshal.ReadInt32(buffer, offset + 60);
                    Require(length > 0 && length % 2 == 0 && length <= BufferSize - offset - 88,
                        "import-directory-buffer-invalid");
                    string name = Marshal.PtrToStringUni(IntPtr.Add(buffer, offset + 88), length / 2);
                    if (name != "." && name != "..")
                    {
                        Require(entries.Count < 160, "import-entry-budget");
                        Require(names.Add(name), "import-case-duplicate");
                        Entry entry = new Entry { Name = name, Id = new byte[16],
                            Size = Marshal.ReadInt64(buffer, offset + 40),
                            Attributes = unchecked((uint)Marshal.ReadInt32(buffer, offset + 56)) };
                        Marshal.Copy(IntPtr.Add(buffer, offset + 72), entry.Id, 0, 16);
                        entries.Add(entry);
                    }
                    if (next == 0) break;
                    Require(next >= 88 + length && next % 8 == 0 && next <= BufferSize - offset - 88,
                        "import-directory-buffer-invalid");
                    offset += next;
                }
            }
            entries.Sort(delegate(Entry a, Entry b) { return StringComparer.Ordinal.Compare(a.Name, b.Name); });
            return entries;
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }

    internal static string[] ValidatePath(string selected)
    {
        Require(!string.IsNullOrEmpty(selected) && selected.Length >= 4 && selected.Length <= 32000 &&
            ((selected[0] >= 'A' && selected[0] <= 'Z') || (selected[0] >= 'a' && selected[0] <= 'z')) &&
            selected[1] == ':' && selected[2] == '\\' && selected.IndexOf(':', 2) < 0 &&
            string.Equals(Path.GetFullPath(selected), selected, StringComparison.OrdinalIgnoreCase),
            "import-path-invalid");
        string[] parts = selected.Substring(3).Split('\\');
        Require(parts.Length <= 32, "import-ancestor-budget");
        foreach (string part in parts) Component(part, false);
        return parts;
    }

    internal static void Component(string name, bool relative)
    {
        Require(name.Length > 0 && name != "." && name != ".." && !name.EndsWith(".") &&
            !name.EndsWith(" "), "import-path-invalid");
        if (relative) Require(name.Length <= 64, "import-component-budget");
        foreach (char character in name)
            Require((character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z') ||
                (character >= '0' && character <= '9') || character == '_' || character == '-' ||
                character == '.', "import-path-invalid");
        if (relative) Require(char.IsLetterOrDigit(name[0]), "import-path-invalid");
        string stem = name.Split('.')[0].ToUpperInvariant();
        Require(stem != "CON" && stem != "PRN" && stem != "AUX" && stem != "NUL" &&
            !(stem.Length == 4 && (stem.StartsWith("COM") || stem.StartsWith("LPT")) &&
            stem[3] >= '0' && stem[3] <= '9'), "import-path-invalid");
    }

    internal static void FixedNtfs(string path, SafeFileHandle directory)
    {
        uint serial, component, flags;
        StringBuilder filesystem = new StringBuilder(64);
        Require(GetDriveType(Path.GetPathRoot(path)) == 3 &&
            GetVolumeInformationByHandleW(directory, null, 0, out serial, out component,
                out flags, filesystem, 64) && filesystem.ToString() == "NTFS", "import-filesystem-unsupported");
    }
}
