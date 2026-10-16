using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace Aegis.ProtectedSession
{
    // One original installer-created file; no create, truncate, rename, recovery or effect APIs.
    internal sealed class ProtectedJournalNative : IDisposable
    {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern SafeFileHandle CreateFile(string path, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetFileInformationByHandleEx(SafeFileHandle file, int kind, byte[] bytes, uint length);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern uint GetFinalPathNameByHandle(SafeFileHandle file, StringBuilder text, uint length, uint flags);
        [DllImport("kernel32.dll")] private static extern uint GetDriveType(string root);
        [DllImport("kernel32.dll")] private static extern uint GetFileType(SafeFileHandle file);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetFileSizeEx(SafeFileHandle file, out long length);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern bool SetFilePointerEx(SafeFileHandle file, long distance, out long position, uint method);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern bool ReadFile(SafeFileHandle file, byte[] bytes, uint length, out uint read, IntPtr overlapped);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern bool WriteFile(SafeFileHandle file, byte[] bytes, uint length, out uint written, IntPtr overlapped);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern bool FlushFileBuffers(SafeFileHandle file);
        [DllImport("advapi32.dll")] private static extern uint GetSecurityInfo(SafeFileHandle file, int kind, uint information, out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr descriptor);
        [DllImport("advapi32.dll")] private static extern uint GetSecurityDescriptorLength(IntPtr descriptor);
        [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr value);
        internal const int MaximumBytes = ProtectedJournalRegistration.MaximumBytes + ProtectedOperationState.MaximumRecords * ProtectedOperationRecord.MaximumBytes;
        private readonly List<EnrollmentHeld> ancestors = new List<EnrollmentHeld>();
        private readonly ProtectedJournalRegistration registration;
        private readonly string directory, path;
        private readonly bool requireProtection;
        private SafeFileHandle file;
        private byte[] security;
        private bool closed;
#if PROTECTED_JOURNAL_TEST
        internal int WriteChunkForTest = Int32.MaxValue, NativeWritesForTest;
        internal string FaultForTest;
        internal Action DuringWriteForTest;
#endif
        private ProtectedJournalNative(ProtectedJournalRegistration original, string fixedDirectory, bool protectedChecks)
        {
            registration = original; directory = fixedDirectory; requireProtection = protectedChecks; path = Path.Combine(directory, registration.Leaf);
            try
            {
                Require(Path.IsPathRooted(path) && !path.StartsWith("\\\\", StringComparison.Ordinal) && path.IndexOf(':', 2) < 0 && GetDriveType(Path.GetPathRoot(path)) == 3);
                var paths = new List<string>(); string cursor = directory;
                while (cursor != null) { paths.Add(cursor); Require(paths.Count <= 32); cursor = Path.GetDirectoryName(cursor); }
                paths.Reverse(); var native = new EnrollmentNative();
                foreach (string item in paths)
                {
                    EnrollmentHeld held = native.Open(item, true); ancestors.Add(held);
                    if (requireProtection) EnrollmentInspection.Check(held, item, true, item != directory);
                    else Require(held.Directory && !held.Reparse && String.Equals(held.PathName, item, StringComparison.OrdinalIgnoreCase));
                }
                EnrollmentHeld root = ancestors[ancestors.Count - 1];
                Require(root.Volume == registration.DirectoryVolume && root.FileId == registration.DirectoryId && ProtectedJournalRegistration.SecurityHash(root.SecurityDescriptor) == registration.DirectorySecurity);
                file = CreateFile(path, 0xC0020000U, 1, IntPtr.Zero, 3, 0x80200000U, IntPtr.Zero);
                Require(file != null && !file.IsInvalid && GetFileType(file) == 1); security = Security(); Check();
            }
            catch { Dispose(); throw; }
        }
        internal static string DirectoryPath { get { return Path.Combine(Path.GetDirectoryName(InstalledOwnerPolicy.Root), "OperationJournal"); } }
        internal static ProtectedJournalNative Acquire(ProtectedJournalRegistration registration)
        { return new ProtectedJournalNative(registration, DirectoryPath, true); }
        private static void Require(bool value) { ProtectedJournalRegistration.Require(value); }
        private byte[] Query(int kind, int length)
        { byte[] bytes = new byte[length]; Require(GetFileInformationByHandleEx(file, kind, bytes, (uint)length)); return bytes; }
        private byte[] Security()
        {
            IntPtr owner, group, dacl, sacl, descriptor;
            uint status = GetSecurityInfo(file, 1, 5, out owner, out group, out dacl, out sacl, out descriptor);
            try
            {
                Require(status == 0 && descriptor != IntPtr.Zero && owner != IntPtr.Zero && dacl != IntPtr.Zero);
                uint length = GetSecurityDescriptorLength(descriptor); Require(length > 0 && length <= 65536);
                byte[] bytes = new byte[(int)length]; Marshal.Copy(descriptor, bytes, 0, bytes.Length); return bytes;
            }
            finally { if (descriptor != IntPtr.Zero) LocalFree(descriptor); }
        }
        internal void Check()
        {
            Require(!closed && !CallerNative.HasThreadToken());
            foreach (EnrollmentHeld held in ancestors) held.Recheck(true);
            EnrollmentHeld root = ancestors[ancestors.Count - 1];
            Require(root.Volume == registration.DirectoryVolume && root.FileId == registration.DirectoryId && ProtectedJournalRegistration.SecurityHash(root.SecurityDescriptor) == registration.DirectorySecurity);
            string[] leaves = System.IO.Directory.GetFileSystemEntries(directory);
            Require(leaves.Length == 1 && String.Equals(leaves[0], path, StringComparison.OrdinalIgnoreCase));
            byte[] identity = Query(18, 24), standard = Query(1, 24), tag = Query(9, 8), current = Security();
            Require(BitConverter.ToUInt64(identity, 0).ToString("x16") == registration.FileVolume && Hex(identity, 8, 16) == registration.FileId &&
                (BitConverter.ToUInt32(tag, 0) & 0x410) == 0 && BitConverter.ToUInt32(standard, 16) == 1 && standard[20] == 0 && standard[21] == 0 &&
                ProtectedOperationRecord.Equal(current, security) && ProtectedJournalRegistration.SecurityHash(current) == registration.FileSecurity);
            if (requireProtection) Require(root.Protected(false) && EnrollmentNative.ProtectedDescriptor(current, false));
            var text = new StringBuilder(4096); uint count = GetFinalPathNameByHandle(file, text, (uint)text.Capacity, 0);
            Require(count > 4 && count < text.Capacity && text.ToString().StartsWith("\\\\?\\", StringComparison.Ordinal) &&
                String.Equals(text.ToString().Substring(4), path, StringComparison.OrdinalIgnoreCase));
            long size; Require(GetFileSizeEx(file, out size) && size >= 0 && size <= MaximumBytes);
        }
        private static string Hex(byte[] bytes, int offset, int count) { return BitConverter.ToString(bytes, offset, count).Replace("-", "").ToLowerInvariant(); }
        private void Seek(long offset) { long position; Require(SetFilePointerEx(file, offset, out position, 0) && position == offset); }
        internal byte[] ReadAll()
        {
            Check(); long length; Require(GetFileSizeEx(file, out length) && length >= 0 && length <= MaximumBytes); Seek(0);
            byte[] bytes = new byte[(int)length]; int offset = 0;
            while (offset < bytes.Length)
            {
                byte[] chunk = new byte[Math.Min(65536, bytes.Length - offset)]; uint read;
                Require(ReadFile(file, chunk, (uint)chunk.Length, out read, IntPtr.Zero) && read > 0 && read <= chunk.Length);
                Buffer.BlockCopy(chunk, 0, bytes, offset, (int)read); offset += (int)read;
            }
            byte[] extra = new byte[1]; uint final; Require(ReadFile(file, extra, 1, out final, IntPtr.Zero) && final == 0); Check(); return bytes;
        }
        internal byte[] Append(byte[] expected, byte[] candidate)
        {
            Require(candidate != null && candidate.Length > 0 && candidate.Length <= ProtectedJournalRegistration.MaximumBytes &&
                expected.Length <= MaximumBytes - candidate.Length && ProtectedOperationRecord.Equal(ReadAll(), expected));
            Seek(expected.Length); int offset = 0;
            while (offset < candidate.Length)
            {
                int count = candidate.Length - offset;
#if PROTECTED_JOURNAL_TEST
                if (DuringWriteForTest != null) DuringWriteForTest();
                count = Math.Min(count, WriteChunkForTest); Require(FaultForTest != "zero" && FaultForTest != "write");
#endif
                byte[] chunk = new byte[count]; Buffer.BlockCopy(candidate, offset, chunk, 0, count); uint written;
                Require(WriteFile(file, chunk, (uint)count, out written, IntPtr.Zero) && written > 0 && written <= count); offset += (int)written;
#if PROTECTED_JOURNAL_TEST
                NativeWritesForTest++; Require(FaultForTest != "after-write");
#endif
            }
#if PROTECTED_JOURNAL_TEST
            Require(FaultForTest != "flush");
#endif
            Require(FlushFileBuffers(file)); byte[] wanted = new byte[expected.Length + candidate.Length];
            Buffer.BlockCopy(expected, 0, wanted, 0, expected.Length); Buffer.BlockCopy(candidate, 0, wanted, expected.Length, candidate.Length);
            byte[] actual = ReadAll();
#if PROTECTED_JOURNAL_TEST
            if (FaultForTest == "readback") actual[0] ^= 1;
#endif
            Require(ProtectedOperationRecord.Equal(actual, wanted)); return wanted;
        }
        public void Dispose()
        {
            if (closed) return; closed = true;
            try { if (file != null) file.Dispose(); }
            finally { for (int index = ancestors.Count - 1; index >= 0; index--) ancestors[index].Dispose(); }
        }
#if PROTECTED_JOURNAL_TEST
        internal void CorruptPrefixForTest()
        { Seek(0); uint written; Require(WriteFile(file, new byte[] { 0 }, 1, out written, IntPtr.Zero) && written == 1 && FlushFileBuffers(file)); }
        internal static ProtectedJournalNative AcquireForTest(ProtectedJournalRegistration registration, string directory, bool protection)
        { return new ProtectedJournalNative(registration, directory, protection); }
#endif
    }
}
