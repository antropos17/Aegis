using System;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
using System.Text;
using System.Threading;

internal static class Native
{
    private const uint CREATE_SUSPENDED = 0x00000004;
    private const uint CREATE_NO_WINDOW = 0x08000000;
    private const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
    private const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
    private const uint STARTF_USESTDHANDLES = 0x00000100;
    private const uint HANDLE_FLAG_INHERIT = 0x00000001;
    private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
    private const int JobObjectExtendedLimitInformation = 9;
    private const int JobObjectBasicAccountingInformation = 1;
    private static readonly IntPtr PROC_THREAD_ATTRIBUTE_HANDLE_LIST = new IntPtr(0x00020002);
    private static readonly IntPtr PROC_THREAD_ATTRIBUTE_JOB_LIST = new IntPtr(0x0002000D);

    [StructLayout(LayoutKind.Sequential)]
    private struct SECURITY_ATTRIBUTES { public int nLength; public IntPtr lpSecurityDescriptor; public int bInheritHandle; }
    [StructLayout(LayoutKind.Sequential)]
    private struct STARTUPINFO
    {
        public int cb;
        public IntPtr lpReserved, lpDesktop, lpTitle;
        public uint dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
        public ushort wShowWindow, cbReserved2;
        public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct STARTUPINFOEX { public STARTUPINFO StartupInfo; public IntPtr lpAttributeList; }
    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public uint dwProcessId, dwThreadId; }
    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
        public uint LimitFlags;
        public IntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public IntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct IO_COUNTERS
    {
        public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
        public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public IntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
    }
    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_ACCOUNTING_INFORMATION
    {
        public long TotalUserTime, TotalKernelTime, ThisPeriodTotalUserTime, ThisPeriodTotalKernelTime;
        public uint TotalPageFaultCount, TotalProcesses, ActiveProcesses, TotalTerminatedProcesses;
    }

    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION info, int length);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool QueryInformationJobObject(IntPtr job, int infoClass, out JOBOBJECT_BASIC_ACCOUNTING_INFORMATION info, int length, IntPtr returned);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool TerminateJobObject(IntPtr job, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool TerminateProcess(IntPtr process, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool CreatePipe(out IntPtr read, out IntPtr write, ref SECURITY_ATTRIBUTES attributes, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool PeekNamedPipe(IntPtr pipe, IntPtr buffer, uint bufferSize, IntPtr read, out uint available, IntPtr left);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr GetStdHandle(int standardHandle);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, uint flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
    [DllImport("kernel32.dll")] private static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool CreateProcess(
        string application, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes,
        bool inheritHandles, uint flags, IntPtr environment, string cwd,
        ref STARTUPINFOEX startup, out PROCESS_INFORMATION process);

    private static void Check(bool result) { if (!result) throw new InvalidOperationException("native-operation-failed"); }
    private static void Close(ref IntPtr handle) { if (handle != IntPtr.Zero) { CloseHandle(handle); handle = IntPtr.Zero; } }
    private static FileStream TakeStream(ref IntPtr handle, FileAccess access)
    {
        SafeFileHandle safe = new SafeFileHandle(handle, true);
        handle = IntPtr.Zero;
        try { return new FileStream(safe, access, 1, false); }
        catch { safe.Dispose(); throw; }
    }

    internal static IntPtr StandardInput() { return GetStdHandle(-10); }

    // FileStream.CopyTo can wait for a full buffer on anonymous Windows pipes.
    // Peek first, then request only bytes already available to keep MCP RPC live.
    internal static int ReadAvailable(Stream stream, IntPtr pipe, byte[] buffer)
    {
        uint available;
        if (!PeekNamedPipe(pipe, IntPtr.Zero, 0, IntPtr.Zero, out available, IntPtr.Zero)) return -1;
        if (available == 0) { Thread.Sleep(2); return 0; }
        return stream.Read(buffer, 0, (int)Math.Min((uint)buffer.Length, available));
    }

    internal sealed class Session : IDisposable
    {
        internal IntPtr Job, Process;
        internal FileStream Input, Output, Error;

        internal bool TerminateAndVerify()
        {
            if (Job == IntPtr.Zero || !TerminateJobObject(Job, 1)) return false;
            for (int i = 0; i < 75; i++)
            {
                JOBOBJECT_BASIC_ACCOUNTING_INFORMATION info;
                if (!QueryInformationJobObject(Job, JobObjectBasicAccountingInformation, out info,
                    Marshal.SizeOf(typeof(JOBOBJECT_BASIC_ACCOUNTING_INFORMATION)), IntPtr.Zero)) return false;
                if (info.ActiveProcesses == 0) return true;
                Thread.Sleep(10);
            }
            return false;
        }

        public void Dispose()
        {
            if (Input != null) Input.Dispose();
            if (Output != null) Output.Dispose();
            if (Error != null) Error.Dispose();
            Close(ref Process);
            Close(ref Job);
        }
    }

    internal static Session Start(string executable, string cwd, string[] args, string environment)
    {
        IntPtr inputRead = IntPtr.Zero, inputWrite = IntPtr.Zero;
        IntPtr outputRead = IntPtr.Zero, outputWrite = IntPtr.Zero;
        IntPtr errorRead = IntPtr.Zero, errorWrite = IntPtr.Zero;
        IntPtr list = IntPtr.Zero, handles = IntPtr.Zero, jobList = IntPtr.Zero, env = IntPtr.Zero;
        IntPtr job = IntPtr.Zero;
        PROCESS_INFORMATION process = new PROCESS_INFORMATION();
        bool listReady = false, resumed = false;
        try
        {
            SECURITY_ATTRIBUTES security = new SECURITY_ATTRIBUTES();
            security.nLength = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES));
            security.bInheritHandle = 1;
            Check(CreatePipe(out inputRead, out inputWrite, ref security, 0));
            Check(CreatePipe(out outputRead, out outputWrite, ref security, 0));
            Check(CreatePipe(out errorRead, out errorWrite, ref security, 0));
            Check(SetHandleInformation(inputWrite, HANDLE_FLAG_INHERIT, 0));
            Check(SetHandleInformation(outputRead, HANDLE_FLAG_INHERIT, 0));
            Check(SetHandleInformation(errorRead, HANDLE_FLAG_INHERIT, 0));

            job = CreateJobObject(IntPtr.Zero, null);
            Check(job != IntPtr.Zero);
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            Check(SetInformationJobObject(job, JobObjectExtendedLimitInformation, ref limits,
                Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION))));

            IntPtr size = IntPtr.Zero;
            InitializeProcThreadAttributeList(IntPtr.Zero, 2, 0, ref size);
            Check(size != IntPtr.Zero);
            list = Marshal.AllocHGlobal(size);
            Check(InitializeProcThreadAttributeList(list, 2, 0, ref size));
            listReady = true;
            handles = Marshal.AllocHGlobal(IntPtr.Size * 3);
            Marshal.WriteIntPtr(handles, 0, inputRead);
            Marshal.WriteIntPtr(handles, IntPtr.Size, outputWrite);
            Marshal.WriteIntPtr(handles, IntPtr.Size * 2, errorWrite);
            Check(UpdateProcThreadAttribute(list, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST, handles,
                new IntPtr(IntPtr.Size * 3), IntPtr.Zero, IntPtr.Zero));
            // The child enters this private kill-on-close Job during CreateProcess.
            // Keep the backing buffer alive until DeleteProcThreadAttributeList.
            jobList = Marshal.AllocHGlobal(IntPtr.Size);
            Marshal.WriteIntPtr(jobList, job);
            Check(UpdateProcThreadAttribute(list, 0, PROC_THREAD_ATTRIBUTE_JOB_LIST, jobList,
                new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero));
            STARTUPINFOEX startup = new STARTUPINFOEX();
            startup.StartupInfo.cb = Marshal.SizeOf(typeof(STARTUPINFOEX));
            startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
            startup.StartupInfo.hStdInput = inputRead;
            startup.StartupInfo.hStdOutput = outputWrite;
            startup.StartupInfo.hStdError = errorWrite;
            startup.lpAttributeList = list;
            env = Marshal.StringToHGlobalUni(environment);
            Check(CreateProcess(executable, new StringBuilder(CommandLine(executable, args)),
                IntPtr.Zero, IntPtr.Zero, true,
                CREATE_SUSPENDED | CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT | EXTENDED_STARTUPINFO_PRESENT,
                env, cwd, ref startup, out process));
#if MCP_JOB_CRASH_TEST
            // Test-only stop at the former orphan window, before ResumeThread.
            string marker = Environment.GetEnvironmentVariable("AEGIS_MCPJOB_CRASH_MARKER");
            if (string.IsNullOrEmpty(marker)) throw new InvalidOperationException("missing-test-marker");
            File.WriteAllText(marker, process.dwProcessId.ToString(System.Globalization.CultureInfo.InvariantCulture));
            Thread.Sleep(Timeout.Infinite);
#endif
            Check(ResumeThread(process.hThread) != uint.MaxValue);
            resumed = true;
            Close(ref process.hThread);
            Close(ref inputRead); Close(ref outputWrite); Close(ref errorWrite);
            Session session = new Session();
            session.Job = job; job = IntPtr.Zero;
            session.Process = process.hProcess; process.hProcess = IntPtr.Zero;
            try
            {
                session.Input = TakeStream(ref inputWrite, FileAccess.Write);
                session.Output = TakeStream(ref outputRead, FileAccess.Read);
                session.Error = TakeStream(ref errorRead, FileAccess.Read);
                return session;
            }
            catch
            {
                session.TerminateAndVerify();
                session.Dispose();
                throw;
            }
        }
        finally
        {
            if (!resumed && process.hProcess != IntPtr.Zero)
            {
                if (!TerminateJobObject(job, 1)) TerminateProcess(process.hProcess, 1);
                WaitForSingleObject(process.hProcess, 750);
            }
            Close(ref process.hThread); Close(ref process.hProcess);
            Close(ref inputRead); Close(ref inputWrite); Close(ref outputRead); Close(ref outputWrite);
            Close(ref errorRead); Close(ref errorWrite); Close(ref job);
            if (listReady) DeleteProcThreadAttributeList(list);
            if (list != IntPtr.Zero) Marshal.FreeHGlobal(list);
            if (handles != IntPtr.Zero) Marshal.FreeHGlobal(handles);
            if (jobList != IntPtr.Zero) Marshal.FreeHGlobal(jobList);
            if (env != IntPtr.Zero) Marshal.FreeHGlobal(env);
        }
    }

    private static string CommandLine(string executable, string[] args)
    {
        StringBuilder value = new StringBuilder();
        AppendArgument(value, executable);
        foreach (string arg in args) { value.Append(' '); AppendArgument(value, arg); }
        return value.ToString();
    }

    // Windows CRT quoting, matching the ordinary Node spawn argv contract.
    private static void AppendArgument(StringBuilder value, string arg)
    {
        value.Append('"');
        int slashes = 0;
        foreach (char c in arg)
        {
            if (c == '\\') { slashes++; continue; }
            if (c == '"')
            {
                value.Append('\\', slashes * 2 + 1);
                value.Append('"');
            }
            else { value.Append('\\', slashes); value.Append(c); }
            slashes = 0;
        }
        value.Append('\\', slashes * 2);
        value.Append('"');
    }
}
