using System;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

// Administrative installer only. No parent/source image is accepted.
// The supplied descriptor is applied at file creation. This creator leaves the
// containing directory's permissions unchanged; the caller checks its pin.
public static class ProtectedInstallDisk
{
    [StructLayout(LayoutKind.Sequential)]
    private struct StorageType { internal uint Device; internal Guid Vendor; }
    [StructLayout(LayoutKind.Explicit, Size = 128)]
    private struct CreateParameters
    {
        [FieldOffset(0)] internal uint Version;
        [FieldOffset(8)] internal Guid UniqueId;
        [FieldOffset(24)] internal ulong MaximumSize;
        [FieldOffset(32)] internal uint BlockSize;
        [FieldOffset(36)] internal uint SectorSize;
        [FieldOffset(40)] internal uint PhysicalSectorSize;
        [FieldOffset(48)] internal IntPtr ParentPath;
        [FieldOffset(56)] internal IntPtr SourcePath;
        // Remaining OpenFlags, parent/source storage types and resiliency ID
        // remain zero. Native x64 layout has an eight-byte aligned union.
    }
    [DllImport("virtdisk.dll", CharSet = CharSet.Unicode)]
    private static extern uint CreateVirtualDisk(ref StorageType type, string path, uint access,
        IntPtr descriptor, uint flags, uint providerFlags, ref CreateParameters parameters,
        IntPtr overlapped, out IntPtr handle);
    public static void Create(string path, byte[] descriptor)
    {
        if (!Environment.Is64BitProcess || path == null || path.Length > 2048 ||
            !String.Equals(path, Path.GetFullPath(path), StringComparison.OrdinalIgnoreCase) ||
            !Path.IsPathRooted(path) || path.StartsWith("\\\\", StringComparison.Ordinal) || path.IndexOf(':', 2) >= 0 ||
            !path.EndsWith(".vhdx", StringComparison.Ordinal) || descriptor == null || descriptor.Length == 0 || descriptor.Length > 65536)
            throw new InvalidDataException("protected-vm-new-disk-input-refused");
        if (File.Exists(path) || Directory.Exists(path)) throw new InvalidDataException("protected-vm-fresh-disk-required");
        var type = new StorageType { Device = 3, Vendor = new Guid("ec984aec-a0f9-47e9-901f-71415a66345b") };
        var parameters = new CreateParameters { Version = 2, UniqueId = Guid.NewGuid(),
            MaximumSize = 64UL * 1024 * 1024 * 1024, SectorSize = 512, PhysicalSectorSize = 4096 };
        GCHandle pinned = GCHandle.Alloc(descriptor, GCHandleType.Pinned);
        try {
            IntPtr raw;
            // Synchronous, dynamic, no parents/source, V2 requires ACCESS_NONE.
            uint code;
            using (ProtectedCreationSecurity.Enter(descriptor))
                code = CreateVirtualDisk(ref type, path, 0, pinned.AddrOfPinnedObject(), 0, 0,
                    ref parameters, IntPtr.Zero, out raw);
            // Failure leaves the output handle undefined; never close it.
            if (code != 0) {
                var failure = new InvalidOperationException("protected-vm-native-disk-create-refused");
                if (code <= Int32.MaxValue) failure.Data["protectedNativeWin32"] = (int)code;
                throw failure;
            }
            using (var handle = new SafeFileHandle(raw, true)) {
                if (handle.IsInvalid) throw new InvalidOperationException("protected-vm-native-disk-create-refused");
            }
        } finally { pinned.Free(); }
    }
}
