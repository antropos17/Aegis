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
    private static void Require(bool value, string stage)
    { if (!value) throw new InvalidOperationException(stage + ":" + Marshal.GetLastWin32Error()); }
    private static IntPtr OpenHeldToken(IntPtr heldProcess)
    {
        IntPtr token;
        // Framework IsInRole duplicates a primary token into an identification
        // token. Query alone cannot perform that check; no privileges are adjusted.
        Require(OpenProcessToken(heldProcess, 8 | 2, out token), "held-token-open");
        return token;
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
        if (failureStage == null && (!exitObserved || exit != 0)) failureStage = "task-exit";
        if (failureStage == null && !closure) failureStage = "guest-job-closure";
        receipt["exitCode"] = exit; receipt["exitCodeObserved"] = exitObserved;
        receipt["jobClosureConfirmed"] = closure; receipt["failureStage"] = failureStage;
        receipt["failureHResult"] = failureHResult; receipt["passed"] = failureStage == null;
        if (failureStage != null) throw new TaskFailure(receipt);
        return receipt;
    }
    public static Dictionary<string, object> Run(string password, string expectedSid)
    {
        if (Environment.GetEnvironmentVariable("AEGIS_CLOUD_GUEST_LAB") != "trusted-bootstrap-v1" ||
            Environment.GetEnvironmentVariable("GITHUB_ACTIONS") != "true" ||
            Environment.GetEnvironmentVariable("RUNNER_ENVIRONMENT") != "github-hosted" ||
            Environment.GetEnvironmentVariable("RUNNER_OS") != "Windows" ||
            !new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator))
            throw new InvalidOperationException("trusted-guest-bootstrap-required");
        const string trusted = @"C:\ProgramData\AegisCloudLab\trusted";
        const string root = @"C:\AegisLab";
        string image = Path.Combine(trusted, "node.exe"), task = Path.Combine(trusted, "cloud-guest-task.cjs");
        IntPtr job = IntPtr.Zero, token = IntPtr.Zero, environment = IntPtr.Zero;
        ProcessInfo child = new ProcessInfo(); GuestJobInventory inventory = null;
        bool assigned = false, resumed = false, closure = false, exitObserved = false; uint exit = 259;
        string stage = "job-create", failureStage = null; int? failureHResult = null;
        var receipt = new Dictionary<string, object>();
        try
        {
            job = CreateJobObject(IntPtr.Zero, null); Require(job != IntPtr.Zero, "job-create");
            stage = "job-limits";
            var limits = new Limits(); limits.Basic.Flags = 0x2000 | 8; limits.Basic.Active = 16;
            Require(SetInformationJobObject(job, 9, ref limits, Marshal.SizeOf(typeof(Limits))), "job-limits");
            string values = "AEGIS_CLOUD_GUEST_TASK=1\0Path=" + trusted + "\0SystemRoot=C:\\Windows\0TEMP=" + root + "\\scratch\0TMP=" + root + "\\scratch\0USERPROFILE=C:\\Users\\AegisTask\0\0";
            environment = Marshal.StringToHGlobalUni(values);
            var startup = new Startup(); startup.Size = Marshal.SizeOf(typeof(Startup));
            var command = new StringBuilder("\"" + image + "\" \"" + task + "\"");
            stage = "standard-user-create";
            Require(CreateProcessWithLogonW("AegisTask", ".", password, 1, image, command, 0x08000404,
                environment, root + @"\work", ref startup, out child), "standard-user-create");
            stage = "job-assign";
            Require(AssignProcessToJobObject(job, child.Process), "job-assign"); assigned = true;
            stage = "held-token-open";
            token = OpenHeldToken(child.Process);
            using (var identity = new WindowsIdentity(token))
            {
                stage = "held-token-sid";
                Require(identity.User != null && identity.User.Value == expectedSid, "held-token-sid");
                receipt["sid"] = identity.User.Value;
                stage = "held-token-admin";
                Require(!new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator), "held-token-admin");
            }
            stage = "held-token-elevation"; int elevation, returned;
            Require(GetTokenInformation(token, 20, out elevation, 4, out returned) && returned == 4 && elevation == 0, "held-token-elevation");
            receipt["elevated"] = false; receipt["administratorEnabled"] = false;
            stage = "held-image";
            Require(String.Equals(GuestJobNative.Image(child.Process), image, StringComparison.OrdinalIgnoreCase), "held-image");
            stage = "held-birth";
            receipt["pid"] = child.Pid; receipt["birthFileTime"] = GuestJobNative.Birth(child.Process, job, child.Pid);
            stage = "held-job-inventory";
            inventory = new GuestJobInventory(job, child.Process, new string[] { image, @"C:\Windows\System32\conhost.exe" });
            inventory.ValidateInitial(); receipt["initialJobMembers"] = inventory.InitialCount;
            receipt["heldIdentityBeforeRelease"] = true; receipt["atomicJobAtCreation"] = false;
            stage = "task-resume";
            Require(ResumeThread(child.Thread) == 1, "task-resume"); resumed = true;
            stage = "task-deadline";
            Require(GuestJobNative.WaitForSingleObject(child.Process, 60000) == 0, "task-deadline");
            stage = "task-exit-observation";
            Require(GetExitCodeProcess(child.Process, out exit), "task-exit-observation"); exitObserved = true;
        }
        catch (Exception error) { failureStage = stage; failureHResult = error.HResult; }
        finally
        {
            if (job != IntPtr.Zero && assigned)
            {
                try
                {
                    bool terminated = TerminateJobObject(job, 137);
                    closure = terminated && inventory != null && inventory.ConfirmClosure(2000);
                }
                catch (Exception error)
                {
                    closure = false;
                    if (failureStage == null) { failureStage = "guest-job-closure"; failureHResult = error.HResult; }
                }
            }
            else if (child.Process != IntPtr.Zero) TerminateProcess(child.Process, 137);
            receipt["taskReleased"] = resumed; receipt["exitCode"] = exit; receipt["jobClosureConfirmed"] = closure;
            if (inventory != null) inventory.Dispose();
            if (token != IntPtr.Zero) GuestJobNative.CloseHandle(token);
            if (child.Thread != IntPtr.Zero) GuestJobNative.CloseHandle(child.Thread);
            if (child.Process != IntPtr.Zero) GuestJobNative.CloseHandle(child.Process);
            if (job != IntPtr.Zero) GuestJobNative.CloseHandle(job);
            if (environment != IntPtr.Zero) Marshal.FreeHGlobal(environment);
        }
        return CompleteReceipt(receipt, exit, exitObserved, closure, failureStage, failureHResult);
    }
}
