using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace Aegis.HookConfigTarget;

// Win32 layouts and sharing semantics are linked in CLAUDE-HOOK-WINDOWS-TARGET.md.
internal static class Native
{
    internal const uint Read = 0x80000000, Write = 0x40000000, ReadAttributes = 0x80, Delete = 0x10000;
    internal const uint ShareRead = 1, ShareWrite = 2, ShareDelete = 4;
    internal const uint Reparse = 0x00200000, Backup = 0x02000000;

    [StructLayout(LayoutKind.Sequential)]
    internal readonly record struct Identity(ulong Volume, ulong Low, ulong High);

    [StructLayout(LayoutKind.Sequential)]
    internal struct Standard
    {
        internal long Allocation, Length;
        internal uint Links;
        internal byte DeletePending, Directory;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct Basic
    {
        internal long Creation, Access, Write, Change;
        internal uint Attributes;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFileW(string name, uint access, uint share,
        nint security, uint disposition, uint flags, nint template);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint GetFileType(SafeFileHandle file);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetFinalPathNameByHandleW(SafeFileHandle file,
        StringBuilder path, uint size, uint flags);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool GetVolumeInformationByHandleW(SafeFileHandle file,
        nint volume, uint volumeSize, out uint serial, out uint maxComponent,
        out uint flags, StringBuilder fs, uint fsSize);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    internal static extern uint GetDriveTypeW(string root);

    [DllImport("kernel32.dll", EntryPoint = "GetFileInformationByHandleEx", SetLastError = true)]
    private static extern bool GetIdentity(SafeFileHandle file, int kind, out Identity value, uint size);

    [DllImport("kernel32.dll", EntryPoint = "GetFileInformationByHandleEx", SetLastError = true)]
    private static extern bool GetStandard(SafeFileHandle file, int kind, out Standard value, uint size);

    [DllImport("kernel32.dll", EntryPoint = "GetFileInformationByHandleEx", SetLastError = true)]
    private static extern bool GetBasic(SafeFileHandle file, int kind, out Basic value, uint size);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetFileInformationByHandle(SafeFileHandle file,
        int kind, in Basic value, uint size);

    [DllImport("kernel32.dll", EntryPoint = "SetFileInformationByHandle", SetLastError = true)]
    private static extern bool SetDisposition(SafeFileHandle file, int kind, in byte deleteFile, uint size);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetFileAttributesW(string path);

    internal static void MarkDelete(SafeFileHandle handle)
    {
        byte deleteFile = 1;
        Require(SetDisposition(handle, 4, in deleteFile, 1));
    }

    internal static bool DefinitelyAbsent(string path)
    {
        uint attributes = GetFileAttributesW(path);
        return attributes == uint.MaxValue && Marshal.GetLastWin32Error() == 2;
    }

    internal static void Require(bool condition)
    {
        if (!condition) throw new TargetRefusal();
    }

    internal static SafeFileHandle Open(string path, uint access, uint share, bool directory)
    {
        var handle = CreateFileW(path, access, share, 0, 3, Reparse | (directory ? Backup : 0), 0);
        if (!handle.IsInvalid) return handle;
        handle.Dispose();
        throw new TargetRefusal();
    }

    internal static SafeFileHandle CreateNew(string path)
    {
        // CREATE_NEW never opens or truncates an existing path. The retained
        // handle excludes write and delete sharing until the caller closes it.
        var handle = CreateFileW(path, Read | Write, ShareRead, 0, 1, Reparse, 0);
        if (!handle.IsInvalid) return handle;
        handle.Dispose();
        throw new TargetRefusal();
    }

    internal static (Identity Id, Basic Metadata, Standard State) Inspect(
        SafeFileHandle handle, string path, bool directory)
    {
        Require(GetFileType(handle) == 1);
        Require(GetIdentity(handle, 18, out var id, 24));
        Require(id.Volume != 0 && (id.Low != 0 || id.High != 0));
        Require(GetStandard(handle, 1, out var state, 24));
        Require(state.DeletePending == 0 && (state.Directory != 0) == directory);
        Require(directory || state.Links == 1);
        Require(GetBasic(handle, 0, out var metadata, 40));
        // Reject reparse, sparse, compressed, encrypted, offline, cloud and unknown attributes.
        uint supported = directory ? 0x20B7u : 0x21A2u;
        Require((metadata.Attributes & ~supported) == 0);
        Require(directory || (metadata.Attributes & 0x11u) == 0);
        var final = new StringBuilder(1024);
        uint length = GetFinalPathNameByHandleW(handle, final, (uint)final.Capacity, 0);
        Require(length > 0 && length < final.Capacity);
        Require(String.Equals(final.ToString(), @"\\?\" + path, StringComparison.Ordinal));
        var fs = new StringBuilder(32);
        Require(GetVolumeInformationByHandleW(handle, 0, 0, out _, out _, out var flags, fs, 32));
        Require(fs.ToString() == "NTFS" && (flags & 8) != 0);
        return (id, metadata, state);
    }

    internal static byte[] ReadExact(SafeFileHandle handle, long length)
    {
        Require(length >= 0 && length <= TargetLease.MaxBytes);
        var bytes = new byte[(int)length];
        int offset = 0;
        while (offset < bytes.Length)
        {
            int count = RandomAccess.Read(handle, bytes.AsSpan(offset), offset);
            Require(count > 0);
            offset += count;
        }
        Require(GetStandard(handle, 1, out var state, 24) && state.Length == length);
        return bytes;
    }

    // Zero time fields keep native modification signaling. Only ordinary
    // attributes are restored; no security descriptor is changed.
    internal static void RestoreAttributes(SafeFileHandle handle, uint attributes)
    {
        var metadata = new Basic { Attributes = attributes };
        Require(SetFileInformationByHandle(handle, 0, in metadata, 40));
    }
}

internal sealed class TargetRefusal : Exception;
