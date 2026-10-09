using System;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace Aegis.ProtectedSession
{
    // Internal native-code seam; no wire-selected handles, commands or policy.
    internal class CallerLauncherNative
    {
        [StructLayout(LayoutKind.Sequential)] private struct Startup
        {
            internal int Size;
            internal IntPtr Reserved, Desktop, Title;
            internal uint X, Y, Width, Height, CharsX, CharsY, Fill, Flags;
            internal ushort Show, ReservedSize;
            internal IntPtr ReservedBytes, Input, Output, Error;
        }
        [StructLayout(LayoutKind.Sequential)] private struct ExtendedStartup
        { internal Startup Startup; internal IntPtr Attributes; }
        [StructLayout(LayoutKind.Sequential)] internal struct ProcessInformation
        { internal IntPtr Process, Thread; internal uint Pid, Tid; }
        [StructLayout(LayoutKind.Sequential)] private struct BasicLimits
        {
            internal long ProcessTime, JobTime;
            internal uint Flags;
            internal IntPtr Minimum, Maximum;
            internal uint ActiveLimit;
            internal IntPtr Affinity;
            internal uint Priority, Scheduling;
        }
        [StructLayout(LayoutKind.Sequential)] private struct IoCounters
        { internal ulong Read, Write, Other, ReadBytes, WriteBytes, OtherBytes; }
        [StructLayout(LayoutKind.Sequential)] private struct Limits
        {
            internal BasicLimits Basic;
            internal IoCounters Io;
            internal IntPtr ProcessMemory, JobMemory, PeakProcess, PeakJob;
        }
        [StructLayout(LayoutKind.Sequential)] private struct Accounting
        {
            internal long User, Kernel, PeriodUser, PeriodKernel;
            internal uint Faults, Total, Active, Terminated;
        }
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool CreateProcess(string image, StringBuilder command,
            IntPtr processSecurity, IntPtr threadSecurity, bool inherit, uint flags,
            IntPtr environment, string directory, ref ExtendedStartup startup, out ProcessInformation result);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern SafeFileHandle CreateJobObject(IntPtr security, string name);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool SetInformationJobObject(SafeFileHandle job, int kind, ref Limits limits, int length);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, uint flags, ref IntPtr size);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr kind,
            IntPtr value, IntPtr length, IntPtr previous, IntPtr returned);
        [DllImport("kernel32.dll")] private static extern void DeleteProcThreadAttributeList(IntPtr list);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool IsProcessInJob(SafeFileHandle process, SafeFileHandle job, out bool member);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool GetHandleInformation(SafeFileHandle handle, out uint flags);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool QueryInformationJobObject(SafeFileHandle job, int kind,
            out Accounting value, int size, IntPtr returned);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool TerminateJobObject(SafeFileHandle job, uint code);
        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern uint ResumeThread(SafeFileHandle thread);

        internal sealed class Created : IDisposable
        {
            internal readonly SafeFileHandle Process, Thread, Job;
            internal readonly uint Pid;
            internal Created(ProcessInformation value, SafeFileHandle job)
            {
                Process = new SafeFileHandle(value.Process, true);
                Thread = new SafeFileHandle(value.Thread, true);
                Pid = value.Pid; Job = job;
            }
            public void Dispose() { Job.Dispose(); Thread.Dispose(); Process.Dispose(); }
        }

        internal virtual Created Create(string image)
        {
            SafeFileHandle job = CreateJobObject(IntPtr.Zero, null);
            IntPtr list = IntPtr.Zero, jobList = IntPtr.Zero;
            bool initialized = false, transferred = false;
            try
            {
                CallerNative.Require(job != null && !job.IsInvalid);
                // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_ACTIVE_PROCESS.
                var limits = new Limits(); limits.Basic.Flags = 0x2000 | 8;
                limits.Basic.ActiveLimit = 64;
                CallerNative.Require(SetInformationJobObject(job, 9, ref limits, Marshal.SizeOf(typeof(Limits))));
                IntPtr size = IntPtr.Zero;
                bool queried = InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
                CallerNative.Require(!queried && Marshal.GetLastWin32Error() == 122 && size.ToInt64() > 0 && size.ToInt64() <= 65536);
                list = Marshal.AllocHGlobal(size);
                CallerNative.Require(InitializeProcThreadAttributeList(list, 1, 0, ref size)); initialized = true;
                jobList = Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(jobList, job.DangerousGetHandle());
                // PROC_THREAD_ATTRIBUTE_JOB_LIST binds containment atomically at creation.
                CallerNative.Require(UpdateProcThreadAttribute(list, 0, new IntPtr(0x0002000D),
                    jobList, new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero));
                var startup = new ExtendedStartup(); startup.Startup.Size = Marshal.SizeOf(typeof(ExtendedStartup));
                startup.Attributes = list;
                ProcessInformation result;
                // CREATE_SUSPENDED | CREATE_NO_WINDOW | EXTENDED_STARTUPINFO_PRESENT.
                // bInheritHandles=false excludes unrelated inheritable owner handles.
                CallerNative.Require(CreateProcess(image, new StringBuilder("\"" + image + "\""),
                    IntPtr.Zero, IntPtr.Zero, false, 0x00000004 | 0x08000000 | 0x00080000,
                    IntPtr.Zero, System.IO.Path.GetDirectoryName(image), ref startup, out result));
                var created = new Created(result, job); transferred = true; return created;
            }
            finally
            {
                if (initialized) DeleteProcThreadAttributeList(list);
                if (jobList != IntPtr.Zero) Marshal.FreeHGlobal(jobList);
                if (list != IntPtr.Zero) Marshal.FreeHGlobal(list);
                if (!transferred && job != null) job.Dispose();
            }
        }

        internal static void CheckCreated(Created created)
        {
            uint flags; bool member;
            foreach (SafeFileHandle handle in new[] { created.Process, created.Thread, created.Job })
                CallerNative.Require(!handle.IsInvalid && !handle.IsClosed && GetHandleInformation(handle, out flags) && (flags & 1) == 0);
            CallerNative.Require(created.Pid != 0 && CallerNative.GetProcessId(created.Process) == created.Pid &&
                CallerNative.WaitForSingleObject(created.Process, 0) == 0x102 &&
                IsProcessInJob(created.Process, created.Job, out member) && member);
        }

        internal static void Stop(Created created)
        {
            // Termination is asynchronous: require root exit and queried Job empty.
            CallerNative.Require(TerminateJobObject(created.Job, 1));
            CallerNative.Require(CallerNative.WaitForSingleObject(created.Process, 2000) == 0);
            var watch = System.Diagnostics.Stopwatch.StartNew();
            while (true)
            {
                Accounting counts;
                CallerNative.Require(QueryInformationJobObject(created.Job, 1, out counts,
                    Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero) && counts.Active <= 64 && counts.Active <= counts.Total);
                if (counts.Active == 0) return;
                CallerNative.Require(watch.ElapsedMilliseconds < 2000);
                System.Threading.Thread.Sleep(2);
            }
        }
    }
}
