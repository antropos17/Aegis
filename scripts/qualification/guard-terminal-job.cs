using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

// Own only a suspended PowerShell process and its non-breakaway descendants.
internal static class GuardTerminalJob
{
    [StructLayout(LayoutKind.Sequential)] private struct BasicLimit
    {
        public long ProcessTime, JobTime;
        public uint Flags;
        public UIntPtr MinWorkingSet, MaxWorkingSet;
        public uint ActiveLimit;
        public UIntPtr Affinity;
        public uint Priority, Scheduling;
    }
    [StructLayout(LayoutKind.Sequential)] private struct IoCounters
    { public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes; }
    [StructLayout(LayoutKind.Sequential)] private struct ExtendedLimit
    {
        public BasicLimit Basic;
        public IoCounters Io;
        public UIntPtr ProcessMemory, JobMemory, PeakProcess, PeakJob;
    }
    [StructLayout(LayoutKind.Sequential)] private struct Accounting
    {
        public long TotalUser, TotalKernel, ThisUser, ThisKernel;
        public uint PageFaults, TotalProcesses, ActiveProcesses, TerminatedProcesses;
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct Startup
    {
        public int Size;
        public string Reserved, Desktop, Title;
        public int X, Y, XSize, YSize, XChars, YChars, Fill, Flags;
        public short Show, Reserved2Size;
        public IntPtr Reserved2, Input, Output, Error;
    }
    [StructLayout(LayoutKind.Sequential)] private struct ProcessInformation
    { public IntPtr Process, Thread; public uint ProcessId, ThreadId; }
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref ExtendedLimit info, uint size);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool QueryInformationJobObject(IntPtr job, int infoClass, out Accounting info, uint size, IntPtr returned);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CreateProcess(string app, StringBuilder command, IntPtr processAttrs, IntPtr threadAttrs,
        bool inherit, uint flags, IntPtr environment, string cwd, ref Startup startup, out ProcessInformation info);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool TerminateJobObject(IntPtr job, uint code);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);

    private static string Quote(string value)
    {
        var result = new StringBuilder("\"");
        int slashes = 0;
        foreach (char c in value)
        {
            if (c == '\\') { slashes++; continue; }
            if (c == '"') { result.Append('\\', slashes * 2 + 1); result.Append(c); slashes = 0; continue; }
            result.Append('\\', slashes); slashes = 0; result.Append(c);
        }
        result.Append('\\', slashes * 2); result.Append('"');
        return result.ToString();
    }
    private static uint Active(IntPtr job)
    {
        Accounting info;
        if (!QueryInformationJobObject(job, 1, out info, (uint)Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero))
            throw new InvalidOperationException("job-query-failed");
        return info.ActiveProcesses;
    }
    private static int Main(string[] args)
    {
        if (args.Length != 3) return 2;
        IntPtr job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) return 2;
        ProcessInformation child = new ProcessInformation();
        bool assigned = false;
        try
        {
            var limits = new ExtendedLimit();
            limits.Basic.Flags = 0x00002000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            if (!SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimit))))
                throw new InvalidOperationException("job-config-failed");
            var startup = new Startup();
            startup.Size = Marshal.SizeOf(typeof(Startup));
            var command = new StringBuilder(Quote(args[0]) + " -NoProfile -Command " + Quote(args[1]));
            if (!CreateProcess(args[0], command, IntPtr.Zero, IntPtr.Zero, true, 4, IntPtr.Zero,
                Directory.GetCurrentDirectory(), ref startup, out child))
                throw new InvalidOperationException("shell-create-failed");
            if (!AssignProcessToJobObject(job, child.Process))
                throw new InvalidOperationException("job-assignment-failed");
            assigned = true;
            if (ResumeThread(child.Thread) == UInt32.MaxValue) throw new InvalidOperationException("shell-resume-failed");
            var deadline = DateTime.UtcNow.AddSeconds(55);
            while (Active(job) != 0 && DateTime.UtcNow < deadline) Thread.Sleep(100);
            bool normal = Active(job) == 0;
            if (!normal)
            {
                if (!TerminateJobObject(job, 2)) throw new InvalidOperationException("job-termination-failed");
                deadline = DateTime.UtcNow.AddSeconds(5);
                while (Active(job) != 0 && DateTime.UtcNow < deadline) Thread.Sleep(100);
            }
            bool drained = Active(job) == 0;
            File.WriteAllText(args[2], (normal ? "NORMAL " : "TERMINATED ") + (drained ? "DRAINED\n" : "UNKNOWN\n"));
            return normal && drained ? 0 : 2;
        }
        catch
        {
            if (assigned) TerminateJobObject(job, 2);
            else if (child.Process != IntPtr.Zero) TerminateProcess(child.Process, 2);
            return 2;
        }
        finally
        {
            if (child.Thread != IntPtr.Zero) CloseHandle(child.Thread);
            if (child.Process != IntPtr.Zero) CloseHandle(child.Process);
            CloseHandle(job);
        }
    }
}
