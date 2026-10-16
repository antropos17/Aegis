using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Win32.SafeHandles;

// One retained original source or newly created destination. A created file is
// captured on its CreateNew handle before any payload write; it is never adopted.
internal sealed class ProtectedGuiBundleNative : IDisposable
{
    [StructLayout(LayoutKind.Sequential)] private struct Attributes { internal int Length; internal IntPtr Descriptor; internal int Inherit; }
    [DllImport("kernel32.dll", EntryPoint = "CreateFileW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle OpenFile(string path, uint access, uint share, IntPtr attributes, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", EntryPoint = "CreateFileW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern SafeFileHandle CreateFile(string path, uint access, uint share, ref Attributes attributes, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", EntryPoint = "CreateDirectoryW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateDirectory(string path, ref Attributes attributes);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetFileInformationByHandleEx(SafeFileHandle file, int kind, byte[] bytes, uint count);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool DeviceIoControl(SafeFileHandle file, uint code,
        IntPtr input, uint inputBytes, byte[] output, uint outputBytes, out uint returned, IntPtr overlapped);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern uint GetFinalPathNameByHandle(SafeFileHandle file, StringBuilder value, uint size, uint flags);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool SetFileInformationByHandle(SafeFileHandle file, int kind, ref int value, uint size);
    [StructLayout(LayoutKind.Sequential)] private struct FileIdentifier { internal uint Size, Type; internal ulong Low, High; }
    [DllImport("kernel32.dll", SetLastError = true)] private static extern SafeFileHandle OpenFileById(SafeFileHandle hint, ref FileIdentifier identity, uint access, uint share, IntPtr security, uint flags);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern uint GetSecurityInfo(SafeFileHandle file, int type, uint flags, out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr descriptor);
    [DllImport("advapi32.dll")] private static extern uint GetSecurityDescriptorLength(IntPtr descriptor);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr value);
    private SafeFileHandle held;
    // The by-ID handle remains identity authority. A separately verified named
    // link supplies namespace sharing exclusion for the execution lifetime.
    private ProtectedGuiBundleNative executionLink;
    private readonly byte[] identity, security;
    private readonly bool created;
    private FileStream stream;
    private byte[] metadata;
    private bool closed, suspended, resumedReadOnly;
    internal readonly bool Directory;
    internal string PathName { get; private set; }
    internal string Volume { get; private set; }
    internal string FileId { get; private set; }
    internal static InvalidDataException Refused() { return new InvalidDataException("protected-gui-bundle-refused"); }
    internal static InvalidDataException Unknown(Exception cause = null)
    { var error = new InvalidDataException("protected-gui-cleanup-unknown", cause); error.Data["protectedCleanupUnknown"] = true; return error; }
    private static void Need(bool value) { if (!value) throw Refused(); }
    private static string Hex(byte[] value) { return BitConverter.ToString(value).Replace("-", "").ToLowerInvariant(); }
    private byte[] Query(int kind, int count)
    { byte[] value = new byte[count]; Need(GetFileInformationByHandleEx(held, kind, value, (uint)value.Length)); return value; }
    private string Name()
    {
        var value = new StringBuilder(4096); uint count = GetFinalPathNameByHandle(held, value, (uint)value.Capacity, 0);
        Need(count > 4 && count < value.Capacity && value.ToString().StartsWith("\\\\?\\", StringComparison.Ordinal)); return value.ToString().Substring(4);
    }
    private byte[] Security()
    {
        IntPtr owner, group, dacl, sacl, descriptor; uint result = GetSecurityInfo(held, 1, 5, out owner, out group, out dacl, out sacl, out descriptor);
        try
        {
            Need(result == 0 && owner != IntPtr.Zero && dacl != IntPtr.Zero && descriptor != IntPtr.Zero);
            uint count = GetSecurityDescriptorLength(descriptor); Need(count > 0 && count <= 65536);
            byte[] value = new byte[count]; Marshal.Copy(descriptor, value, 0, (int)count); return value;
        }
        finally { if (descriptor != IntPtr.Zero) LocalFree(descriptor); }
    }
    private byte[] Metadata()
    {
        byte[] value = Query(0, 40), standard = Query(1, 24), result = new byte[32];
        Buffer.BlockCopy(value, 0, result, 0, 8); Buffer.BlockCopy(value, 16, result, 8, 16);
        Buffer.BlockCopy(standard, 8, result, 24, 8); return result;
    }
    private void Streams()
    {
        // Query the original handle, not a separately opened pathname. Every
        // entry is bounded; only the unnamed data stream (or no dir stream) exists.
        byte[] value = new byte[65536];
        bool success = GetFileInformationByHandleEx(held, 7, value, (uint)value.Length);
        if (!success && Directory && Marshal.GetLastWin32Error() == 38) return;
        Need(success); uint next = BitConverter.ToUInt32(value, 0), length = BitConverter.ToUInt32(value, 4);
        if (Directory && next == 0 && length == 0) return;
        Need(next == 0 && length == 14 && Encoding.Unicode.GetString(value, 24, 14) == "::$DATA");
    }
    internal ProtectedGuiBundleNative(string path, bool directory, bool create, byte[] descriptor, bool parentHint = false)
    {
        Need(path != null && path.Length <= 2048 && Path.IsPathRooted(path) && !path.StartsWith("\\\\", StringComparison.Ordinal) &&
            path.IndexOf(':', 2) < 0 && String.Equals(path, Path.GetFullPath(path), StringComparison.OrdinalIgnoreCase));
        Directory = directory; created = create;
        bool madeDirectory = false;
        try
        {
            uint access = directory ? (parentHint ? 0x20080U : 0x20081U) : 0x80020000U;
            if (create)
            {
                Need(descriptor != null && descriptor.Length > 0 && descriptor.Length <= 65536);
                GCHandle pinned = GCHandle.Alloc(descriptor, GCHandleType.Pinned);
                try
                {
                    var attributes = new Attributes { Length = Marshal.SizeOf(typeof(Attributes)), Descriptor = pinned.AddrOfPinnedObject(), Inherit = 0 };
                    if (directory)
                    {
                        Need(CreateDirectory(path, ref attributes)); madeDirectory = true;
                        held = OpenFile(path, access | 0x10000, 7, IntPtr.Zero, 3, 0x02200000, IntPtr.Zero);
                    }
                    else held = CreateFile(path, 0xc0030000, 5, ref attributes, 1, 0x00200000, IntPtr.Zero);
                }
                finally { pinned.Free(); }
            }
            else held = OpenFile(path, access, parentHint ? 7U : 1U, IntPtr.Zero, 3, 0x00200000U | (directory ? 0x02000000U : 0), IntPtr.Zero);
            Need(held != null && !held.IsInvalid);
            byte[] tag = Query(9, 8); uint flags = BitConverter.ToUInt32(tag, 0);
            Need((flags & 0x400) == 0 && ((flags & 0x10) != 0) == directory);
            PathName = Name(); Need(String.Equals(PathName, path, StringComparison.OrdinalIgnoreCase));
            identity = Query(18, 24); Volume = BitConverter.ToUInt64(identity, 0).ToString("x16");
            byte[] id = new byte[16]; Buffer.BlockCopy(identity, 8, id, 0, 16); FileId = Hex(id);
            Need(Volume != new string('0', 16) && FileId != new string('0', 32));
            security = Security(); metadata = Metadata(); Check();
        }
        catch
        {
            bool unknown = madeDirectory && (held == null || held.IsInvalid);
            if (held != null && !held.IsInvalid && create)
            {
                int delete = 1; if (!SetFileInformationByHandle(held, 4, ref delete, 4)) unknown = true;
            }
            if (held != null) held.Dispose(); if (unknown) throw Unknown(); throw;
        }
    }
    internal void Check()
    {
        CheckOriginal();
        if (Hex(Metadata()) != Hex(metadata)) { var failure = Refused(); failure.Data["protectedOperation"] = "protected-gui-metadata-changed"; throw failure; }
        if (executionLink != null) executionLink.Check();
    }
    internal void CheckOriginal()
    {
        Need(!closed && !suspended && held != null && Hex(Query(18, 24)) == Hex(identity) && Hex(Security()) == Hex(security) && String.Equals(Name(), PathName, StringComparison.OrdinalIgnoreCase));
        byte[] tag = Query(9, 8), standard = Query(1, 24);
        Need((BitConverter.ToUInt32(tag, 0) & 0x400) == 0 && standard[20] == 0 && (Directory || BitConverter.ToUInt32(standard, 16) == 1));
        Streams();
    }
    internal bool Protected()
    {
        Check(); var sd = new RawSecurityDescriptor(security, 0);
#if PROTECTED_GUI_TEST
        if (ModelProtectionForTest) return true;
#endif
        if (sd.Owner == null || (sd.Owner.Value != "S-1-5-18" && sd.Owner.Value != "S-1-5-32-544") || sd.DiscretionaryAcl == null ||
            (sd.ControlFlags & ControlFlags.DiscretionaryAclProtected) == 0) return false;
        foreach (GenericAce entry in sd.DiscretionaryAcl)
        {
            CommonAce ace = entry as CommonAce; if (ace == null || ace.IsCallback) return false;
            if ((ace.AceFlags & AceFlags.InheritOnly) != 0 || ace.AceQualifier == AceQualifier.AccessDenied) continue;
            if (ace.AceQualifier != AceQualifier.AccessAllowed || ((unchecked((uint)ace.AccessMask) & 0x500D0156U) != 0 &&
                ace.SecurityIdentifier.Value != "S-1-5-18" && ace.SecurityIdentifier.Value != "S-1-5-32-544")) return false;
        }
        return true;
    }
    internal void Rebind(string path)
    { Need(created && !closed && Hex(Query(18, 24)) == Hex(identity) && String.Equals(Name(), path, StringComparison.OrdinalIgnoreCase)); PathName = path; Check(); }
    internal void FreezeDirectoryMetadata()
    { Need(created && Directory); CheckOriginal(); metadata = Metadata(); }
    internal void PrepareShellObjectId()
    {
        // Only our unpublished CreateNew executable. The shell can lazily create
        // this optional NTFS attribute, changing ChangeTime during first launch.
        // Create-or-get never replaces an ID. It is not our file identity authority.
        Need(created && !Directory && !resumedReadOnly); Check();
        var value = new byte[64]; uint returned;
        Need(DeviceIoControl(held, 0x900c0, IntPtr.Zero, 0, value, 64, out returned, IntPtr.Zero) && returned == 64);
        metadata = Metadata(); Check();
    }
    internal static ProtectedGuiBundleNative ParentHint(ProtectedInstallFile original)
    {
        Need(original != null && original.Directory); original.Recheck();
        var hint = new ProtectedGuiBundleNative(original.PathName, true, false, null, true);
        try {
            Need(hint.Volume == original.Volume && hint.FileId == original.FileId &&
                new RawSecurityDescriptor(hint.security, 0).GetSddlForm(AccessControlSections.Owner | AccessControlSections.Access) == original.Sddl);
            original.Recheck(); return hint;
        } catch { hint.Dispose(); throw; }
    }
    internal void Suspend()
    {
        Need(created); Check(); suspended = true;
        try {
            if (executionLink != null) { executionLink.Dispose(); executionLink = null; }
            if (stream != null) { stream.Dispose(); stream = null; }
        }
        finally { if (held != null) { held.Dispose(); held = null; } }
    }
    internal void Resume(ProtectedGuiBundleNative originalParentHint, string expectedPath)
    { ResumeCore(originalParentHint, expectedPath, false); }
    internal void ResumeExecution(ProtectedGuiBundleNative originalParentHint, string expectedPath)
    {
        ResumeCore(originalParentHint, expectedPath, true);
        Need(executionLink == null); ProtectedGuiBundleNative candidate = null;
        try {
#if PROTECTED_GUI_PROCESS_TEST
            if (BeforeExecutionLinkForTest != null) BeforeExecutionLinkForTest(expectedPath);
#endif
            // OpenExisting only. Keep the original by-ID authority continuously;
            // a same-name replacement is never accepted as the execution link.
            candidate = new ProtectedGuiBundleNative(expectedPath, Directory, false, null);
            Need(candidate.Directory == Directory && Hex(candidate.identity) == Hex(identity) &&
                Hex(candidate.security) == Hex(security) && Hex(candidate.metadata) == Hex(metadata) &&
                String.Equals(candidate.PathName, PathName, StringComparison.OrdinalIgnoreCase));
            Check(); candidate.Check(); originalParentHint.CheckOriginal();
            executionLink = candidate; candidate = null; Check();
        } finally { if (candidate != null) candidate.Dispose(); }
    }
    private void ResumeCore(ProtectedGuiBundleNative originalParentHint, string expectedPath, bool execution)
    {
        Need(created && !closed && suspended); originalParentHint.CheckOriginal();
        var descriptor = new FileIdentifier { Size = 24, Type = 2, Low = BitConverter.ToUInt64(identity, 8), High = BitConverter.ToUInt64(identity, 16) };
        SafeFileHandle reopened = OpenFileById(originalParentHint.held, ref descriptor,
            execution ? (Directory ? 0x20081U : 0x80020000U) : (Directory ? 0x30081U : 0x80030000U), execution ? 1U : (Directory ? 7U : 5U),
            IntPtr.Zero, 0x00200000U | (Directory ? 0x02000000U : 0));
        try {
            if (reopened == null || reopened.IsInvalid) {
                int code = Marshal.GetLastWin32Error(); var failure = Refused(); failure.Data["protectedOperation"] = "protected-gui-open-original-id";
                failure.Data["protectedNativeWin32"] = code; throw failure;
            }
            byte[] actual = new byte[24];
            Need(GetFileInformationByHandleEx(reopened, 18, actual, 24) && Hex(actual) == Hex(identity));
            // Only a handle verified against the immutable original ID is retained.
            held = reopened; reopened = null; suspended = false; resumedReadOnly = true;
            Need(String.Equals(Name(), expectedPath, StringComparison.OrdinalIgnoreCase)); PathName = expectedPath; Check();
        } finally { if (reopened != null) reopened.Dispose(); }
    }
    private FileStream Data()
    { Need(!Directory && !closed && !suspended); if (stream == null) stream = new FileStream(held, created && !resumedReadOnly ? FileAccess.ReadWrite : FileAccess.Read, 65536, false); return stream; }
    internal string Hash(long expected)
    {
        Check(); Need(expected >= 0 && expected <= ProtectedGuiManifest.MaximumFile); FileStream input = Data(); Need(input.Length == expected); input.Position = 0;
        string digest; using (var sha = SHA256.Create()) digest = Hex(sha.ComputeHash(input));
        Need(input.Position == expected && input.Length == expected); Check(); return digest;
    }
    internal void CopyTo(ProtectedGuiBundleNative target, long expected, string digest)
    {
        Need(target != null && target.created && !target.Directory && Hash(expected) == digest);
        FileStream input = Data(), output = target.Data(); input.Position = 0; output.Position = 0; byte[] buffer = new byte[65536]; long total = 0;
        try
        {
            using (var sha = SHA256.Create())
            {
                int read; while ((read = input.Read(buffer, 0, buffer.Length)) > 0)
                {
                    Need(read <= expected - total); total += read; output.Write(buffer, 0, read); sha.TransformBlock(buffer, 0, read, buffer, 0);
#if PROTECTED_GUI_TEST
                    if (FailCopyForTest) throw Refused();
#endif
                }
                sha.TransformFinalBlock(new byte[0], 0, 0); Need(total == expected && Hex(sha.Hash) == digest);
            }
            output.SetLength(expected); output.Flush(true); Check();
            target.metadata = target.Metadata(); Need(target.Hash(expected) == digest);
        }
        finally { Array.Clear(buffer, 0, buffer.Length); }
    }
    private void Disposition()
    {
        int delete = 1;
        if (!SetFileInformationByHandle(held, 4, ref delete, 4)) {
            int code = Marshal.GetLastWin32Error(); var failure = Refused(); failure.Data["protectedOperation"] = "protected-gui-delete-original";
            failure.Data["protectedNativeWin32"] = code; failure.Data["protectedGuiEntryType"] = Directory ? 1 : 0; throw failure;
        }
    }
    internal void DeleteOriginal(bool complete, ProtectedInstallFile originalRoot, ProtectedInstallFile originalParent, long expectedBytes, string expectedHash)
    {
        Need(created && !closed); originalRoot.Recheck(); originalParent.Recheck();
        if (complete && !Directory) Check(); else CheckOriginal();
        if (!resumedReadOnly) { Disposition(); Dispose(); return; }
        // A by-ID pin remains the authority. The expected namespace link is only
        // a candidate for disposition, never a replacement ownership source.
#if PROTECTED_GUI_TEST
        if (!Directory && ReplaceDeleteLinkForTest) {
            File.Move(PathName, PathName + ".original"); File.WriteAllText(PathName, "foreign-delete-link"); ReplaceDeleteLinkForTest = false;
        }
        if (!Directory && ReadOnlyDeleteLinkForTest) { File.SetAttributes(PathName, File.GetAttributes(PathName) | FileAttributes.ReadOnly); ReadOnlyDeleteLinkForTest = false; }
#endif
        byte[] beforeLink = Metadata(); SafeFileHandle original = held, link = null; FileStream originalData = stream;
        try {
            link = OpenFile(PathName, Directory ? 0x30081U : 0x80030000U, 7, IntPtr.Zero, 3, 0x00200000U | (Directory ? 0x02000000U : 0), IntPtr.Zero);
            if (link == null || link.IsInvalid) { int code = Marshal.GetLastWin32Error(); var failure = Refused(); failure.Data["protectedNativeWin32"] = code; throw failure; }
            byte[] actual = new byte[24]; Need(GetFileInformationByHandleEx(link, 18, actual, 24) && Hex(actual) == Hex(identity));
            held = link; stream = null; CheckOriginal(); Need(Hex(Metadata()) == Hex(beforeLink));
            if (!Directory) Need(Hash(expectedBytes) == expectedHash);
            originalRoot.Recheck(); originalParent.Recheck();
            if (Directory) CheckOriginal(); else Check();
            Disposition();
        } finally {
            try { if (stream != null && !Object.ReferenceEquals(stream, originalData)) stream.Dispose(); }
            finally { held = original; stream = originalData; if (link != null) link.Dispose(); }
        }
        Dispose();
    }
    public void Dispose()
    {
        if (closed) return; closed = true;
        try { if (executionLink != null) executionLink.Dispose(); }
        finally { try { if (stream != null) stream.Dispose(); } finally { if (held != null) held.Dispose(); } }
    }
#if PROTECTED_GUI_PROCESS_TEST
    internal static Action<string> BeforeExecutionLinkForTest = null;
#endif
#if PROTECTED_GUI_TEST
    internal static bool ModelProtectionForTest = false;
    internal static bool FailCopyForTest = false;
    internal static bool ReplaceDeleteLinkForTest = false, ReadOnlyDeleteLinkForTest = false;
#endif
}
