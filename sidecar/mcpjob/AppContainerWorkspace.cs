using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Principal;

// Creates one new, exact directory with only the selected AppContainer SID and
// its operator/SYSTEM as principals. Open handles deny rename/delete until close.
internal sealed class AppContainerWorkspace : IDisposable
{
    private const uint FILE_READ_ATTRIBUTES = 0x80;
    private const uint FILE_SHARE_READ_WRITE = 3;
    private const uint OPEN_EXISTING = 3;
    private const uint FILE_FLAG_BACKUP_SEMANTICS = 0x02000000;
    private const uint FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000;
    private const uint FILE_ATTRIBUTE_REPARSE_POINT = 0x00000400;
    private readonly List<IntPtr> pinned = new List<IntPtr>();
    private readonly string path;
    private FILE_IDENTITY identity;
#if APPCONTAINER_TEST
    internal static bool FileIdUnavailableForTest;
#endif

    private struct FILE_IDENTITY
    {
        internal ulong volume;
        internal byte[] id;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SECURITY_ATTRIBUTES { public int length; public IntPtr descriptor; public int inherit; }
    [StructLayout(LayoutKind.Sequential)]
    private struct FILETIME { public uint low, high; }
    [StructLayout(LayoutKind.Sequential)]
    private struct BY_HANDLE_FILE_INFORMATION
    {
        public uint attributes;
        public FILETIME created, accessed, written;
        public uint volume, sizeHigh, sizeLow, links, indexHigh, indexLow;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateDirectory(string path, ref SECURITY_ATTRIBUTES attributes);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateFile(string path, uint access, uint sharing,
        IntPtr attributes, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetFileInformationByHandle(IntPtr handle,
        out BY_HANDLE_FILE_INFORMATION information);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetFileInformationByHandleEx(IntPtr handle, int informationClass,
        IntPtr information, uint informationSize);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(
        string sddl, uint revision, out IntPtr descriptor, out uint size);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool ConvertSidToStringSid(IntPtr sid, out IntPtr text);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr memory);
    private static readonly IntPtr InvalidHandle = new IntPtr(-1);

    private AppContainerWorkspace(string selected) { path = selected; }

    internal static AppContainerWorkspace Create(string selected, IntPtr appSid)
    {
#if APPCONTAINER_TEST
        FileIdUnavailableForTest = Path.GetFileName(selected) ==
            "inventory-fileid-unavailable-workspace";
#endif
        string[] parts = ValidatePath(selected);
        string root = Path.GetPathRoot(selected);
        AppContainerWorkspace result = new AppContainerWorkspace(selected);
        IntPtr descriptor = IntPtr.Zero, sidText = IntPtr.Zero;
        try
        {
            string current = root;
            result.Pin(current);
            for (int i = 0; i < parts.Length - 1; i++)
            {
                current = Path.Combine(current, parts[i]);
                result.Pin(current);
            }
            if (!ConvertSidToStringSid(appSid, out sidText) || sidText == IntPtr.Zero)
                throw new InvalidOperationException("workspace-sid-invalid");
            string app = Marshal.PtrToStringUni(sidText);
            string owner = WindowsIdentity.GetCurrent().User.Value;
            // Low mandatory label permits writes from an AppContainer low token;
            // the protected DACL still limits the path to these exact principals.
            string sddl = "O:" + owner + "G:" + owner +
                "D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;" + owner +
                ")(A;OICI;0x1301bf;;;" + app + ")S:(ML;OICI;NW;;;LW)";
            uint size;
            if (!ConvertStringSecurityDescriptorToSecurityDescriptor(sddl, 1,
                out descriptor, out size) || descriptor == IntPtr.Zero)
                throw new InvalidOperationException("workspace-acl-invalid");
            SECURITY_ATTRIBUTES security = new SECURITY_ATTRIBUTES();
            security.length = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES));
            security.descriptor = descriptor;
            if (!CreateDirectory(selected, ref security))
                throw new InvalidOperationException("workspace-create-failed");
            result.Pin(selected);
            result.identity = ReadIdentity(result.pinned[result.pinned.Count - 1]);
            return result;
        }
        catch { result.Dispose(); throw; }
        finally
        {
            if (descriptor != IntPtr.Zero) LocalFree(descriptor);
            if (sidText != IntPtr.Zero) LocalFree(sidText);
        }
    }

    internal static string[] ValidatePath(string selected)
    {
        if (string.IsNullOrEmpty(selected) || selected.Length > 32000 ||
            selected.Length < 4 || !char.IsLetter(selected[0]) || selected[1] != ':' ||
            selected[2] != '\\' || selected.IndexOf(':', 2) >= 0 ||
            selected.StartsWith(@"\\") || selected.StartsWith(@"\\?\") ||
            !string.Equals(Path.GetFullPath(selected), selected, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("workspace-path-invalid");
        string root = Path.GetPathRoot(selected);
        string[] parts = selected.Substring(root.Length).Split('\\');
        if (parts.Length < 1 || parts[parts.Length - 1].Length == 0)
            throw new InvalidOperationException("workspace-path-invalid");
        foreach (string part in parts)
            if (part.Length == 0 || part == "." || part == ".." ||
                part.EndsWith(" ") || part.EndsWith("."))
                throw new InvalidOperationException("workspace-path-invalid");

        return parts;
    }

    internal string IdentityToken()
    {
        if (!IsRetained()) throw new InvalidOperationException("workspace-identity-unavailable");
        return identity.volume.ToString("x16", System.Globalization.CultureInfo.InvariantCulture) +
            BitConverter.ToString(identity.id).Replace("-", "").ToLowerInvariant();
    }

    internal static string Inspect(string selected, string expected)
    {
        if (expected == null || expected.Length != 48) return "unknown";
        try
        {
            string[] parts = ValidatePath(selected);
            using (AppContainerWorkspace current = new AppContainerWorkspace(selected))
            {
                string at = Path.GetPathRoot(selected);
                current.Pin(at);
                foreach (string part in parts)
                {
                    at = Path.Combine(at, part);
                    current.Pin(at);
                }
                current.identity = ReadIdentity(current.pinned[current.pinned.Count - 1]);
                if (!current.IsRetained()) return "unknown";
                return string.Equals(current.IdentityToken(), expected, StringComparison.Ordinal)
                    ? "present" : "replaced";
            }
        }
        catch { return "unknown"; }
    }

    private void Pin(string directory)
    {
        IntPtr handle = CreateFile(directory, FILE_READ_ATTRIBUTES, FILE_SHARE_READ_WRITE,
            IntPtr.Zero, OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, IntPtr.Zero);
        if (handle == InvalidHandle)
            throw new InvalidOperationException("workspace-ancestor-unavailable");
        BY_HANDLE_FILE_INFORMATION info;
        if (!GetFileInformationByHandle(handle, out info) ||
            (info.attributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0 ||
            (info.attributes & (uint)FileAttributes.Directory) == 0)
        {
            CloseHandle(handle);
            throw new InvalidOperationException("workspace-ancestor-reparse");
        }
        pinned.Add(handle);
    }

    internal bool IsRetained()
    {
        if (pinned.Count == 0) return false;
        IntPtr leaf = pinned[pinned.Count - 1];
        BY_HANDLE_FILE_INFORMATION now;
        try
        {
            if (!GetFileInformationByHandle(leaf, out now) ||
                (now.attributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0 ||
                !Same(identity, ReadIdentity(leaf))) return false;
        }
        catch { return false; }
        IntPtr check = CreateFile(path, FILE_READ_ATTRIBUTES, FILE_SHARE_READ_WRITE,
            IntPtr.Zero, OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, IntPtr.Zero);
        if (check == InvalidHandle) return false;
        try
        {
            BY_HANDLE_FILE_INFORMATION atPath;
            if (!GetFileInformationByHandle(check, out atPath) ||
                (atPath.attributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0) return false;
            FILE_IDENTITY checkedIdentity = ReadIdentity(check);
#if APPCONTAINER_TEST
            // Simulate a ReFS identity whose upper 64 bits differ while the
            // legacy truncated index remains unchanged.
            if (Path.GetFileName(path) == "inventory-fileid-mismatch-workspace")
                checkedIdentity.id[15] ^= 1;
#endif
            return Same(identity, checkedIdentity);
        }
        catch { return false; }
        finally { CloseHandle(check); }
    }

    private static FILE_IDENTITY ReadIdentity(IntPtr handle)
    {
#if APPCONTAINER_TEST
        if (FileIdUnavailableForTest)
            throw new InvalidOperationException("workspace-file-id-unavailable");
#endif
        // FileIdInfo has a 64-bit volume serial and a 128-bit file ID. The
        // older BY_HANDLE_FILE_INFORMATION index can truncate ReFS IDs.
        IntPtr buffer = Marshal.AllocHGlobal(24);
        try
        {
            if (!GetFileInformationByHandleEx(handle, 18, buffer, 24))
                throw new InvalidOperationException("workspace-file-id-unavailable");
            FILE_IDENTITY value = new FILE_IDENTITY();
            value.volume = unchecked((ulong)Marshal.ReadInt64(buffer));
            value.id = new byte[16];
            Marshal.Copy(IntPtr.Add(buffer, 8), value.id, 0, value.id.Length);
            return value;
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }

    private static bool Same(FILE_IDENTITY a, FILE_IDENTITY b)
    {
        if (a.volume != b.volume || a.id == null || b.id == null ||
            a.id.Length != 16 || b.id.Length != 16) return false;
        for (int i = 0; i < 16; i++) if (a.id[i] != b.id[i]) return false;
        return true;
    }

    public void Dispose()
    {
        for (int i = pinned.Count - 1; i >= 0; i--) CloseHandle(pinned[i]);
        pinned.Clear();
    }
}
