using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Win32.SafeHandles;

// Installer authority remains in an elevated, explicitly authorized provisioner.
// No process, service or ACL mutation occurs merely by loading this assembly.
public sealed class ProtectedInstallFile : IDisposable
{
    [StructLayout(LayoutKind.Sequential)] private struct SecurityAttributes { internal int length; internal IntPtr descriptor; internal int inherit; }
    [DllImport("kernel32.dll", EntryPoint = "CreateDirectoryW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateDirectoryNative(string path, ref SecurityAttributes attributes);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(string path, uint access, uint share,
        IntPtr security, uint create, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetFileInformationByHandleEx(SafeFileHandle file, int kind, byte[] value, uint length);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint GetFinalPathNameByHandle(SafeFileHandle file, StringBuilder text, uint length, uint flags);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetFileInformationByHandle(SafeFileHandle file, int kind, IntPtr data, uint size);
    [StructLayout(LayoutKind.Sequential)] private struct IoStatus { internal IntPtr Status; internal UIntPtr Information; }
    [DllImport("ntdll.dll")]
    private static extern int NtSetInformationFile(SafeFileHandle file, IntPtr status, IntPtr data, uint size, int kind);
    [DllImport("ntdll.dll")]
    private static extern uint RtlNtStatusToDosError(int status);
    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern uint GetSecurityInfo(SafeFileHandle file, int type, uint information,
        out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr descriptor);
    [DllImport("advapi32.dll")] private static extern uint GetSecurityDescriptorLength(IntPtr descriptor);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr value);
    private readonly SafeFileHandle held;
    private static readonly object RenameGate = new object();
    private static RenameBuffers pendingRename;
    // At most one unresolved synchronous rename retains its exact handles and
    // native buffers until process teardown. No further rename can be attempted.
    private sealed class RenameBuffers : IDisposable
    {
        internal IntPtr Information, Status;
        private readonly SafeFileHandle source, parent;
        private bool sourceReference, parentReference;
        internal RenameBuffers(SafeFileHandle source, SafeFileHandle parent, int size)
        {
            this.source = source; this.parent = parent;
            try {
                source.DangerousAddRef(ref sourceReference); parent.DangerousAddRef(ref parentReference);
                Information = Marshal.AllocHGlobal(size); Status = Marshal.AllocHGlobal(IntPtr.Size * 2);
                for (int i = 0; i < size; i++) Marshal.WriteByte(Information, i, 0);
                for (int i = 0; i < IntPtr.Size * 2; i++) Marshal.WriteByte(Status, i, 0);
            } catch { Dispose(); throw; }
        }
        public void Dispose()
        {
            if (Information != IntPtr.Zero) { Marshal.FreeHGlobal(Information); Information = IntPtr.Zero; }
            if (Status != IntPtr.Zero) { Marshal.FreeHGlobal(Status); Status = IntPtr.Zero; }
            if (parentReference) { parent.DangerousRelease(); parentReference = false; }
            if (sourceReference) { source.DangerousRelease(); sourceReference = false; }
        }
    }
    private FileStream stream;
    private readonly byte[] identity, security;
    private bool closed;
    public string PathName { get; private set; }
    public string Volume { get; private set; }
    public string FileId { get; private set; }
    public string Sddl { get; private set; }
    public bool Directory { get; private set; }
    private static void Require(bool value) { if (!value) throw new InvalidDataException("protected-file-refused"); }
    private static InvalidDataException NativeFailure(string operation, int? nativeWin32)
    {
        var failure = new InvalidDataException("protected-file-native-refused");
        failure.Data["protectedOperation"] = operation;
        if (nativeWin32.HasValue) failure.Data["protectedNativeWin32"] = nativeWin32.Value;
        return failure;
    }
    private static void RequireNative(bool value, string operation)
    {
        if (!value) {
            // Capture only the failed call's error, before exception allocation.
            int code = Marshal.GetLastWin32Error();
            throw NativeFailure(operation, code);
        }
    }
    private static InvalidDataException HandoffUnknown(Exception cause)
    {
        var unknown = new InvalidDataException("protected-file-handoff-cleanup-unknown", cause);
        unknown.Data["protectedCleanupUnknown"] = true;
        return unknown;
    }
    private static int? MapNtFailure(int status)
    {
        try {
            uint code = RtlNtStatusToDosError(status);
            return code > 0 && code != 317 && code <= Int32.MaxValue ? (int?)code : null;
        } catch (EntryPointNotFoundException) { return null; }
          catch (DllNotFoundException) { return null; }
    }
    private static string Hex(byte[] bytes) { return BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant(); }
    public static ProtectedInstallFile CreateDirectory(string path, byte[] descriptor)
    {
        Require(path != null && path.Length <= 2048 && Path.IsPathRooted(path) && !path.StartsWith("\\\\", StringComparison.Ordinal) &&
            path.IndexOf(':', 2) < 0 && String.Equals(path, Path.GetFullPath(path), StringComparison.OrdinalIgnoreCase));
        Require(descriptor != null && descriptor.Length > 0 && descriptor.Length <= 65536);
        GCHandle pinned = GCHandle.Alloc(descriptor, GCHandleType.Pinned);
        try {
            var attributes = new SecurityAttributes { length = Marshal.SizeOf(typeof(SecurityAttributes)), descriptor = pinned.AddrOfPinnedObject(), inherit = 0 };
            // Unlike .NET CreateDirectory, an existing directory is never success.
            RequireNative(CreateDirectoryNative(path, ref attributes), "protected-file-create-directory");
            try { return new ProtectedInstallFile(path, true, true); }
            catch (Exception failure) {
                var unknown = new InvalidDataException("protected-directory-creation-cleanup-unknown", failure);
                unknown.Data["protectedCleanupUnknown"] = true;
                throw unknown;
            }
        } finally { pinned.Free(); }
    }
    private byte[] Query(int kind, int size)
    {
        byte[] bytes = new byte[size];
        RequireNative(GetFileInformationByHandleEx(held, kind, bytes, (uint)size),
            kind == 9 ? "protected-file-query-attributes" : "protected-file-query-identity");
        return bytes;
    }
    private string Name()
    {
        var text = new StringBuilder(4096); uint count = GetFinalPathNameByHandle(held, text, (uint)text.Capacity, 0);
        RequireNative(count != 0, "protected-file-final-path");
        Require(count > 4 && count < text.Capacity && text.ToString().StartsWith("\\\\?\\", StringComparison.Ordinal));
        return text.ToString().Substring(4);
    }
    private byte[] Security()
    {
        IntPtr owner, group, dacl, sacl, descriptor;
        uint result = GetSecurityInfo(held, 1, 5, out owner, out group, out dacl, out sacl, out descriptor);
        try {
            // This API returns a status code; LastError is not its error channel.
            if (result != 0) throw NativeFailure("protected-file-query-security", null);
            Require(owner != IntPtr.Zero && dacl != IntPtr.Zero && descriptor != IntPtr.Zero);
            uint size = GetSecurityDescriptorLength(descriptor); Require(size > 0 && size <= 65536);
            byte[] bytes = new byte[size]; Marshal.Copy(descriptor, bytes, 0, (int)size); return bytes;
        } finally { if (descriptor != IntPtr.Zero) LocalFree(descriptor); }
    }
    public ProtectedInstallFile(string path, bool directory, bool mutate)
    {
        Require(path.Length <= 2048 && Path.IsPathRooted(path) && !path.StartsWith("\\\\", StringComparison.Ordinal) &&
            path.IndexOf(':', 2) < 0 && String.Equals(path, Path.GetFullPath(path), StringComparison.OrdinalIgnoreCase));
        // A held parent/leaf refuses foreign delete/rename while identities are checked.
        held = CreateFile(path, (directory ? 0x20080U : 0x80020000U) | (mutate ? 0x10000U : 0),
            1, IntPtr.Zero, 3, 0x00200000U | (directory ? 0x02000000U : 0), IntPtr.Zero);
        try {
            RequireNative(held != null && !held.IsInvalid,
                directory ? "protected-file-open-directory" : "protected-file-open-leaf");
            uint attributes = BitConverter.ToUInt32(Query(9, 8), 0);
            Require((attributes & 0x400) == 0 && ((attributes & 0x10) != 0) == directory);
            Directory = directory; PathName = Name(); Require(String.Equals(path, PathName, StringComparison.OrdinalIgnoreCase));
            identity = Query(18, 24); Volume = BitConverter.ToUInt64(identity, 0).ToString("x16");
            byte[] id = new byte[16]; Array.Copy(identity, 8, id, 0, 16); FileId = Hex(id);
            Require(Volume != new string('0', 16) && FileId != new string('0', 32));
            security = Security(); Sddl = new RawSecurityDescriptor(security, 0).GetSddlForm(AccessControlSections.Owner | AccessControlSections.Access);
        } catch { if (held != null) held.Dispose(); throw; }
    }
    public void Recheck()
    {
        Require(!closed && Hex(Query(18, 24)) == Hex(identity) && Hex(Security()) == Hex(security) &&
            String.Equals(Name(), PathName, StringComparison.OrdinalIgnoreCase));
    }
    public bool Protected(bool ancestor)
    {
        Recheck(); var sd = new RawSecurityDescriptor(security, 0);
        Func<string, bool> trusted = delegate(string sid) {
            return sid == "S-1-5-18" || sid == "S-1-5-32-544" ||
                (ancestor && sid == "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464");
        };
        if (sd.Owner == null || !trusted(sd.Owner.Value) || sd.DiscretionaryAcl == null) return false;
        uint write = ancestor ? 0x500D0040U : 0x500D0156U;
        foreach (GenericAce entry in sd.DiscretionaryAcl) {
            CommonAce ace = entry as CommonAce;
            if (ace == null || ace.IsCallback) return false;
            if ((ace.AceFlags & AceFlags.InheritOnly) != 0 || ace.AceQualifier == AceQualifier.AccessDenied) continue;
            if (ace.AceQualifier != AceQualifier.AccessAllowed ||
                ((unchecked((uint)ace.AccessMask) & write) != 0 && !trusted(ace.SecurityIdentifier.Value))) return false;
        }
        return true;
    }
    public byte[] Read(int cap)
    {
        Recheck(); Require(!Directory && cap > 0 && cap <= 4 * 1024 * 1024);
        if (stream == null) stream = new FileStream(held, FileAccess.Read, 65536, false);
        Require(stream.Length > 0 && stream.Length <= cap); stream.Position = 0;
        byte[] bytes = new byte[(int)stream.Length]; int offset = 0;
        while (offset < bytes.Length) { int count = stream.Read(bytes, offset, bytes.Length - offset); Require(count > 0); offset += count; }
        Require(stream.ReadByte() == -1); Recheck(); return bytes;
    }
    public string Hash(int cap)
    {
        byte[] bytes = Read(cap); try { using (SHA256 hash = SHA256.Create()) return Hex(hash.ComputeHash(bytes)); }
        finally { Array.Clear(bytes, 0, bytes.Length); }
    }
    public void Rename(string destination, ProtectedInstallFile parent)
    {
      lock (RenameGate) {
        if (pendingRename != null) throw HandoffUnknown(null);
        Recheck(); Require(parent != null && !Object.ReferenceEquals(parent, this)); parent.Recheck();
        Require(Directory && parent.Directory && Volume == parent.Volume && destination != null && destination.Length <= 2048 &&
            Path.IsPathRooted(destination) && !destination.StartsWith("\\\\", StringComparison.Ordinal) && destination.IndexOf(':', 2) < 0 &&
            String.Equals(destination, Path.GetFullPath(destination), StringComparison.OrdinalIgnoreCase) &&
            String.Equals(Path.GetDirectoryName(PathName), parent.PathName, StringComparison.OrdinalIgnoreCase) &&
            String.Equals(Path.GetDirectoryName(destination), parent.PathName, StringComparison.OrdinalIgnoreCase));
        // A simple name and null native RootDirectory rename within the same
        // directory. The original parent remains held and tuple-checked.
        byte[] name = Encoding.Unicode.GetBytes(Path.GetFileName(destination) + "\0"); int offset = IntPtr.Size == 8 ? 20 : 12;
        int size = (IntPtr.Size == 8 ? 24 : 16) + name.Length;
        Require(Marshal.SizeOf(typeof(IoStatus)) == IntPtr.Size * 2);
        RenameBuffers buffers = new RenameBuffers(held, parent.held, size);
        try {
            Marshal.WriteInt32(buffers.Information, IntPtr.Size == 8 ? 16 : 8, name.Length - 2);
            Marshal.Copy(name, 0, IntPtr.Add(buffers.Information, offset), name.Length);
            // These CreateFile handles are synchronous (no FILE_FLAG_OVERLAPPED).
            // Absolute targets and the Win32 relative-root wrapper reopen or
            // reject the retained parent on this runtime.
            int status = NtSetInformationFile(held, buffers.Status, buffers.Information, (uint)size, 10);
            if (status == 0x103) { pendingRename = buffers; buffers = null; throw HandoffUnknown(null); }
            // NTSTATUS is returned directly; it is not an ambient LastError.
            if (status < 0) {
                var failure = NativeFailure("protected-file-rename-directory", MapNtFailure(status));
                failure.Data["protectedNativeNtStatus"] = status;
                throw failure;
            }
            try { PathName = destination; Recheck(); parent.Recheck(); }
            catch (Exception failure) { throw HandoffUnknown(failure); }
        } finally { if (buffers != null) buffers.Dispose(); }
      }
    }
    public void Delete()
    {
        Recheck(); IntPtr data = Marshal.AllocHGlobal(4);
        try { Marshal.WriteInt32(data, 1); RequireNative(SetFileInformationByHandle(held, 4, data, 4), "protected-file-delete"); }
        finally { Marshal.FreeHGlobal(data); }
        Dispose();
    }
    public void Dispose()
    {
        if (closed) return; closed = true;
        try { if (stream != null) stream.Dispose(); } finally { held.Dispose(); }
    }
}
