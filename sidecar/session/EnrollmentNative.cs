using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using Microsoft.Win32.SafeHandles;
using System.Text;

namespace Aegis.ProtectedSession
{
    internal interface IEnrollmentFiles { EnrollmentHeld Open(string path, bool directory); }
    internal abstract class EnrollmentHeld : IDisposable
    {
        internal abstract string PathName { get; }
        internal abstract string Volume { get; }
        internal abstract string FileId { get; }
        internal abstract bool Directory { get; }
        internal abstract bool Reparse { get; }
        internal abstract bool Protected(bool ancestor);
        internal abstract byte[] Read(int maximum);
        internal abstract void Recheck();
        public abstract void Dispose();
    }

    // Read-only: no privilege changes, ACL writes, path creation or VM calls.
    internal sealed class EnrollmentNative : IEnrollmentFiles
    {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern SafeFileHandle CreateFile(string name, uint access, uint share,
            IntPtr security, uint creation, uint flags, IntPtr template);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool GetFileInformationByHandleEx(SafeFileHandle file, int kind,
            [Out] byte[] bytes, uint size);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern uint GetFinalPathNameByHandle(SafeFileHandle file,
            StringBuilder text, uint length, uint flags);
        [DllImport("kernel32.dll")] private static extern uint GetFileType(SafeFileHandle file);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern uint GetDriveType(string root);
        [DllImport("advapi32.dll", SetLastError = true)]
        private static extern uint GetSecurityInfo(SafeFileHandle file, int type, uint information,
            out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr descriptor);
        [DllImport("advapi32.dll")] private static extern uint GetSecurityDescriptorLength(IntPtr descriptor);
        [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr allocation);

        internal static void Require(bool value) { if (!value) throw new InvalidDataException(); }
        private static string Hex(byte[] bytes) { return BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant(); }
        private static byte[] Query(SafeFileHandle file, int kind, int length)
        {
            byte[] bytes = new byte[length];
            Require(GetFileInformationByHandleEx(file, kind, bytes, (uint)bytes.Length));
            return bytes;
        }
        private static byte[] Security(SafeFileHandle file)
        {
            IntPtr owner, group, dacl, sacl, descriptor;
            uint code = GetSecurityInfo(file, 1, 5, out owner, out group, out dacl, out sacl, out descriptor);
            try {
                Require(code == 0 && descriptor != IntPtr.Zero && owner != IntPtr.Zero && dacl != IntPtr.Zero);
                uint length = GetSecurityDescriptorLength(descriptor);
                Require(length > 0 && length <= 65536);
                byte[] bytes = new byte[(int)length]; Marshal.Copy(descriptor, bytes, 0, bytes.Length);
                return bytes;
            }
            finally { if (descriptor != IntPtr.Zero) LocalFree(descriptor); }
        }
        private static string Name(SafeFileHandle file)
        {
            StringBuilder text = new StringBuilder(4096);
            uint length = GetFinalPathNameByHandle(file, text, (uint)text.Capacity, 0);
            Require(length > 4 && length < text.Capacity);
            string value = text.ToString(); Require(value.StartsWith("\\\\?\\", StringComparison.Ordinal));
            return value.Substring(4);
        }
        private static bool Trusted(string sid, bool ancestor)
        {
            return sid == "S-1-5-18" || sid == "S-1-5-32-544" || (ancestor &&
                sid == "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464");
        }
        internal static bool ProtectedDescriptor(byte[] bytes, bool ancestor)
        {
            RawSecurityDescriptor descriptor = new RawSecurityDescriptor(bytes, 0);
            if (descriptor.Owner == null || !Trusted(descriptor.Owner.Value, ancestor) ||
                descriptor.DiscretionaryAcl == null ||
                (descriptor.ControlFlags & ControlFlags.DiscretionaryAclPresent) == 0) return false;
            // Ancestors may allow new siblings; replacement of this held branch
            // and security descriptor writes must remain restricted.
            uint writes = ancestor ? 0x500D0040U : 0x500D0156U;
            foreach (GenericAce entry in descriptor.DiscretionaryAcl) {
                CommonAce ace = entry as CommonAce;
                if (ace == null || ace.IsCallback || ace.SecurityIdentifier == null) return false;
                // This ACE grants nothing on the held object. Descendants are
                // inspected separately with their own effective descriptor.
                if ((ace.AceFlags & AceFlags.InheritOnly) != 0) continue;
                if (ace.AceQualifier == AceQualifier.AccessDenied) continue;
                if (ace.AceQualifier != AceQualifier.AccessAllowed) return false;
                if ((unchecked((uint)ace.AccessMask) & writes) != 0 &&
                    !Trusted(ace.SecurityIdentifier.Value, ancestor)) return false;
            }
            return true;
        }
        public EnrollmentHeld Open(string path, bool directory)
        {
            Require(Path.IsPathRooted(path) && !path.StartsWith("\\\\", StringComparison.Ordinal) &&
                path.Length <= 2048 && path.IndexOf(':', 2) < 0 && GetDriveType(Path.GetPathRoot(path)) == 3);
            SafeFileHandle file = CreateFile(path, directory ? 0x20080U : 0x80020000U,
                1, IntPtr.Zero, 3, 0x00200000U | (directory ? 0x02000000U : 0), IntPtr.Zero);
            try {
                Require(file != null && !file.IsInvalid && GetFileType(file) == 1);
                return new Held(file, path, directory);
            }
            catch { if (file != null) file.Dispose(); throw; }
        }
        private sealed class Held : EnrollmentHeld
        {
            private readonly SafeFileHandle file;
            private readonly string name, volume, id;
            private readonly bool directory, reparse;
            private readonly byte[] identity, basic, security;
            private FileStream stream;
            private bool disposed;
            internal Held(SafeFileHandle held, string expected, bool isDirectory)
            {
                file = held; identity = Query(file, 18, 24); basic = Query(file, 0, 40);
                byte[] tag = Query(file, 9, 8); uint attributes = BitConverter.ToUInt32(tag, 0);
                directory = (attributes & 0x10) != 0; reparse = (attributes & 0x400) != 0;
                name = Name(file); volume = BitConverter.ToUInt64(identity, 0).ToString("x16");
                byte[] identifier = new byte[16]; Array.Copy(identity, 8, identifier, 0, 16); id = Hex(identifier);
                Require(directory == isDirectory && !reparse && volume != "0000000000000000" &&
                    id != new string('0', 32) && String.Equals(name, expected, StringComparison.OrdinalIgnoreCase));
                security = Security(file);
            }
            internal override string PathName { get { return name; } }
            internal override string Volume { get { return volume; } }
            internal override string FileId { get { return id; } }
            internal override bool Directory { get { return directory; } }
            internal override bool Reparse { get { return reparse; } }
            internal override bool Protected(bool ancestor) { Require(!disposed); return ProtectedDescriptor(security, ancestor); }
            internal override byte[] Read(int maximum)
            {
                Require(!disposed && !directory && maximum > 0 && maximum <= 4 * 1024 * 1024);
                if (stream == null) stream = new FileStream(file, FileAccess.Read, 65536, false);
                Require(stream.Length > 0 && stream.Length <= maximum);
                stream.Position = 0; byte[] bytes = new byte[(int)stream.Length]; int offset = 0;
                while (offset < bytes.Length) { int read = stream.Read(bytes, offset, bytes.Length - offset); Require(read > 0); offset += read; }
                Require(stream.ReadByte() == -1); return bytes;
            }
            internal override void Recheck()
            {
                Require(!disposed && Hex(Query(file, 18, 24)) == Hex(identity) &&
                    String.Equals(Name(file), name, StringComparison.OrdinalIgnoreCase) &&
                    Hex(Security(file)) == Hex(security));
                byte[] after = Query(file, 0, 40);
                for (int index = 0; index < basic.Length; index++)
                    if (index < 8 || index >= 16) Require(after[index] == basic[index]);
            }
            public override void Dispose()
            {
                if (disposed) return; disposed = true;
                try { if (stream != null) stream.Dispose(); }
                finally { file.Dispose(); }
            }
        }
    }
}
