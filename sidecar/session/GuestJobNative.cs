using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;

namespace Aegis.ProtectedSession
{
    // Observations only. No process creation, assignment or termination authority.
    internal static class GuestJobNative
    {
        internal const int MaximumMembers = 64;
        [StructLayout(LayoutKind.Sequential)]
        internal struct Accounting
        {
            internal long User, Kernel, PeriodUser, PeriodKernel;
            internal uint Faults, Total, Active, Terminated;
        }
        [DllImport("kernel32.dll", SetLastError = true)] private static extern bool DuplicateHandle(IntPtr sourceProcess, IntPtr source, IntPtr targetProcess, out IntPtr target, uint access, bool inherit, uint options);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool CloseHandle(IntPtr handle);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern uint WaitForSingleObject(IntPtr handle, uint timeout);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern uint GetProcessId(IntPtr handle);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool member);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetProcessTimes(IntPtr process, out long birth, out long exit, out long kernel, out long user);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern bool QueryInformationJobObject(IntPtr job, int kind, IntPtr data, int length, IntPtr returned);
        [DllImport("kernel32.dll", SetLastError = true, EntryPoint = "QueryInformationJobObject")] private static extern bool QueryAccounting(IntPtr job, int kind, out Accounting data, int length, IntPtr returned);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool QueryFullProcessImageName(IntPtr process, uint flags, StringBuilder data, ref int length);
        [DllImport("advapi32.dll", SetLastError = true)] private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
        [DllImport("advapi32.dll", SetLastError = true)] private static extern bool GetTokenInformation(IntPtr token, int kind, IntPtr data, int length, out int returned);
        internal static void Require(bool value) { if (!value) throw new InvalidDataException("guest-job-inventory-unavailable"); }
        internal static IntPtr Retain(IntPtr handle)
        {
            IntPtr result;
            Require(handle != IntPtr.Zero && handle != new IntPtr(-1));
            Require(DuplicateHandle(new IntPtr(-1), handle, new IntPtr(-1), out result, 0, false, 2));
            return result;
        }
        internal static IntPtr OpenMember(uint pid)
        {
            IntPtr result = OpenProcess(0x1000 | 0x100000, false, pid);
            Require(result != IntPtr.Zero); return result;
        }
        internal static long Birth(IntPtr process, IntPtr job, uint pid)
        {
            bool member; long birth, exit, kernel, user;
            Require(WaitForSingleObject(process, 0) == 0x102 && GetProcessId(process) == pid);
            Require(IsProcessInJob(process, job, out member) && member);
            Require(GetProcessTimes(process, out birth, out exit, out kernel, out user) && birth > 0);
            Require(WaitForSingleObject(process, 0) == 0x102); return birth;
        }
        internal static Accounting Counts(IntPtr job)
        {
            Accounting value;
            Require(QueryAccounting(job, 1, out value, Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero));
            Require(value.Active <= MaximumMembers && value.Active <= value.Total); return value;
        }
        internal static uint[] Members(IntPtr job)
        {
            // OS lists are non-atomic. Bound every retry/allocation; never use a partial list.
            for (int capacity = 2; capacity <= MaximumMembers; capacity *= 2)
            {
                int size = 8 + capacity * IntPtr.Size;
                IntPtr data = Marshal.AllocHGlobal(size);
                try
                {
                    for (int at = 0; at < size; at++) Marshal.WriteByte(data, at, 0);
                    bool success = QueryInformationJobObject(job, 3, data, size, IntPtr.Zero);
                    int error = Marshal.GetLastWin32Error();
                    uint assigned = unchecked((uint)Marshal.ReadInt32(data, 0));
                    uint listed = unchecked((uint)Marshal.ReadInt32(data, 4));
                    Require(assigned <= MaximumMembers && listed <= capacity && listed <= assigned);
                    if (!success) { Require(error == 234 && assigned > capacity); continue; }
                    return DecodeMembers(data, capacity);
                }
                finally { Marshal.FreeHGlobal(data); }
            }
            throw new InvalidDataException("guest-job-inventory-unavailable");
        }
        internal static uint[] DecodeMembers(IntPtr data, int capacity)
        {
            Require(data != IntPtr.Zero && capacity >= 0 && capacity <= MaximumMembers);
            uint assigned = unchecked((uint)Marshal.ReadInt32(data, 0));
            uint listed = unchecked((uint)Marshal.ReadInt32(data, 4));
            Require(assigned <= MaximumMembers && listed <= capacity && assigned == listed);
            var result = new List<uint>();
            for (int index = 0; index < listed; index++)
            {
                long raw = Marshal.ReadIntPtr(data, 8 + index * IntPtr.Size).ToInt64();
                Require(raw > 0 && raw <= uint.MaxValue && !result.Contains((uint)raw));
                result.Add((uint)raw);
            }
            result.Sort(); return result.ToArray();
        }
        internal static string Image(IntPtr process)
        {
            int length = 32768; var value = new StringBuilder(length);
            Require(QueryFullProcessImageName(process, 0, value, ref length)); return value.ToString();
        }
        internal static string Principal(IntPtr process)
        {
            IntPtr token = IntPtr.Zero;
            try
            {
                Require(OpenProcessToken(process, 8, out token)); return TokenPrincipal(token);
            }
            finally { if (token != IntPtr.Zero) CloseHandle(token); }
        }
        private static string TokenPrincipal(IntPtr token)
        {
            IntPtr data = IntPtr.Zero;
            try
            {
                int length;
                bool sized = GetTokenInformation(token, 1, IntPtr.Zero, 0, out length);
                Require(!sized && Marshal.GetLastWin32Error() == 122 && length >= IntPtr.Size && length <= 65536);
                data = Marshal.AllocHGlobal(length); int returned;
                Require(GetTokenInformation(token, 1, data, length, out returned) && returned >= IntPtr.Size && returned <= length);
                return new SecurityIdentifier(Marshal.ReadIntPtr(data)).Value;
            }
            finally { if (data != IntPtr.Zero) Marshal.FreeHGlobal(data); }
        }
        internal static int Session(IntPtr process)
        {
            IntPtr token = IntPtr.Zero;
            try { Require(OpenProcessToken(process, 8, out token)); return TokenInteger(token, 12); }
            finally { if (token != IntPtr.Zero) CloseHandle(token); }
        }
        private static int TokenInteger(IntPtr token, int kind)
        {
            IntPtr data = Marshal.AllocHGlobal(4);
            try { int returned; Require(GetTokenInformation(token, kind, data, 4, out returned) && returned == 4); return Marshal.ReadInt32(data); }
            finally { Marshal.FreeHGlobal(data); }
        }
        [StructLayout(LayoutKind.Sequential)] private struct SidAttributes { internal IntPtr Sid; internal uint Attributes; }
        [StructLayout(LayoutKind.Sequential)] private struct TokenGroups { internal uint Count; internal SidAttributes First; }
        // The late console host must retain the Task's standard token, including
        // absence of disabled/deny-only administrator groups. QUERY only.
        internal static void RequireStandardPrincipal(IntPtr process, string expectedPrincipal, int expectedSession)
        {
            IntPtr token = IntPtr.Zero, data = IntPtr.Zero;
            try
            {
                Require(OpenProcessToken(process, 8, out token));
                Require(TokenPrincipal(token) == expectedPrincipal);
                Require(TokenInteger(token, 20) == 0 && TokenInteger(token, 12) == expectedSession);
                int length;
                bool sized = GetTokenInformation(token, 2, IntPtr.Zero, 0, out length);
                Require(!sized && Marshal.GetLastWin32Error() == 122 && length >= 4 && length <= 65536);
                data = Marshal.AllocHGlobal(length); int returned;
                Require(GetTokenInformation(token, 2, data, length, out returned) && returned >= 4 && returned <= length);
                RequireNoAdministratorGroups(data, returned);
            }
            finally { if (data != IntPtr.Zero) Marshal.FreeHGlobal(data); if (token != IntPtr.Zero) CloseHandle(token); }
        }
        internal static void RequireNoAdministratorGroups(IntPtr data, int length)
        {
            Require(data != IntPtr.Zero && length >= 4 && length <= 65536);
            uint count = unchecked((uint)Marshal.ReadInt32(data));
            int offset = Marshal.OffsetOf(typeof(TokenGroups), "First").ToInt32(), stride = Marshal.SizeOf(typeof(SidAttributes));
            Require(count <= 256 && (count == 0 || offset + (long)count * stride <= length));
            long start = data.ToInt64(), tableEnd = start + offset + (long)count * stride, end = checked(start + length);
            for (int index = 0; index < count; index++)
            {
                IntPtr sid = Marshal.ReadIntPtr(data, offset + index * stride); long address = sid.ToInt64();
                Require(address >= tableEnd && address <= end - 8);
                int subAuthorities = Marshal.ReadByte(sid, 1), bytes = 8 + subAuthorities * 4;
                Require(Marshal.ReadByte(sid) == 1 && subAuthorities <= 15 && bytes <= end - address);
                Require(!new SecurityIdentifier(sid).IsWellKnown(WellKnownSidType.BuiltinAdministratorsSid));
            }
        }
    }
}
