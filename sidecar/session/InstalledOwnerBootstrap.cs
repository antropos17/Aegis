using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using Microsoft.Win32.SafeHandles;

namespace Aegis.ProtectedSession
{
    internal sealed class InstalledOwnerDeadline
    {
        private readonly Stopwatch clock = Stopwatch.StartNew();
        private readonly int limit;
        internal InstalledOwnerDeadline(int milliseconds) { CallerNative.Require(milliseconds > 0 && milliseconds <= 12000); limit = milliseconds; }
        internal int Remaining { get { int left = limit - (int)clock.ElapsedMilliseconds; CallerNative.Require(left > 0); return left; } }
        internal void Check() { int ignored = Remaining; GC.KeepAlive(ignored); }
    }

    // Anonymous directions are created by the original owner and individually allowlisted at creation.
    internal sealed class InstalledOwnerPipe : IDisposable
    {
        [DllImport("kernel32.dll", SetLastError = true)] private static extern bool CreatePipe(out SafeFileHandle read,
            out SafeFileHandle write, IntPtr attributes, uint size);
        [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool SetHandleInformation(SafeFileHandle handle, uint mask, uint flags);
        [DllImport("kernel32.dll")] internal static extern IntPtr GetStdHandle(int kind);
        [DllImport("kernel32.dll")] private static extern uint GetFileType(SafeFileHandle file);
        [DllImport("kernel32.dll", SetLastError = true)] private static extern bool DuplicateHandle(IntPtr sourceProcess,
            SafeFileHandle source, SafeFileHandle targetProcess, out IntPtr target, uint rights, bool inherit, uint options);
        [StructLayout(LayoutKind.Sequential)] private struct ObjectBasic
        {
            internal uint Attributes, Access, Handles, Pointers, Paged, NonPaged;
            internal uint Reserved1, Reserved2, Reserved3, NameLength, TypeLength, DescriptorLength;
            internal long Created;
        }
        [DllImport("ntdll.dll")] private static extern int NtQueryObject(SafeFileHandle handle, int kind,
            out ObjectBasic basic, int length, out int returned);
        internal readonly SafeFileHandle Read, Write;
        internal InstalledOwnerPipe(bool childWrites)
        {
            CallerNative.Require(CreatePipe(out Read, out Write, IntPtr.Zero, 4096));
            try
            {
                CallerEndpointNative.RequireNonInherited(Read); CallerEndpointNative.RequireNonInherited(Write);
                CallerNative.Require(SetHandleInformation(childWrites ? Write : Read, 1, 1));
            }
            catch { Dispose(); throw; }
        }
        internal static SafeFileHandle ImportProcess(IntPtr value)
        { return Import(value, 0x00101000, false); }
        internal static SafeFileHandle ImportJob(IntPtr value)
        { return Import(value, 4, false); }
        private static SafeFileHandle Import(IntPtr value, uint rights, bool inherited)
        {
            CallerNative.Require(value.ToInt64() > 0 && (value.ToInt64() & 3) == 0);
            var handle = new SafeFileHandle(value, true);
            try
            {
                uint flags; ObjectBasic basic; int returned;
                CallerNative.Require(CallerEndpointNative.GetHandleInformation(handle, out flags) &&
                    (flags & 1) == (inherited ? 1U : 0U) && NtQueryObject(handle, 0, out basic,
                        Marshal.SizeOf(typeof(ObjectBasic)), out returned) == 0 && basic.Access == rights);
                if (inherited) CallerNative.Require(SetHandleInformation(handle, 1, 0));
                return handle;
            }
            catch { handle.Dispose(); throw; }
        }
        internal static SafeFileHandle Standard(int kind)
        {
            var handle = new SafeFileHandle(GetStdHandle(kind), true);
            try
            {
                CallerNative.Require(!handle.IsInvalid && GetFileType(handle) == 3 && SetHandleInformation(handle, 1, 0));
                CallerEndpointNative.RequireNonInherited(handle); return handle;
            }
            catch { handle.Dispose(); throw; }
        }
        internal static IntPtr Reduce(SafeFileHandle source, SafeFileHandle target, uint rights)
        {
            IntPtr remote;
            CallerNative.Require(DuplicateHandle(CallerEndpointNative.GetCurrentProcess(), source, target,
                out remote, rights, false, 0)); return remote;
        }
        internal static byte[] ReadExact(SafeFileHandle input, int length, InstalledOwnerDeadline deadline)
        {
            CallerNative.Require(length > 0 && length <= 4096); byte[] result = new byte[length]; int offset = 0;
            while (offset < length)
            {
                deadline.Check(); uint available, left;
                CallerNative.Require(CallerNative.PeekNamedPipe(input, IntPtr.Zero, 0, IntPtr.Zero, out available, out left) && available <= 4096);
                if (available == 0) { Thread.Sleep(2); continue; }
                uint count = Math.Min(available, (uint)(length - offset)); byte[] chunk = new byte[count]; uint read;
                CallerNative.Require(CallerNative.ReadFile(input, chunk, count, out read, IntPtr.Zero) && read == count);
                Buffer.BlockCopy(chunk, 0, result, offset, (int)count); offset += (int)count;
            }
            deadline.Check(); return result;
        }
        internal static void Eof(SafeFileHandle input, InstalledOwnerDeadline deadline)
        {
            while (true)
            {
                deadline.Check(); uint available, left;
                if (!CallerNative.PeekNamedPipe(input, IntPtr.Zero, 0, IntPtr.Zero, out available, out left))
                { CallerNative.Require(Marshal.GetLastWin32Error() == 109); return; }
                CallerNative.Require(available == 0); Thread.Sleep(2);
            }
        }
        internal static void Send(SafeFileHandle output, byte[] frame, InstalledOwnerDeadline deadline)
        {
            deadline.Check(); CallerNative.Require(frame.Length > 0 && frame.Length <= 2048); uint written;
            CallerNative.Require(CallerEndpointNative.WriteFile(output, frame, (uint)frame.Length, out written, IntPtr.Zero) && written == frame.Length);
            deadline.Check();
        }
        public void Dispose() { if (Read != null) Read.Dispose(); if (Write != null) Write.Dispose(); }
    }

    internal sealed class InstalledOwnerBootstrap : IDisposable
    {
        internal const int Size = 248;
        internal readonly SafeFileHandle Owner, Job, Main;
        internal readonly string Session, InstallId, Epoch;
        internal readonly uint Revision;
        private InstalledOwnerBootstrap(byte[] bytes)
        {
            string text = Encoding.ASCII.GetString(bytes);
            CallerNative.Require(bytes.Length == Size && Regex.IsMatch(text, "\\AAEGISO02[a-f0-9]{240}\\z"));
            try
            {
                Owner = InstalledOwnerPipe.ImportProcess(Handle(text, 8)); Job = InstalledOwnerPipe.ImportJob(Handle(text, 24));
                Main = InstalledOwnerPipe.ImportProcess(Handle(text, 40));
                CallerNative.Require(Handle(text, 56) == IntPtr.Zero); // reserved, canonical zero; output comes only from allowlisted stdout.
                CheckObserved(Owner, text, 72);
                using (var self = Process.GetCurrentProcess()) using (var exact = CallerNative.Duplicate(self.Handle)) CheckObserved(exact, text, 96);
                CheckObserved(Main, text, 120);
                Session = text.Substring(144, 32); InstallId = text.Substring(176, 32); Epoch = text.Substring(208, 32);
                Revision = Convert.ToUInt32(text.Substring(240, 8), 16); CallerNative.Require(Revision > 0);
            }
            catch { Dispose(); throw; }
        }
        private static IntPtr Handle(string text, int offset) { return new IntPtr(Convert.ToInt64(text.Substring(offset, 16), 16)); }
        private static void CheckObserved(SafeFileHandle process, string text, int offset)
        {
            long birth, exit, kernel, user;
            CallerNative.Require(CallerNative.GetProcessId(process) == Convert.ToUInt32(text.Substring(offset, 8), 16) &&
                CallerNative.GetProcessTimes(process, out birth, out exit, out kernel, out user) &&
                birth == Convert.ToInt64(text.Substring(offset + 8, 16), 16) && birth > 0 && CallerNative.WaitForSingleObject(process, 0) == 0x102);
        }
        private static string Observation(SafeFileHandle process)
        {
            long birth, exit, kernel, user;
            CallerNative.Require(CallerNative.GetProcessTimes(process, out birth, out exit, out kernel, out user));
            return CallerNative.GetProcessId(process).ToString("x8") + birth.ToString("x16");
        }
        internal static byte[] Issue(SafeFileHandle owner, CallerLauncherNative.Created supervisor,
            CallerLauncherNative.Created main, InstalledOwnerPolicy policy, string session)
        {
            IntPtr remoteOwner = InstalledOwnerPipe.Reduce(owner, supervisor.Process, 0x00101000);
            IntPtr remoteJob = InstalledOwnerPipe.Reduce(supervisor.Job, supervisor.Process, 4);
            IntPtr remoteMain = InstalledOwnerPipe.Reduce(main.Process, supervisor.Process, 0x00101000);
            return Encoding.ASCII.GetBytes("AEGISO02" + remoteOwner.ToInt64().ToString("x16") + remoteJob.ToInt64().ToString("x16") +
                remoteMain.ToInt64().ToString("x16") + new string('0', 16) + Observation(owner) + Observation(supervisor.Process) +
                Observation(main.Process) + session + policy.InstallId + policy.Epoch + policy.Revision.ToString("x8"));
        }
        internal static InstalledOwnerBootstrap Receive(SafeFileHandle input, InstalledOwnerDeadline deadline)
        { byte[] frame = InstalledOwnerPipe.ReadExact(input, Size, deadline); InstalledOwnerPipe.Eof(input, deadline); return new InstalledOwnerBootstrap(frame); }
        internal void CheckPolicy(InstalledOwnerPolicy policy)
        { CallerNative.Require(policy.InstallId == InstallId && policy.Epoch == Epoch && policy.Revision == Revision); policy.CheckCurrent(); }
        public void Dispose() { if (Main != null) Main.Dispose(); if (Job != null) Job.Dispose(); if (Owner != null) Owner.Dispose(); }
    }
}
