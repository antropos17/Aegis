using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using Microsoft.Win32.SafeHandles;

// Private native process operations. Only the typed lease selects production inputs.
internal sealed class ProtectedGuiProcessNative : IDisposable
{
    [StructLayout(LayoutKind.Sequential)] private struct Startup {
        internal int Size; internal IntPtr Reserved, Desktop, Title;
        internal uint X, Y, Width, Height, CharsX, CharsY, Fill, Flags;
        internal ushort Show, ReservedSize; internal IntPtr ReservedBytes, Input, Output, Error;
    }
    [StructLayout(LayoutKind.Sequential)] private struct ExtendedStartup { internal Startup Startup; internal IntPtr Attributes; }
    [StructLayout(LayoutKind.Sequential)] private struct ProcessInformation { internal IntPtr Process, Thread; internal uint Pid, Tid; }
    [StructLayout(LayoutKind.Sequential)] private struct BasicLimits {
        internal long ProcessTime, JobTime; internal uint Flags; internal IntPtr Minimum, Maximum;
        internal uint ActiveLimit; internal IntPtr Affinity; internal uint Priority, Scheduling;
    }
    [StructLayout(LayoutKind.Sequential)] private struct IoCounters { internal ulong Read, Write, Other, ReadBytes, WriteBytes, OtherBytes; }
    [StructLayout(LayoutKind.Sequential)] private struct Limits {
        internal BasicLimits Basic; internal IoCounters Io; internal IntPtr ProcessMemory, JobMemory, PeakProcess, PeakJob;
    }
    [StructLayout(LayoutKind.Sequential)] private struct Accounting {
        internal long User, Kernel, PeriodUser, PeriodKernel; internal uint Faults, Total, Active, Terminated;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern SafeFileHandle CreateJobObject(IntPtr security, string name);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool SetInformationJobObject(SafeFileHandle job, int kind, ref Limits value, int size);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool QueryInformationJobObject(SafeFileHandle job, int kind, out Accounting value, int size, IntPtr returned);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, uint flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr kind, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
    [DllImport("kernel32.dll")] private static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", EntryPoint = "CreateProcessW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcess(string image, StringBuilder command, IntPtr processSecurity, IntPtr threadSecurity, bool inherit, uint flags, IntPtr environment, string cwd, ref ExtendedStartup startup, out ProcessInformation result);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcessAsUser(SafeFileHandle token, string image, StringBuilder command, IntPtr processSecurity, IntPtr threadSecurity, bool inherit, uint flags, IntPtr environment, string cwd, ref ExtendedStartup startup, out ProcessInformation result);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetHandleInformation(SafeFileHandle handle, out uint flags);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint GetProcessId(SafeFileHandle process);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetProcessTimes(SafeFileHandle process, out long birth, out long exit, out long kernel, out long user);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool QueryFullProcessImageName(SafeFileHandle process, uint flags, StringBuilder text, ref uint size);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool IsProcessInJob(SafeFileHandle process, SafeFileHandle job, out bool member);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint ResumeThread(SafeFileHandle thread);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool TerminateJobObject(SafeFileHandle job, uint code);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint WaitForSingleObject(SafeFileHandle handle, uint milliseconds);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool OpenProcessToken(SafeFileHandle process, uint rights, out SafeFileHandle token);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool CloseHandle(IntPtr handle);
    private SafeFileHandle process, thread, job;
    private readonly string image;
    private uint pid;
    private long birth;
    private bool releaseAttempted, released, stopped, closed, cleanupUnknown;
#if PROTECTED_GUI_PROCESS_TEST
    internal static bool FailStopAcknowledgmentForTest = false;
#endif
    internal uint ProcessId { get { return pid; } }
    internal bool CleanupUnknown { get { return cleanupUnknown; } }
    internal sealed class Observation {
        internal readonly bool RootAlive, Released, CleanupUnknown;
        internal readonly uint ActiveProcesses;
        internal readonly string State;
        internal Observation(bool alive, uint active, bool running, bool unknown, bool done) {
            RootAlive = alive; ActiveProcesses = active; Released = running; CleanupUnknown = unknown;
            State = unknown ? "cleanup-unknown" : done ? "stopped" : !alive ? (active == 0 ? "exited" : "root-exited") : running ? "running" : "suspended";
        }
    }
    private ProtectedGuiProcessNative(string fixedImage) { image = fixedImage; }
    private static InvalidDataException Refused() { return new InvalidDataException("protected-gui-process-refused"); }
    private static void Need(bool condition) { if (!condition) throw Refused(); }
    internal sealed class OwnershipFailure : IOException {
        internal readonly ProtectedGuiProcessNative Owner;
        internal OwnershipFailure(ProtectedGuiProcessNative original, Exception cause)
            : base("protected-gui-process-cleanup-unknown", cause) { Owner = original; Data["protectedCleanupUnknown"] = true; }
    }
    private Exception Unknown(Exception cause) {
        cleanupUnknown = true; return new OwnershipFailure(this, cause);
    }
    internal static ProtectedGuiProcessNative Prepare(string image, SafeFileHandle limitedToken, string profile) {
        Need(limitedToken != null && !limitedToken.IsClosed && !limitedToken.IsInvalid);
        return CreateCore(image, limitedToken, profile);
    }
    private static ProtectedGuiProcessNative CreateCore(string image, SafeFileHandle token, string profile) {
        Need(image != null && profile != null && image.Length <= 2048 && profile.Length <= 2048 &&
            Path.IsPathRooted(image) && Path.IsPathRooted(profile) && image.IndexOf('"') < 0 && profile.IndexOf('"') < 0 &&
            String.Equals(image, Path.GetFullPath(image), StringComparison.OrdinalIgnoreCase) &&
            String.Equals(profile, Path.GetFullPath(profile), StringComparison.OrdinalIgnoreCase));
        var owner = new ProtectedGuiProcessNative(image);
        IntPtr list = IntPtr.Zero, jobList = IntPtr.Zero, desktop = IntPtr.Zero, environment = IntPtr.Zero; bool initialized = false;
        try {
            owner.job = CreateJobObject(IntPtr.Zero, null); Need(owner.job != null && !owner.job.IsInvalid);
            var limits = new Limits(); limits.Basic.Flags = 0x2000 | 8; limits.Basic.ActiveLimit = 64;
            Need(SetInformationJobObject(owner.job, 9, ref limits, Marshal.SizeOf(typeof(Limits))));
            IntPtr size = IntPtr.Zero; bool queried = InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
            Need(!queried && Marshal.GetLastWin32Error() == 122 && size.ToInt64() > 0 && size.ToInt64() <= 65536);
            list = Marshal.AllocHGlobal(size); Need(InitializeProcThreadAttributeList(list, 1, 0, ref size)); initialized = true;
            jobList = Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(jobList, owner.job.DangerousGetHandle());
            Need(UpdateProcThreadAttribute(list, 0, new IntPtr(0x0002000D), jobList, new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero));
            var startup = new ExtendedStartup(); startup.Startup.Size = Marshal.SizeOf(typeof(ExtendedStartup)); startup.Attributes = list;
            if (token != null) { desktop = Marshal.StringToHGlobalUni("winsta0\\default"); startup.Startup.Desktop = desktop; }
            var command = new StringBuilder("\"" + image + "\" --aegis-owned-gui-profile \"" + profile + "\"");
            ProcessInformation created;
            // Explicit finite Unicode environment: no inherited credentials or loader options.
            string system = Environment.SystemDirectory, drive = Path.GetPathRoot(system);
            Need(Path.IsPathRooted(system) && drive != null && drive.Length == 3 && drive[1] == ':' && drive[2] == '\\');
            var windows = Directory.GetParent(system); Need(windows != null && Path.GetPathRoot(windows.FullName) == drive);
            environment = Marshal.StringToHGlobalUni("PATH=" + system + "\0SystemDrive=" + drive.Substring(0, 2) +
                "\0SystemRoot=" + windows.FullName + "\0TEMP=" + profile + "\0TMP=" + profile + "\0windir=" + windows.FullName + "\0\0");
            // CREATE_SUSPENDED | EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT.
            uint flags = 4 | 0x80000 | 0x400;
            bool made = token == null
                ? CreateProcess(image, command, IntPtr.Zero, IntPtr.Zero, false, flags, environment, Path.GetDirectoryName(image), ref startup, out created)
                : CreateProcessAsUser(token, image, command, IntPtr.Zero, IntPtr.Zero, false, flags, environment, Path.GetDirectoryName(image), ref startup, out created);
            Need(made);
            owner.process = new SafeFileHandle(created.Process, true); owner.thread = new SafeFileHandle(created.Thread, true); owner.pid = created.Pid;
            long exit, kernel, user; Need(GetProcessTimes(owner.process, out owner.birth, out exit, out kernel, out user) && owner.birth > 0);
            owner.Check(); return owner;
        } catch (Exception failure) {
            try { owner.Stop(); owner.Dispose(); } catch { throw owner.Unknown(failure); }
            throw;
        } finally {
            if (initialized) DeleteProcThreadAttributeList(list);
            if (list != IntPtr.Zero) Marshal.FreeHGlobal(list);
            if (jobList != IntPtr.Zero) Marshal.FreeHGlobal(jobList);
            if (desktop != IntPtr.Zero) Marshal.FreeHGlobal(desktop);
            if (environment != IntPtr.Zero) Marshal.FreeHGlobal(environment);
        }
    }
    private void CheckHandles() {
        Need(!closed && process != null && thread != null && job != null);
        foreach (var handle in new[] { process, thread, job }) {
            uint flags; Need(!handle.IsClosed && !handle.IsInvalid && GetHandleInformation(handle, out flags) && (flags & 1) == 0);
        }
        long observed, exit, kernel, user;
        Need(GetProcessId(process) == pid && GetProcessTimes(process, out observed, out exit, out kernel, out user) && observed == birth);
    }
    private void CheckLiveImageAndJob() {
        bool member; Need(IsProcessInJob(process, job, out member) && member);
        var text = new StringBuilder(4096); uint length = (uint)text.Capacity;
        Need(QueryFullProcessImageName(process, 0, text, ref length) && length > 0 && length < text.Capacity && String.Equals(text.ToString(), image, StringComparison.OrdinalIgnoreCase));
    }
    internal void Check() { CheckHandles(); Need(!cleanupUnknown && !stopped && WaitForSingleObject(process, 0) == 0x102); CheckLiveImageAndJob(); Counts(); }
    internal SafeFileHandle OpenRootToken() {
        Check(); SafeFileHandle token = null;
        try { Need(OpenProcessToken(process, 8, out token) && token != null && !token.IsInvalid); return token; }
        catch { if (token != null) token.Dispose(); throw; }
    }
    private Accounting Counts() {
        Accounting counts; Need(QueryInformationJobObject(job, 1, out counts, Marshal.SizeOf(typeof(Accounting)), IntPtr.Zero) &&
            counts.Active <= 64 && counts.Active <= counts.Total); return counts;
    }
    internal Observation GetState() {
        CheckHandles(); uint state = WaitForSingleObject(process, 0); Need(state == 0 || state == 0x102);
        if (state == 0x102) {
            try { CheckLiveImageAndJob(); }
            catch {
                // Image queries can fail while the original process is still
                // completing termination. Wait only for that retained handle;
                // a live, failed or timed-out witness still refuses observation.
                Need(WaitForSingleObject(process, 2000) == 0); state = 0;
            }
        }
        // A live query can race natural termination. Only the original signaled
        // process handle permits the exited branch; no live check is waived.
        state = WaitForSingleObject(process, 0); Need(state == 0 || state == 0x102);
        uint active = Counts().Active; Need(!stopped || (state == 0 && active == 0));
        return new Observation(state == 0x102, active, released, cleanupUnknown, stopped);
    }
    internal void Release() {
        Need(!releaseAttempted); releaseAttempted = true; Check();
        try { Need(ResumeThread(thread) == 1); released = true; GetState(); }
        catch (Exception failure) { throw Unknown(failure); }
    }
    internal void Stop() {
        if (stopped) return;
        if (process == null) {
            if (job != null && !job.IsInvalid && !job.IsClosed) { Need(TerminateJobObject(job, 1)); Need(Counts().Active == 0); }
            stopped = true; return;
        }
        try {
            Need(job != null && !job.IsClosed && !job.IsInvalid && TerminateJobObject(job, 1));
            var watch = Stopwatch.StartNew();
            while (true) {
                uint state = WaitForSingleObject(process, 0); Need(state == 0 || state == 0x102);
                if (state == 0 && Counts().Active == 0) {
                    stopped = true;
#if PROTECTED_GUI_PROCESS_TEST
                    if (FailStopAcknowledgmentForTest) { FailStopAcknowledgmentForTest = false; throw Refused(); }
#endif
                    return;
                }
                Need(watch.ElapsedMilliseconds < 2000); Thread.Sleep(2);
            }
        } catch (Exception failure) { throw Unknown(failure); }
    }
    public void Dispose() {
        if (closed) return; Stop();
        try { CloseOriginal(thread); CloseOriginal(process); CloseOriginal(job); closed = true; }
        catch (Exception failure) { throw Unknown(failure); }
    }
    private static void CloseOriginal(SafeFileHandle handle) {
        if (handle == null || handle.IsClosed || handle.IsInvalid) return;
        Need(CloseHandle(handle.DangerousGetHandle())); handle.SetHandleAsInvalid(); handle.Dispose();
    }
#if PROTECTED_GUI_PROCESS_TEST
    internal static ProtectedGuiProcessNative PrepareForTest(string image, string profile) { return CreateCore(image, null, profile); }
#endif
}
