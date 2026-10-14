using System;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace Aegis.ProtectedSession
{
    internal sealed partial class EnrollmentNative
    {
        private sealed partial class Held
        {
            internal override void RequireStandaloneDisk()
            {
                Require(!disposed && !directory);
                Recheck(false);
                VmDiskImageNative.RequireStandalone(name);
                Recheck(false);
            }
        }
    }
    // Called only while EnrollmentNative retains the exact file and its ancestors.
    // Information access never opens parent chains, attaches or modifies a disk.
    internal static class VmDiskImageNative
    {
        private static readonly Guid MicrosoftVendor = new Guid("ec984aec-a0f9-47e9-901f-71415a66345b");
        [StructLayout(LayoutKind.Sequential)]
        private struct StorageType { internal uint Device; internal Guid Vendor; }
        [StructLayout(LayoutKind.Sequential)]
        private struct OpenParameters { internal uint Version, ReadWriteDepth; }
        // The native union is aligned to eight bytes by its ULONGLONG members.
        [StructLayout(LayoutKind.Explicit, Size = 32)]
        private struct Information
        {
            [FieldOffset(0)] internal uint Version;
            [FieldOffset(8)] internal uint Value;
            [FieldOffset(12)] internal Guid Vendor;
        }
        [DllImport("virtdisk.dll", CharSet = CharSet.Unicode)]
        private static extern uint OpenVirtualDisk(ref StorageType type, string path, uint access,
            uint flags, ref OpenParameters parameters, out IntPtr handle);
        [DllImport("virtdisk.dll")]
        private static extern uint GetVirtualDiskInformation(SafeFileHandle handle, ref uint size,
            ref Information information, out uint used);

        private static Information Query(SafeFileHandle handle, uint version, uint minimum)
        {
            var value = new Information(); value.Version = version;
            uint size = 32, used;
            if (GetVirtualDiskInformation(handle, ref size, ref value, out used) != 0 ||
                size > 32 || used < minimum || used > 32 || value.Version != version)
                throw new InvalidDataException();
            return value;
        }
        internal static void RequireStandalone(string path)
        {
            string extension = Path.GetExtension(path);
            uint device;
            if (String.Equals(extension, ".vhd", StringComparison.OrdinalIgnoreCase)) device = 2;
            else if (String.Equals(extension, ".vhdx", StringComparison.OrdinalIgnoreCase)) device = 3;
            else throw new InvalidDataException();
            var type = new StorageType(); type.Device = device; type.Vendor = MicrosoftVendor;
            var parameters = new OpenParameters(); parameters.Version = 1; parameters.ReadWriteDepth = 0;
            IntPtr raw;
            // GET_INFO only; NO_PARENTS prevents following even a broken or remote locator.
            // Failed calls leave the output handle undefined: never close that value.
            if (OpenVirtualDisk(ref type, path, 0x00080000, 1, ref parameters, out raw) != 0)
                throw new InvalidDataException();
            using (var handle = new SafeFileHandle(raw, true))
            {
                if (handle.IsInvalid) throw new InvalidDataException();
                Information format = Query(handle, 6, 28);
                if (format.Value != device || format.Vendor != MicrosoftVendor) throw new InvalidDataException();
                uint subtype = Query(handle, 7, 12).Value;
                if (subtype != 2 && subtype != 3) throw new InvalidDataException();
            }
        }
    }
}
