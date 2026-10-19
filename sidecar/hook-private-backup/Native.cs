using Microsoft.Win32.SafeHandles;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;

namespace Aegis.HookPrivateBackup;

// Win32 layouts and flags: Microsoft Learn references in CLAUDE-HOOK-PRIVATE-BACKUP.md.
internal static class Native
{
    internal const uint Read = 0x80000000, Write = 0x40000000, ReadControl = 0x20000;
    internal const uint OpenReparse = 0x00200000, BackupSemantics = 0x02000000;
    internal const uint WriteThrough = 0x80000000, Normal = 0x80;

    [StructLayout(LayoutKind.Sequential)]
    internal struct SecurityAttributes
    {
        internal uint Length;
        internal IntPtr Descriptor;
        internal int Inherit;
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct Information
    {
        internal uint Attributes, CreationLow, CreationHigh, AccessLow, AccessHigh;
        internal uint WriteLow, WriteHigh, Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
        internal long Size => ((long)SizeHigh << 32) | SizeLow;
        internal FileIdentity Identity => new(Volume, IndexHigh, IndexLow);
    }

    internal readonly record struct FileIdentity(uint Volume, uint High, uint Low);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    internal static extern SafeFileHandle CreateFileW(string path, uint access, uint share,
        IntPtr security, uint creation, uint flags, IntPtr template);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool CreateDirectoryW(string path, ref SecurityAttributes security);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool GetFileInformationByHandle(SafeFileHandle handle, out Information info);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    internal static extern uint GetFinalPathNameByHandleW(SafeFileHandle handle,
        StringBuilder path, uint length, uint flags);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    internal static extern uint GetDriveTypeW(string root);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    internal static extern bool GetVolumeInformationW(string root, IntPtr label, uint labelLength,
        out uint serial, out uint maxComponent, out uint flags, StringBuilder fileSystem, uint size);

    [DllImport("advapi32.dll")]
    private static extern uint GetSecurityInfo(SafeFileHandle handle, uint type, uint information,
        out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr descriptor);

    [DllImport("advapi32.dll")]
    private static extern uint GetSecurityDescriptorLength(IntPtr descriptor);

    [DllImport("kernel32.dll")]
    internal static extern IntPtr LocalFree(IntPtr memory);

    internal static Information Inspect(SafeFileHandle handle, bool directory)
    {
        if (handle.IsInvalid || !GetFileInformationByHandle(handle, out var info) ||
            (info.Attributes & (uint)FileAttributes.ReparsePoint) != 0 ||
            ((info.Attributes & (uint)FileAttributes.Directory) != 0) != directory ||
            (!directory && info.Links != 1)) throw new StoreFailure(BackupStatus.UnsafeStorage);
        return info;
    }

    internal static void CheckName(SafeFileHandle handle, string expected)
    {
        var buffer = new StringBuilder(512);
        uint length = GetFinalPathNameByHandleW(handle, buffer, 512, 0);
        if (length == 0 || length >= 512 || !string.Equals(buffer.ToString().TrimEnd('\\'),
            ("\\\\?\\" + expected).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase))
            throw new StoreFailure(BackupStatus.UnsafeStorage);
    }

    internal static void CheckPrivate(SafeFileHandle handle, bool directory,
        SecurityIdentifier owner)
    {
        IntPtr descriptor = IntPtr.Zero;
        try
        {
            if (GetSecurityInfo(handle, 1, 5, out _, out _, out _, out _, out descriptor) != 0 ||
                descriptor == IntPtr.Zero) throw new StoreFailure(BackupStatus.UnsafeStorage);
            uint length = GetSecurityDescriptorLength(descriptor);
            if (length < 20 || length > 16384) throw new StoreFailure(BackupStatus.UnsafeStorage);
            byte[] bytes = new byte[length];
            Marshal.Copy(descriptor, bytes, 0, bytes.Length);
            var security = new RawSecurityDescriptor(bytes, 0);
            var system = new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null);
            var flags = directory ? AceFlags.ContainerInherit | AceFlags.ObjectInherit : AceFlags.None;
            if (security.Owner is null || !owner.Equals(security.Owner) ||
                (security.ControlFlags & ControlFlags.DiscretionaryAclProtected) == 0 ||
                security.DiscretionaryAcl is not { Count: 2 } acl)
                throw new StoreFailure(BackupStatus.UnsafeStorage);
            bool ownRule = false, systemRule = false;
            foreach (GenericAce entry in acl)
            {
                if (entry is not CommonAce ace || ace.IsCallback ||
                    ace.AceQualifier != AceQualifier.AccessAllowed || ace.AccessMask != 0x1f01ff ||
                    ace.AceFlags != flags) throw new StoreFailure(BackupStatus.UnsafeStorage);
                if (owner.Equals(ace.SecurityIdentifier)) ownRule = true;
                else if (system.Equals(ace.SecurityIdentifier)) systemRule = true;
                else throw new StoreFailure(BackupStatus.UnsafeStorage);
            }
            if (!ownRule || !systemRule) throw new StoreFailure(BackupStatus.UnsafeStorage);
        }
        finally { if (descriptor != IntPtr.Zero) LocalFree(descriptor); }
    }

    // Explicit descriptor is supplied only on CREATE_NEW / fresh CreateDirectoryW.
    internal sealed class PrivateSecurity : IDisposable
    {
        private readonly IntPtr descriptor;
        internal SecurityAttributes Attributes;
        internal PrivateSecurity(SecurityIdentifier owner, bool directory)
        {
            var acl = new RawAcl(2, 2);
            var flags = directory ? AceFlags.ContainerInherit | AceFlags.ObjectInherit : AceFlags.None;
            acl.InsertAce(0, new CommonAce(flags, AceQualifier.AccessAllowed, 0x1f01ff, owner, false, null));
            acl.InsertAce(1, new CommonAce(flags, AceQualifier.AccessAllowed, 0x1f01ff,
                new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null), false, null));
            var security = new RawSecurityDescriptor(ControlFlags.DiscretionaryAclPresent |
                ControlFlags.DiscretionaryAclProtected | ControlFlags.SelfRelative, owner, owner, null, acl);
            byte[] bytes = new byte[security.BinaryLength];
            security.GetBinaryForm(bytes, 0);
            descriptor = Marshal.AllocHGlobal(bytes.Length);
            Marshal.Copy(bytes, 0, descriptor, bytes.Length);
            Attributes = new SecurityAttributes { Length = (uint)Marshal.SizeOf<SecurityAttributes>(),
                Descriptor = descriptor, Inherit = 0 };
        }
        internal SafeFileHandle Create(string path, uint share = 0)
        {
            IntPtr attributes = Marshal.AllocHGlobal(Marshal.SizeOf<SecurityAttributes>());
            try
            {
                Marshal.StructureToPtr(Attributes, attributes, false);
                var handle = CreateFileW(path, Read | Write | ReadControl, share,
                    attributes, 1, Normal | OpenReparse | WriteThrough, IntPtr.Zero);
                if (handle.IsInvalid) { handle.Dispose(); throw new StoreFailure(BackupStatus.StorageUnavailable); }
                return handle;
            }
            finally { Marshal.FreeHGlobal(attributes); }
        }
        public void Dispose() => Marshal.FreeHGlobal(descriptor);
    }
}
