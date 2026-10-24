using System.Buffers.Binary;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace Aegis.EtwLifecycle;

// Experimental x64 handle metadata bridge. SystemExtendedHandleInformation is
// an undocumented OS layout: denial, redaction, size/layout mismatch or missing
// entry fail closed. No token privilege or machine security setting is changed.
// All kernel addresses remain collector-private and are never serialized.
internal sealed class FileObjectNative(SafeProcessHandle process, SafeFileHandle file) : IFileObjectPin
{
    private sealed record HandleEntry(ulong Object, ulong Pid, ulong Handle);
    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    private delegate int Query(int infoClass, IntPtr buffer, uint length, out uint needed);
    [DllImport("kernel32.dll")] private static extern SafeProcessHandle OpenProcess(uint rights, bool inherit, uint pid);
    [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll")] private static extern bool DuplicateHandle(SafeProcessHandle source, IntPtr handle,
        IntPtr target, out SafeFileHandle duplicate, uint access, bool inherit, uint options);
    [DllImport("kernel32.dll")] private static extern bool GetProcessTimes(SafeProcessHandle process,
        out ulong birth, out ulong exit, out ulong kernel, out ulong user);
    [DllImport("kernel32.dll")] private static extern uint WaitForSingleObject(SafeHandle handle, uint timeout);
    [DllImport("kernel32.dll")] private static extern uint GetFileType(SafeFileHandle file);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern uint GetDriveType(string root);
    internal static bool LocalScope(string root) => root.Length >= 3 && GetDriveType(root[..3]) == 3;
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern SafeFileHandle CreateFile(string path,
        uint access, uint sharing, IntPtr security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll")] private static extern bool CompareObjectHandles(SafeFileHandle first, SafeFileHandle second);
    [DllImport("kernel32.dll")] private static extern bool GetFileInformationByHandleEx(SafeFileHandle file,
        int infoClass, IntPtr information, uint size);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern uint GetFinalPathNameByHandle(SafeFileHandle file, StringBuilder path, uint size, uint flags);
    public bool Alive() => !file.IsInvalid && !file.IsClosed && WaitForSingleObject(process, 0) == 258;
    public ulong Birth() => GetProcessTimes(process, out ulong birth, out ulong exit, out _, out _) && exit == 0 ? birth : 0;
    public FileObjectLabel? Inspect()
    {
        if (!Alive() || GetFileType(file) != 1) return null; // No pipe/device metadata probes.
        IntPtr buffer = Marshal.AllocHGlobal(24);
        try
        {
            // FILE_STANDARD_INFO: reject directories and delete-pending objects.
            if (!GetFileInformationByHandleEx(file, 1, buffer, 24) || Marshal.ReadByte(buffer, 20) != 0 ||
                Marshal.ReadByte(buffer, 21) != 0) return null;
            // FILE_ID_INFO contains the volume serial and full 128-bit file ID.
            if (!GetFileInformationByHandleEx(file, 18, buffer, 24)) return null;
            byte[] identity = new byte[24]; Marshal.Copy(buffer, identity, 0, identity.Length);
            ulong volume = BinaryPrimitives.ReadUInt64LittleEndian(identity);
            string id = Convert.ToHexString(identity.AsSpan(8, 16)).ToLowerInvariant();
            if (id == new string('0', 32)) return null;
            var path = new StringBuilder(32769);
            uint count = GetFinalPathNameByHandle(file, path, (uint)path.Capacity, 0);
            if (count == 0 || count >= path.Capacity) return null;
            string label = path.ToString();
            if (!label.StartsWith(@"\\?\", StringComparison.Ordinal) || label.Length < 8 ||
                !char.IsAsciiLetter(label[4]) || label[5] != ':' || label[6] != '\\' || label[6..].Contains(':')) return null;
            return LocalScope(label[4..]) ? new(volume, id, label[4..]) : null;
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }
    public void Dispose() { file.Dispose(); process.Dispose(); }

    internal const string Profile = "win11-x64-26300.9457-experimental";
    internal static Func<uint, ulong, ulong, IFileObjectPin?>? Qualify()
    {
        var os = FullWindowsVersion();
        if (os == null || !OperatingSystem.IsWindows() || !Environment.Is64BitProcess ||
            RuntimeInformation.OSArchitecture != Architecture.X64 || RuntimeInformation.ProcessArchitecture != Architecture.X64 ||
            os != new Version(10, 0, 26300, 9457) || !SelfProbe()) return null;
        return (pid, birth, obj) => OpenForQualification(pid, birth, obj, os);
    }
    private static Version? FullWindowsVersion()
    {
        if (!OperatingSystem.IsWindows()) return null;
        try
        {
            using var key = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows NT\CurrentVersion");
            using var product = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Control\ProductOptions");
            if (!StringComparer.Ordinal.Equals(product?.GetValue("ProductType") as string, "WinNT")) return null;
            if (key?.GetValue("UBR") is not int revision || revision < 0) return null;
            var os = Environment.OSVersion.Version;
            return new(os.Major, os.Minor, os.Build, revision);
        }
        catch { return null; }
    }
    private static bool SelfProbe()
    {
        try
        {
            using var own = OpenProcess(0x101040, false, (uint)Environment.ProcessId);
            using var known = CreateFile(Program.Executable, 0x80, 7, IntPtr.Zero, 3, 0, IntPtr.Zero);
            using var distinct = CreateFile(Program.Executable, 0x80, 7, IntPtr.Zero, 3, 0, IntPtr.Zero);
            if (own.IsInvalid || known.IsInvalid || distinct.IsInvalid || GetFileType(known) != 1 ||
                !DuplicateHandle(own, known.DangerousGetHandle(), GetCurrentProcess(), out var copy, 0x80, false, 0)) return false;
            using (copy)
            {
                if (copy.IsInvalid || !CompareObjectHandles(known, copy) || CompareObjectHandles(known, distinct)) return false;
                var knownId = IdBytes(known); var otherId = IdBytes(distinct);
                if (knownId == null || otherId == null || !knownId.SequenceEqual(otherId)) return false;
                var entries = Snapshot((uint)Environment.ProcessId, null);
                if (entries == null) return false;
                ulong a = unchecked((ulong)known.DangerousGetHandle().ToInt64());
                ulong b = unchecked((ulong)copy.DangerousGetHandle().ToInt64());
                ulong c = unchecked((ulong)distinct.DangerousGetHandle().ToInt64());
                var first = entries.SingleOrDefault(row => row.Handle == a);
                var second = entries.SingleOrDefault(row => row.Handle == b);
                var third = entries.SingleOrDefault(row => row.Handle == c);
                return first != null && second != null && third != null && first.Object != 0 &&
                    first.Object == second.Object && first.Object != third.Object;
            }
        }
        catch { return false; }
    }
    private static byte[]? IdBytes(SafeFileHandle handle)
    {
        IntPtr buffer = Marshal.AllocHGlobal(24);
        try
        {
            if (!GetFileInformationByHandleEx(handle, 18, buffer, 24)) return null;
            byte[] identity = new byte[24]; Marshal.Copy(buffer, identity, 0, identity.Length); return identity;
        }
        finally { Marshal.FreeHGlobal(buffer); }
    }

    // Qualification only. This exact full OS version must be selected and
    // recorded by the disposable-cloud harness; matching it is not itself a
    // production qualification receipt or a supported ABI declaration.
    internal static IFileObjectPin? OpenForQualification(uint pid, ulong birth, ulong objectPointer, Version expectedWindows)
    {
        if (!OperatingSystem.IsWindows() || !Environment.Is64BitProcess || objectPointer == 0 ||
            pid is 0 or uint.MaxValue || birth == 0 || FullWindowsVersion() != expectedWindows) return null;
        var source = OpenProcess(0x101040, false, pid); // DUP_HANDLE, QUERY_LIMITED_INFORMATION, SYNCHRONIZE.
        if (source.IsInvalid) { source.Dispose(); return null; }
        SafeFileHandle? duplicated = null;
        try
        {
            if (!GetProcessTimes(source, out ulong actualBirth, out ulong exit, out _, out _) ||
                actualBirth != birth || exit != 0 || WaitForSingleObject(source, 0) != 258) return null;
            var first = Snapshot(pid, null);
            if (first == null) return null;
            foreach (var original in first.Where(row => row.Pid == pid && row.Object == objectPointer).Take(16))
            {
                // Attribute access only. Never close/change the issuer's handle,
                // read contents, use SAME_ACCESS or enable SeDebugPrivilege.
                if (!DuplicateHandle(source, new IntPtr(unchecked((long)original.Handle)), GetCurrentProcess(),
                    out var copy, 0x80, false, 0)) { copy?.Dispose(); continue; }
                duplicated = copy;
                if (copy.IsInvalid || GetFileType(copy) != 1) { copy.Dispose(); duplicated = null; continue; }
                var second = Snapshot(pid, (uint)Environment.ProcessId);
                ulong copyValue = unchecked((ulong)copy.DangerousGetHandle().ToInt64());
                bool same = second != null &&
                    second.Any(row => row.Pid == pid && row.Handle == original.Handle && row.Object == objectPointer) &&
                    second.Any(row => row.Pid == (uint)Environment.ProcessId && row.Handle == copyValue && row.Object == objectPointer);
                if (!same || !GetProcessTimes(source, out actualBirth, out exit, out _, out _) ||
                    actualBirth != birth || exit != 0 || WaitForSingleObject(source, 0) != 258)
                { copy.Dispose(); duplicated = null; continue; }
                var result = new FileObjectNative(source, copy);
                source = null!; duplicated = null; return result;
            }
            return null;
        }
        catch { return null; }
        finally { duplicated?.Dispose(); source?.Dispose(); }
    }
    private static List<HandleEntry>? Snapshot(uint issuer, uint? own)
    {
        const int maximum = 32 * 1024 * 1024;
        if (!NativeLibrary.TryLoad("ntdll.dll", out IntPtr module)) return null;
        try
        {
            if (!NativeLibrary.TryGetExport(module, "NtQuerySystemInformation", out IntPtr address)) return null;
            var query = Marshal.GetDelegateForFunctionPointer<Query>(address);
            int size = 1024 * 1024;
            for (int attempt = 0; attempt < 3; attempt++)
            {
                IntPtr buffer = Marshal.AllocHGlobal(size);
                try
                {
                    int status = query(64, buffer, (uint)size, out uint needed);
                    if (status == unchecked((int)0xc0000004))
                    {
                        if (needed > maximum || needed <= size) return null;
                        size = checked((int)Math.Min(maximum, needed + 64 * 1024L)); continue;
                    }
                    if (status != 0 || needed < 16 || needed > size) return null;
                    ulong count = unchecked((ulong)Marshal.ReadInt64(buffer));
                    if (count > (ulong)(needed - 16) / 40 || count > 800000) return null;
                    var selected = new List<HandleEntry>();
                    for (ulong index = 0; index < count; index++)
                    {
                        IntPtr entry = IntPtr.Add(buffer, checked(16 + (int)index * 40));
                        ulong owner = unchecked((ulong)Marshal.ReadInt64(entry, 8));
                        if (owner != issuer && owner != own) continue;
                        ulong obj = unchecked((ulong)Marshal.ReadInt64(entry));
                        ulong handle = unchecked((ulong)Marshal.ReadInt64(entry, 16));
                        if (obj == 0 || (obj & 7) != 0 || handle == 0) return null;
                        if (selected.Count >= 16384) return null;
                        selected.Add(new(obj, owner, handle));
                    }
                    return selected;
                }
                finally { Marshal.FreeHGlobal(buffer); }
            }
            return null;
        }
        finally { NativeLibrary.Free(module); }
    }
}
