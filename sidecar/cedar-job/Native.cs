using System.Runtime.InteropServices;
using System.Text;

internal static class Native
{
    [StructLayout(LayoutKind.Sequential)] internal struct Security { internal int Length; internal nint Descriptor; internal int Inherit; }
    [StructLayout(LayoutKind.Sequential)] internal struct Startup
    {
        internal int Size;
        internal nint Reserved, Desktop, Title;
        internal uint X, Y, XSize, YSize, XCount, YCount, Fill, Flags;
        internal ushort Show, ReservedSize;
        internal nint Reserved2, Input, Output, Error;
    }
    [StructLayout(LayoutKind.Sequential)] internal struct StartupEx { internal Startup Info; internal nint Attributes; }
    [StructLayout(LayoutKind.Sequential)] internal struct ProcessInfo { internal nint Process, Thread; internal uint Id, ThreadId; }
    [StructLayout(LayoutKind.Sequential)] internal struct BasicLimits
    {
        internal long ProcessTime, JobTime;
        internal uint Flags;
        internal nuint Minimum, Maximum;
        internal uint ActiveProcesses;
        internal nuint Affinity;
        internal uint Priority, Scheduling;
    }
    [StructLayout(LayoutKind.Sequential)] internal struct IoCounters { internal ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes; }
    [StructLayout(LayoutKind.Sequential)] internal struct Limits
    {
        internal BasicLimits Basic;
        internal IoCounters Io;
        internal nuint ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    [StructLayout(LayoutKind.Sequential)] internal struct Accounting
    {
        internal long User, Kernel, PeriodUser, PeriodKernel;
        internal uint PageFaults, TotalProcesses, ActiveProcesses, TerminatedProcesses;
    }
    [StructLayout(LayoutKind.Sequential)] internal struct UiLimits { internal uint Flags; }
    [StructLayout(LayoutKind.Sequential)] internal struct CpuLimits { internal uint Flags, Value; }
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern nint CreateJobObjectW(nint attributes, nint name);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool SetInformationJobObject(nint job, int kind, ref Limits limits, int size);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool QueryInformationJobObject(nint job, int kind, out Limits limits, int size, nint returned);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool QueryInformationJobObject(nint job, int kind, out Accounting accounting, int size, nint returned);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool QueryInformationJobObject(nint job, int kind, out UiLimits limits, int size, nint returned);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool QueryInformationJobObject(nint job, int kind, out CpuLimits limits, int size, nint returned);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool TerminateJobObject(nint job, uint code);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool IsProcessInJob(nint process, nint job, out bool assigned);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool AssignProcessToJobObject(nint job, nint process);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern uint WaitForSingleObject(nint handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool GetExitCodeProcess(nint process, out uint code);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool GetProcessTimes(nint process, out long creation, out long exit, out long kernel, out long user);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern uint ResumeThread(nint thread);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool CloseHandle(nint handle);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool CreatePipe(out nint read, out nint write, ref Security security, uint size);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool SetHandleInformation(nint handle, uint mask, uint flags);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool GetHandleInformation(nint handle, out uint flags);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool PeekNamedPipe(nint pipe, nint buffer, uint size, nint read, out uint available, nint left);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool ReadFile(nint pipe, byte[] buffer, uint size, out uint read, nint overlapped);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool WriteFile(nint pipe, byte[] buffer, uint size, out uint written, nint overlapped);
    [DllImport("kernel32.dll")] internal static extern nint GetStdHandle(int kind);
    [DllImport("kernel32.dll")] internal static extern nint GetCurrentProcess();
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool InitializeProcThreadAttributeList(nint list, int count, uint flags, ref nuint size);
    [DllImport("kernel32.dll", SetLastError = true)] internal static extern bool UpdateProcThreadAttribute(nint list, uint flags, nint attribute, nint value, nuint size, nint previous, nint returned);
    [DllImport("kernel32.dll")] internal static extern void DeleteProcThreadAttributeList(nint list);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true, EntryPoint = "CreateProcessW")]
    internal static extern bool CreateProcess(string application, StringBuilder command, nint processSecurity, nint threadSecurity, bool inherit, uint flags, nint environment, string cwd, ref StartupEx startup, out ProcessInfo process);

    internal static void Check(bool ok) { if (!ok) throw new InvalidOperationException("cedar-native-refused"); }
    internal static void Close(ref nint handle)
    {
        if (handle != 0) { CloseHandle(handle); handle = 0; }
    }
}
