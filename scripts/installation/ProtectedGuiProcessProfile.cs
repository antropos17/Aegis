using System;
using System.Collections.Generic;
using System.IO;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text.RegularExpressions;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

// Mutable user storage; no contents are executable authority or recursively deleted.
public sealed class ProtectedGuiProcessProfile : IDisposable
{
    private readonly ProtectedGuiIdentity principal;
    private readonly string installId;
    private readonly List<ProtectedInstallFile> anchors = new List<ProtectedInstallFile>();
    private FreshDirectory root;
    private readonly List<FreshDirectory> created = new List<FreshDirectory>();
    private bool prepared, closed;
#if PROTECTED_GUI_PROCESS_TEST
    internal static Action<string> BeforeAttemptCreateForTest = null, AfterAttemptCreateForTest = null;
#endif
    internal string PathName { get; private set; }
    internal bool DataRetained { get { return created.Count != 0 || PathName != null; } }
    // FILE_CREATE returns the original directory handle atomically. No pathname
    // open may select the authority of a newly created user-writable directory.
    private sealed class FreshDirectory : IDisposable {
        [StructLayout(LayoutKind.Sequential)] private struct Unicode { internal ushort Length, Maximum; internal IntPtr Text; }
        [StructLayout(LayoutKind.Sequential)] private struct Attributes { internal int Length; internal IntPtr Root, Name; internal uint Flags; internal IntPtr Security, Quality; }
        [StructLayout(LayoutKind.Sequential)] private struct Status { internal IntPtr Code; internal UIntPtr Information; }
        [DllImport("ntdll.dll")] private static extern int NtCreateFile(out SafeFileHandle file, uint access, ref Attributes attributes, out Status status, IntPtr allocation, uint fileAttributes, uint share, uint disposition, uint options, IntPtr ea, uint eaLength);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetFileInformationByHandleEx(SafeFileHandle file, int kind, byte[] value, uint length);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern uint GetFinalPathNameByHandle(SafeFileHandle file, StringBuilder text, uint length, uint flags);
        [DllImport("advapi32.dll")] private static extern uint GetSecurityInfo(SafeFileHandle file, int kind, uint flags, out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr descriptor);
        [DllImport("advapi32.dll")] private static extern uint GetSecurityDescriptorLength(IntPtr descriptor);
        [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr value);
        private SafeFileHandle held; private byte[] identity, security; internal readonly string PathName;
        internal FreshDirectory(string path) { PathName = path; }
        internal void Create(byte[] descriptor) {
            IntPtr text = IntPtr.Zero, name = IntPtr.Zero, security = IntPtr.Zero;
            try {
                string native = "\\??\\" + PathName; Need(native.Length < 16380);
                text = Marshal.StringToHGlobalUni(native); var unicode = new Unicode { Length = (ushort)(native.Length * 2), Maximum = (ushort)(native.Length * 2 + 2), Text = text };
                name = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(Unicode))); Marshal.StructureToPtr(unicode, name, false);
                security = Marshal.AllocHGlobal(descriptor.Length); Marshal.Copy(descriptor, 0, security, descriptor.Length);
                var attributes = new Attributes { Length = Marshal.SizeOf(typeof(Attributes)), Name = name, Flags = 0x40, Security = security };
                Status status; int result = NtCreateFile(out held, 0x120081, ref attributes, out status, IntPtr.Zero, 0x10, 3, 2, 0x200021, IntPtr.Zero, 0);
                Need(result == 0 && status.Information.ToUInt64() == 2 && held != null && !held.IsInvalid);
                identity = Query(18, 24); this.security = Security(); Check();
                using (var children = Directory.EnumerateFileSystemEntries(PathName).GetEnumerator()) Need(!children.MoveNext());
                Check();
            } finally { if (security != IntPtr.Zero) Marshal.FreeHGlobal(security); if (name != IntPtr.Zero) Marshal.FreeHGlobal(name); if (text != IntPtr.Zero) Marshal.FreeHGlobal(text); }
        }
        private byte[] Query(int kind, int length) { var value = new byte[length]; Need(GetFileInformationByHandleEx(held, kind, value, (uint)length)); return value; }
        private byte[] Security() {
            IntPtr owner, group, dacl, sacl, descriptor;
            uint result = GetSecurityInfo(held, 1, 5, out owner, out group, out dacl, out sacl, out descriptor);
            try { Need(result == 0 && descriptor != IntPtr.Zero && owner != IntPtr.Zero && dacl != IntPtr.Zero);
                uint size = GetSecurityDescriptorLength(descriptor); Need(size > 0 && size <= 65536); var bytes = new byte[size]; Marshal.Copy(descriptor, bytes, 0, (int)size); return bytes;
            } finally { if (descriptor != IntPtr.Zero) LocalFree(descriptor); }
        }
        internal void Check() {
            Need(held != null && !held.IsClosed && !held.IsInvalid && identity != null && Convert.ToBase64String(identity) == Convert.ToBase64String(Query(18, 24)));
            Need(Convert.ToBase64String(security) == Convert.ToBase64String(Security()));
            byte[] attributes = Query(9, 8); Need((BitConverter.ToUInt32(attributes, 0) & 0x410) == 0x10);
            var text = new StringBuilder(4096); uint count = GetFinalPathNameByHandle(held, text, (uint)text.Capacity, 0);
            Need(count > 4 && count < text.Capacity && String.Equals(text.ToString(), "\\\\?\\" + PathName, StringComparison.OrdinalIgnoreCase));
        }
        public void Dispose() { if (held != null) { held.Dispose(); held = null; } }
    }
    internal ProtectedGuiProcessProfile(ProtectedGuiIdentity original, string installation) {
        Need(original != null && Regex.IsMatch(installation ?? "", "\\A[a-f0-9]{32}\\z")); principal = original; installId = installation;
    }
    private static void Need(bool value) { if (!value) throw new InvalidDataException("protected-gui-process-profile-refused"); }
    internal void Prepare() {
        Need(!prepared && !closed); prepared = true;
        string local = principal.LocalAppDataForProcess(), sid = principal.LimitedSid;
        // Every filesystem action in this user-writable namespace runs as its original limited principal.
        using (principal.EnterProfileContext()) {
            var paths = new List<string>(); string cursor = local;
            while (cursor != null) { paths.Add(cursor); Need(paths.Count <= 64); cursor = Path.GetDirectoryName(cursor); }
            paths.Reverse(); foreach (string path in paths) anchors.Add(ProtectedInstallFile.OpenMetadata(path, true));
            var acl = new DirectorySecurity(); acl.SetAccessRuleProtection(true, false); acl.SetOwner(new SecurityIdentifier(sid));
            foreach (string selected in new[] { sid, "S-1-5-18", "S-1-5-32-544" })
                acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(selected), FileSystemRights.FullControl,
                    InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
            byte[] descriptor = acl.GetSecurityDescriptorBinaryForm();
            foreach (string part in new[] { "AEGIS", "ProtectedGui", installId }) {
                local = Path.Combine(local, part);
                foreach (var anchor in anchors) anchor.Recheck();
                if (Directory.Exists(local)) anchors.Add(ProtectedInstallFile.OpenMetadata(local, true));
                else { var next = new FreshDirectory(local); created.Add(next); next.Create(descriptor); }
            }
            PathName = Path.Combine(local, Guid.NewGuid().ToString("N"));
            foreach (var anchor in anchors) anchor.Recheck();
#if PROTECTED_GUI_PROCESS_TEST
            if (BeforeAttemptCreateForTest != null) BeforeAttemptCreateForTest(PathName);
#endif
            root = new FreshDirectory(PathName); created.Add(root); root.Create(descriptor);
#if PROTECTED_GUI_PROCESS_TEST
            if (AfterAttemptCreateForTest != null) AfterAttemptCreateForTest(PathName);
#endif
        }
        principal.CheckCurrent(); Check();
    }
    internal void Check() {
        Need(prepared && !closed && root != null && PathName == root.PathName);
        foreach (var anchor in anchors) anchor.Recheck(); foreach (var entry in created) entry.Check(); root.Check();
    }
    public void Dispose() {
        if (closed) return; closed = true;
        // Preserve all data and namespace entries. Only original pins are relinquished.
        try { for (int index = created.Count - 1; index >= 0; index--) created[index].Dispose(); }
        finally { for (int index = anchors.Count - 1; index >= 0; index--) anchors[index].Dispose(); }
    }
}
