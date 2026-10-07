using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using Aegis.ProtectedSession;

// Fixed trusted guest lab launcher. Later Job assignment is explicitly non-atomic.
public static class CloudGuestProcess
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct Startup
    {
        public int Size;
        public string Reserved, Desktop, Title;
        public uint X, Y, XSize, YSize, XChars, YChars, Fill, Flags;
        public ushort Show, ReservedLength;
        public IntPtr ReservedData, Input, Output, Error;
    }
    [StructLayout(LayoutKind.Sequential)] private struct ProcessInfo
    { public IntPtr Process, Thread; public uint Pid, Tid; }
    [StructLayout(LayoutKind.Sequential)] private struct BasicLimits
    {
        public long User, Job;
        public uint Flags;
        public IntPtr Minimum, Maximum;
        public uint Active;
        public IntPtr Affinity;
        public uint Priority, Scheduling;
    }
    [StructLayout(LayoutKind.Sequential)] private struct Io
    { public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes; }
    [StructLayout(LayoutKind.Sequential)] private struct Limits
    { public BasicLimits Basic; public Io Io; public IntPtr ProcessMemory, JobMemory, PeakProcess, PeakJob; }
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool CreateProcessWithLogonW(string user, string domain, string password, uint logonFlags,
        string application, StringBuilder command, uint flags, IntPtr environment, string cwd, ref Startup startup, out ProcessInfo process);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool SetInformationJobObject(IntPtr job, int kind, ref Limits limits, int length);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool TerminateJobObject(IntPtr job, uint code);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool GetTokenInformation(IntPtr token, int kind, out int data, int length, out int returned);
    [DllImport("advapi32.dll", SetLastError = true, EntryPoint = "GetTokenInformation")]
    private static extern bool QueryTokenGroups(IntPtr token, int kind, IntPtr data, int length, out int returned);
    [StructLayout(LayoutKind.Sequential)] private struct SidAttributes { internal IntPtr Sid; internal uint Attributes; }
    [StructLayout(LayoutKind.Sequential)] private struct TokenGroups { internal uint Count; internal SidAttributes First; }
    private static void Require(bool value, string stage)
    { if (!value) throw new InvalidOperationException(stage); }
    private sealed class NativeFailure : InvalidOperationException
    {
        internal readonly int Win32Error;
        internal NativeFailure(int error) : base("guest-native-call-refused") { Win32Error = error; }
    }
    private static void RequireNative(bool value)
    { if (!value) throw new NativeFailure(Marshal.GetLastWin32Error()); }
    private static IntPtr OpenHeldToken(IntPtr heldProcess)
    {
        IntPtr token;
        // SID, all group SIDs and elevation need QUERY only. Never use IsInRole
        // on this handle: Framework would request an implicit token duplication.
        RequireNative(OpenProcessToken(heldProcess, 8, out token));
        Require(token != IntPtr.Zero, "held-token-handle");
        return token;
    }
    private static bool HasAnyAdministratorGroup(IntPtr token)
    {
        int needed;
        bool sized = QueryTokenGroups(token, 2, IntPtr.Zero, 0, out needed);
        int error = sized ? 0 : Marshal.GetLastWin32Error();
        if (!sized && error != 122) throw new NativeFailure(error);
        Require(!sized && needed >= 4 && needed <= 65536, "held-token-groups-size");
        IntPtr data = Marshal.AllocHGlobal(needed);
        try
        {
            int returned;
            RequireNative(QueryTokenGroups(token, 2, data, needed, out returned));
            Require(returned >= 4 && returned <= needed, "held-token-groups-size");
            return DecodeAdministratorGroups(data, returned);
        }
        finally { Marshal.FreeHGlobal(data); }
    }
    private static bool DecodeAdministratorGroups(IntPtr data, int length)
    {
        Require(data != IntPtr.Zero && length >= 4 && length <= 65536, "held-token-groups-buffer");
        uint count = unchecked((uint)Marshal.ReadInt32(data));
        int offset = Marshal.OffsetOf(typeof(TokenGroups), "First").ToInt32();
        int stride = Marshal.SizeOf(typeof(SidAttributes));
        Require(count <= 256 && (count == 0 || offset + (long)count * stride <= length), "held-token-groups-count");
        long start = data.ToInt64(), tableEnd = start + offset + (long)count * stride, end = checked(start + length);
        bool administrator = false;
        for (int index = 0; index < count; index++)
        {
            IntPtr sid = Marshal.ReadIntPtr(data, offset + index * stride); long address = sid.ToInt64();
            Require(address >= tableEnd && address <= end - 8, "held-token-group-sid-range");
            int subAuthorities = Marshal.ReadByte(sid, 1), bytes = 8 + subAuthorities * 4;
            Require(Marshal.ReadByte(sid) == 1 && subAuthorities <= 15 && bytes <= end - address, "held-token-group-sid-shape");
            // Scan every valid entry, including disabled and deny-only groups.
            // WindowsIdentity.Groups filters those attributes and cannot prove absence.
            var value = new SecurityIdentifier(sid);
            if (value.IsWellKnown(WellKnownSidType.BuiltinAdministratorsSid)) administrator = true;
        }
        return administrator;
    }
    private sealed class TaskFailure : InvalidOperationException
    {
        internal readonly Dictionary<string, object> Receipt;
        internal TaskFailure(Dictionary<string, object> receipt) : base("cloud-guest-process-refused")
        { Receipt = new Dictionary<string, object>(receipt); }
    }
    // Local exception model only. Never publish a dynamic exception or its InnerException.
    public static Dictionary<string, object> FailureReceipt(Exception exception)
    {
        for (int depth = 0; exception != null && depth < 8; depth++, exception = exception.InnerException)
        {
            var failure = exception as TaskFailure;
            if (failure != null) return new Dictionary<string, object>(failure.Receipt);
        }
        return null;
    }
    private static Dictionary<string, object> CompleteReceipt(Dictionary<string, object> receipt,
        uint exit, bool exitObserved, bool closure, string failureStage, int? failureHResult)
    {
        if (failureStage == null)
            foreach (string field in new string[] { "runtimeResumed", "runtimeCallerAuthenticated", "runtimeInitializedBeforeProject", "taskReleased", "networkReceiverStartedAfterRuntimeReady", "ownerNodeVersionPassed", "privateDesktopCreated", "privateDesktopParentRestored", "privateDesktopHandlesClosedAfterJobClosure" })
            {
                object value;
                if (!receipt.TryGetValue(field, out value) || !(value is bool) || !(bool)value) { failureStage = "runtime-release-unconfirmed"; break; }
            }
        if (failureStage == null && (!exitObserved || exit != 0)) failureStage = "task-exit";
        if (failureStage == null && !closure) failureStage = "guest-job-closure";
        receipt["exitCode"] = exit; receipt["exitCodeObserved"] = exitObserved;
        receipt["jobClosureConfirmed"] = closure; receipt["failureStage"] = failureStage;
        receipt["failureHResult"] = failureHResult; receipt["passed"] = failureStage == null;
        if (failureStage != null) throw new TaskFailure(receipt);
        return receipt;
    }
    public static Dictionary<string, object> Run(string password, string expectedSid)
    { return RunFixed(password, expectedSid, false); }
    public static Dictionary<string, object> RunClaude(string password, string expectedSid)
    { return RunFixed(password, expectedSid, true); }
    private static Dictionary<string, object> RunFixed(string password, string expectedSid, bool claude)
    {
        if (Environment.GetEnvironmentVariable("AEGIS_CLOUD_GUEST_LAB") != "trusted-bootstrap-v1" ||
            Environment.GetEnvironmentVariable("GITHUB_ACTIONS") != "true" ||
            Environment.GetEnvironmentVariable("RUNNER_ENVIRONMENT") != "github-hosted" ||
            Environment.GetEnvironmentVariable("RUNNER_OS") != "Windows" ||
            !new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator))
            throw new InvalidOperationException("trusted-guest-bootstrap-required");
        const string trusted = @"C:\ProgramData\AegisCloudLab\trusted";
        const string root = @"C:\AegisLab";
        string image = Path.Combine(trusted, "node.exe"), task = Path.Combine(trusted, claude ? "claude-runtime.cjs" : "cloud-guest-runtime.cjs");
        IntPtr job = IntPtr.Zero, token = IntPtr.Zero, environment = IntPtr.Zero;
        ProcessInfo child = new ProcessInfo(); GuestJobInventory inventory = null; CloudGuestRuntimeGate runtime = null;
        CloudGuestNetwork receiver = null;
        CloudGuestClaudeReceiver claudeReceiver = null;
        CloudGuestDesktop desktopOwner = null;
        bool created = false, assigned = false, resumed = false, taskReleased = false, closure = false, exitObserved = false, unassignedRootExitObserved = false; uint exit = 259;
        string stage = "job-create", failureStage = null; int? failureHResult = null;
        var receipt = new Dictionary<string, object>();
        receipt["processCreated"] = false; receipt["jobAssignedBeforeAdmission"] = false; receipt["tokenOpened"] = false;
        receipt["heldProcessHandlePresent"] = false; receipt["heldThreadHandlePresent"] = false; receipt["failureWin32Error"] = null;
        try
        {
            stage = "owner-node-version-positive";
            try
            {
                using (var owner = WindowsIdentity.GetCurrent()) receipt["ownerImpersonationLevel"] = owner.ImpersonationLevel.ToString();
                using (var thread = WindowsIdentity.GetCurrent(true)) receipt["ownerThreadImpersonating"] = thread != null;
            }
            catch { receipt["ownerImpersonationLevel"] = "unknown"; receipt["ownerThreadImpersonating"] = null; }
            CloudGuestDesktop.ProbeOwnerNode(receipt);
            stage = "private-desktop-create";
            desktopOwner = new CloudGuestDesktop(expectedSid);
            receipt["privateDesktopCreated"] = true;
            receipt["privateDesktopParentRestored"] = desktopOwner.Restored;
            stage = "job-create";
            job = CreateJobObject(IntPtr.Zero, null); RequireNative(job != IntPtr.Zero);
            stage = "job-limits";
            var limits = new Limits(); limits.Basic.Flags = 0x2000 | 8; limits.Basic.Active = 16;
            RequireNative(SetInformationJobObject(job, 9, ref limits, Marshal.SizeOf(typeof(Limits))));
            stage = "runtime-endpoint-create";
            runtime = new CloudGuestRuntimeGate(expectedSid);
            string values = (claude ? "AEGIS_CLOUD_GUEST_CLAUDE=1\0" : "") + "AEGIS_CLOUD_GUEST_TASK=1\0AEGIS_RUNTIME_PIPE=" + runtime.PipeName + "\0AEGIS_RUNTIME_REQUEST=" + runtime.Request + "\0AEGIS_RUNTIME_SESSION=" + runtime.Session + "\0Path=" + trusted + "\0SystemRoot=C:\\Windows\0TEMP=" + root + "\\scratch\0TMP=" + root + "\\scratch\0USERPROFILE=C:\\Users\\AegisTask\0\0";
            environment = Marshal.StringToHGlobalUni(values);
            var startup = new Startup(); startup.Size = Marshal.SizeOf(typeof(Startup));
            startup.Desktop = desktopOwner.Path;
            var command = new StringBuilder("\"" + image + "\" \"" + task + "\"");
            stage = "standard-user-create";
            RequireNative(CreateProcessWithLogonW("AegisTask", ".", password, 1, image, command, 0x08000404,
                environment, root + @"\work", ref startup, out child));
            created = true;
            receipt["processCreated"] = true; receipt["createdProcessId"] = child.Pid; receipt["createdThreadId"] = child.Tid;
            receipt["heldProcessHandlePresent"] = child.Process != IntPtr.Zero; receipt["heldThreadHandlePresent"] = child.Thread != IntPtr.Zero;
            Require(child.Process != IntPtr.Zero && child.Thread != IntPtr.Zero && child.Pid != 0 && child.Tid != 0, "created-handles-refused");
            stage = "job-assign";
            RequireNative(AssignProcessToJobObject(job, child.Process)); assigned = true;
            receipt["jobAssignedBeforeAdmission"] = true;
            stage = "held-token-open";
            receipt["tokenRequestedAccess"] = 8;
            token = OpenHeldToken(child.Process);
            receipt["tokenOpened"] = true;
            stage = "held-token-identity";
            using (var identity = new WindowsIdentity(token))
            {
                stage = "held-token-sid";
                Require(identity.User != null && identity.User.Value == expectedSid, "held-token-sid");
                receipt["sid"] = identity.User.Value;
                stage = "held-token-admin";
                Require(!HasAnyAdministratorGroup(token), "held-token-admin");
                receipt["administratorGroupPresent"] = false;
                receipt["administratorGroupScan"] = "all-attributes";
            }
            stage = "held-token-elevation"; int elevation, returned;
            RequireNative(GetTokenInformation(token, 20, out elevation, 4, out returned));
            Require(returned == 4 && elevation == 0, "held-token-elevation");
            receipt["elevated"] = false; receipt["administratorEnabled"] = false;
            stage = "held-image";
            Require(String.Equals(GuestJobNative.Image(child.Process), image, StringComparison.OrdinalIgnoreCase), "held-image");
            stage = "held-birth";
            receipt["pid"] = child.Pid; receipt["birthFileTime"] = GuestJobNative.Birth(child.Process, job, child.Pid);
            stage = "held-job-inventory";
            inventory = new GuestJobInventory(job, child.Process, new string[] { image, @"C:\Windows\System32\conhost.exe" });
            inventory.ValidateInitial(); receipt["initialJobMembers"] = inventory.InitialCount;
            receipt["heldIdentityBeforeRelease"] = true; receipt["atomicJobAtCreation"] = false;
            stage = "runtime-registration";
            runtime.Attach(child.Process);
            stage = "runtime-resume";
            uint suspendCount = ResumeThread(child.Thread); RequireNative(suspendCount != uint.MaxValue);
            Require(suspendCount == 1, "task-resume"); resumed = true;
            receipt["runtimeResumed"] = true;
            stage = "runtime-authenticated-ready";
            runtime.ObserveInitialized();
            receipt["runtimeCallerAuthenticated"] = true;
            stage = "runtime-held-job-recheck";
            inventory.ValidateInitial();
            Require(String.Equals(GuestJobNative.Image(child.Process), image, StringComparison.OrdinalIgnoreCase), "runtime-held-image");
            Require(GuestJobNative.Birth(child.Process, job, child.Pid) == (long)receipt["birthFileTime"], "runtime-held-birth");
            receipt["runtimeInitializedBeforeProject"] = true;
            receipt["clientServerAttestationQualified"] = false;
            if (claude)
            {
                stage = "claude-receiver-start";
                claudeReceiver = new CloudGuestClaudeReceiver(job, receipt);
                receipt["claudeReceiverStartedAfterRuntimeReady"] = true;
                claudeReceiver.BeforeRelease();
                receipt["claudeDescendantCallerAuthenticated"] = false;
                receipt["trustedTestProcessObservation"] = "unknown";
                receipt["acceptancePassed"] = false;
            }
            else
            {
                stage = "network-receiver-start";
                receiver = new CloudGuestNetwork(job, receipt);
                receipt["networkReceiverStartedAfterRuntimeReady"] = true;
                receiver.BeforeRelease();
            }
            stage = "project-release-ack";
            runtime.ReleaseFixedTask(inventory); taskReleased = true;
            stage = "task-deadline";
            uint waitBudget = claude ? claudeReceiver.RemainingTaskWait() : 60000;
            receipt["taskWaitMilliseconds"] = waitBudget;
            Require(GuestJobNative.WaitForSingleObject(child.Process, waitBudget) == 0, "task-deadline");
            stage = "task-exit-observation";
            RequireNative(GetExitCodeProcess(child.Process, out exit)); exitObserved = true;
        }
        catch (Exception error)
        {
            failureStage = stage; failureHResult = error.HResult;
            var native = error as NativeFailure;
            receipt["failureWin32Error"] = native == null ? (object)null : native.Win32Error;
            if (created && child.Process != IntPtr.Zero)
            {
                uint wait = GuestJobNative.WaitForSingleObject(child.Process, 0);
                int? waitError = wait == uint.MaxValue ? (int?)Marshal.GetLastWin32Error() : null;
                receipt["failureHeldProcessWaitCode"] = wait; receipt["failureHeldProcessWaitWin32Error"] = waitError;
                receipt["failureHeldProcessExited"] = wait == 0 ? (object)true : (wait == 0x102 ? (object)false : null);
            }
        }
        finally
        {
            if (job != IntPtr.Zero && assigned)
            {
                try
                {
                    bool terminated = TerminateJobObject(job, 137);
                    int? terminationError = terminated ? null : (int?)Marshal.GetLastWin32Error();
                    receipt["cleanupJobTerminationAccepted"] = terminated;
                    receipt["cleanupWin32Error"] = terminationError;
                    closure = terminated && ObserveRootExit(child.Process, receipt) &&
                        (inventory != null ? inventory.ConfirmClosure(2000) : ConfirmEarlyJobClosure(job, child.Process, receipt, 2000));
                }
                catch (Exception error)
                {
                    closure = false;
                    if (failureStage == null) { failureStage = "guest-job-closure"; failureHResult = error.HResult; }
                }
            }
            else if (created && child.Process != IntPtr.Zero)
            {
                bool terminated = TerminateProcess(child.Process, 137);
                int? terminationError = terminated ? null : (int?)Marshal.GetLastWin32Error();
                receipt["cleanupRootTerminationAccepted"] = terminated;
                receipt["cleanupWin32Error"] = terminationError;
                unassignedRootExitObserved = ObserveRootExit(child.Process, receipt); // No Job closure claim for an unassigned process.
            }
            if (receiver != null)
            {
                try { receiver.Finish(closure); }
                catch (Exception error) { if (failureStage == null) { failureStage = "network-receiver-cleanup"; failureHResult = error.HResult; } }
                finally { receiver.Dispose(); }
                if (receipt["networkReceiverDisposalUnknown"].Equals(true) && failureStage == null) failureStage = "network-receiver-cleanup";
            }
            if (claudeReceiver != null)
            {
                try { claudeReceiver.Finish(closure); }
                catch (Exception error) { if (failureStage == null) { failureStage = "claude-receiver-cleanup"; failureHResult = error.HResult; } }
                finally { claudeReceiver.Dispose(); }
                if (receipt["claudeReceiverDisposalUnknown"].Equals(true) && failureStage == null) failureStage = "claude-receiver-cleanup";
            }
            receipt["taskReleased"] = taskReleased; receipt["runtimeResumed"] = resumed; receipt["exitCode"] = exit; receipt["jobClosureConfirmed"] = closure;
            if (runtime != null) runtime.Dispose();
            receipt["privateDesktopHandlesClosedAfterJobClosure"] = false;
            receipt["privateDesktopHandlesClosedAfterUnassignedRootExit"] = false;
            if (desktopOwner != null && CanReleaseDesktop(assigned, closure, created, child.Process, unassignedRootExitObserved))
            {
                desktopOwner.Dispose();
                receipt["privateDesktopHandlesClosedAfterJobClosure"] = closure && desktopOwner.Closed;
                receipt["privateDesktopHandlesClosedAfterUnassignedRootExit"] = !assigned && created && unassignedRootExitObserved && desktopOwner.Closed;
                if (!desktopOwner.Closed && failureStage == null) failureStage = "private-desktop-close";
            }
            if (inventory != null) inventory.Dispose();
            if (token != IntPtr.Zero) GuestJobNative.CloseHandle(token);
            if (created && child.Thread != IntPtr.Zero) GuestJobNative.CloseHandle(child.Thread);
            if (created && child.Process != IntPtr.Zero) GuestJobNative.CloseHandle(child.Process);
            if (job != IntPtr.Zero) GuestJobNative.CloseHandle(job);
            if (environment != IntPtr.Zero) Marshal.FreeHGlobal(environment);
        }
        return claude ? CompleteClaudeReceipt(receipt, exit, exitObserved, closure, failureStage, failureHResult) :
            CompleteReceipt(receipt, exit, exitObserved, closure, failureStage, failureHResult);
    }
    private static Dictionary<string, object> CompleteClaudeReceipt(Dictionary<string, object> receipt,
        uint exit, bool exitObserved, bool closure, string failureStage, int? failureHResult)
    {
        if (failureStage == null)
            foreach (string field in new string[] { "runtimeResumed", "runtimeCallerAuthenticated", "runtimeInitializedBeforeProject", "taskReleased", "claudeReceiverStartedAfterRuntimeReady", "claudeReceiverExitObserved", "claudeReceiverStoppedAfterJobClosure", "claudeReceiverResultWritten", "ownerNodeVersionPassed", "privateDesktopCreated", "privateDesktopParentRestored", "privateDesktopHandlesClosedAfterJobClosure" })
            {
                object value;
                if (!receipt.TryGetValue(field, out value) || !(value is bool) || !(bool)value) { failureStage = "claude-runtime-release-unconfirmed"; break; }
            }
        if (failureStage == null && (!exitObserved || exit != 0)) failureStage = "claude-task-exit";
        if (failureStage == null && !closure) failureStage = "guest-job-closure";
        receipt["exitCode"] = exit; receipt["exitCodeObserved"] = exitObserved; receipt["jobClosureConfirmed"] = closure;
        receipt["failureStage"] = failureStage; receipt["failureHResult"] = failureHResult; receipt["passed"] = failureStage == null;
        receipt["acceptancePassed"] = false; receipt["trustedTestProcessObservation"] = "unknown";
        if (failureStage != null) throw new TaskFailure(receipt);
        return receipt;
    }
    private static bool CanReleaseDesktop(bool assigned, bool closure, bool created, IntPtr heldRoot, bool rootExitObserved)
    { return heldRoot == IntPtr.Zero || (assigned && closure) || (!assigned && created && rootExitObserved); }
    private static bool ObserveRootExit(IntPtr heldRoot, Dictionary<string, object> receipt)
    {
        uint wait = GuestJobNative.WaitForSingleObject(heldRoot, 2000);
        int? waitError = wait == uint.MaxValue ? (int?)Marshal.GetLastWin32Error() : null;
        receipt["cleanupRootWaitCode"] = wait; receipt["cleanupRootWaitWin32Error"] = waitError;
        uint exit = 259; bool observed = wait == 0 && GetExitCodeProcess(heldRoot, out exit);
        int? exitError = wait == 0 && !observed ? (int?)Marshal.GetLastWin32Error() : null;
        receipt["cleanupRootExitObserved"] = observed; receipt["cleanupRootExitWin32Error"] = exitError;
        if (observed) receipt["cleanupRootExitCode"] = exit;
        return observed;
    }
    // Cleanup witness only: never supplies initial inventory, identity or release authority.
    private static bool ConfirmEarlyJobClosure(IntPtr heldJob, IntPtr heldRoot, Dictionary<string, object> receipt, int timeout)
    {
        Require(timeout >= 0 && timeout <= 2000, "cleanup-budget-refused");
        receipt["cleanupBeforeInventory"] = true;
        // NULL queries the caller's Job, not this owned child's Job. Never fall back to it.
        if (heldJob == IntPtr.Zero || heldJob == new IntPtr(-1) || heldRoot == IntPtr.Zero || heldRoot == new IntPtr(-1))
        { receipt["cleanupQueryFailureStage"] = "held-handles"; receipt["cleanupQueryFailureHResult"] = null; return false; }
        var watch = System.Diagnostics.Stopwatch.StartNew(); string phase = "root-wait";
        do
        {
            try
            {
                if (GuestJobNative.WaitForSingleObject(heldRoot, 0) != 0) return false;
                phase = "job-count-before"; var before = GuestJobNative.Counts(heldJob);
                phase = "job-members"; uint[] members = GuestJobNative.Members(heldJob);
                phase = "job-count-after"; var after = GuestJobNative.Counts(heldJob);
                receipt["cleanupJobActiveBefore"] = before.Active; receipt["cleanupJobMemberCount"] = members.Length;
                receipt["cleanupJobActiveAfter"] = after.Active; receipt["cleanupJobTotalStable"] = before.Total == after.Total;
                if (before.Active == 0 && members.Length == 0 && after.Active == 0 && before.Total == after.Total &&
                    GuestJobNative.WaitForSingleObject(heldRoot, 0) == 0) return true;
            }
            catch (Exception error)
            { receipt["cleanupQueryFailureStage"] = phase; receipt["cleanupQueryFailureHResult"] = error.HResult; return false; }
            if (watch.ElapsedMilliseconds >= timeout) break;
            System.Threading.Thread.Sleep(10);
        } while (true);
        return false;
    }
}
