using System;
using System.Collections.Generic;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using Aegis.ProtectedSession;

// Own disposable same-principal suspended processes only. No logon, ACL or VM effects.
internal static class CloudGuestAdmissionCleanupFixture
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct Startup
    {
        internal int Size; internal string Reserved, Desktop, Title;
        internal uint X, Y, XSize, YSize, XChars, YChars, Fill, Flags;
        internal ushort Show, ReservedLength; internal IntPtr ReservedData, Input, Output, Error;
    }
    [StructLayout(LayoutKind.Sequential)] private struct Child
    { internal IntPtr Process, Thread; internal uint Pid, Tid; }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool CreateProcessW(string app,
        StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inherit, uint flags,
        IntPtr environment, string cwd, ref Startup startup, out Child child);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool TerminateJobObject(IntPtr job, uint code);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("advapi32.dll", SetLastError = true)] private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentProcess();
    private static MethodInfo Method(string name) { return typeof(CloudGuestProcess).GetMethod(name, BindingFlags.NonPublic | BindingFlags.Static); }
    private static int checkOrdinal, failedOrdinal;
    private static void Check(bool value) { checkOrdinal++; if (!value) { if (failedOrdinal == 0) failedOrdinal = checkOrdinal; throw new InvalidOperationException("cleanup-fixture-refused"); } }
    private static Child Start()
    {
        string image = Assembly.GetExecutingAssembly().Location;
        var startup = new Startup(); startup.Size = Marshal.SizeOf(typeof(Startup)); Child child;
        Check(CreateProcessW(image, new StringBuilder("\"" + image + "\" --held"), IntPtr.Zero, IntPtr.Zero, false,
            0x08000004, IntPtr.Zero, System.IO.Path.GetDirectoryName(image), ref startup, out child));
        return child;
    }
    private static bool RootExit(IntPtr root, Dictionary<string, object> receipt)
    { return (bool)Method("ObserveRootExit").Invoke(null, new object[] { root, receipt }); }
    private static bool JobClosure(IntPtr job, IntPtr root, Dictionary<string, object> receipt)
    { return (bool)Method("ConfirmEarlyJobClosure").Invoke(null, new object[] { job, root, receipt, 0 }); }
    private static void Close(Child child)
    {
        try
        {
            if (child.Process != IntPtr.Zero)
            {
                try
                {
                    if (GuestJobNative.WaitForSingleObject(child.Process, 0) != 0)
                    {
                        bool accepted = TerminateProcess(child.Process, 137);
                        Check(accepted || GuestJobNative.WaitForSingleObject(child.Process, 1000) == 0);
                    }
                    Check(GuestJobNative.WaitForSingleObject(child.Process, 1000) == 0);
                }
                finally { Check(GuestJobNative.CloseHandle(child.Process)); }
            }
        }
        finally { if (child.Thread != IntPtr.Zero) Check(GuestJobNative.CloseHandle(child.Thread)); }
    }
    private static void Cleanup(Child root, Child other, IntPtr job)
    {
        try { if (job != IntPtr.Zero) Check(TerminateJobObject(job, 137)); }
        finally
        {
            try { Close(root); }
            finally
            {
                try { Close(other); }
                finally { if (job != IntPtr.Zero) Check(GuestJobNative.CloseHandle(job)); }
            }
        }
    }
    private static void NativeErrorAndToken()
    {
        try { Method("OpenHeldToken").Invoke(null, new object[] { IntPtr.Zero }); Check(false); }
        catch (TargetInvocationException error)
        {
            FieldInfo captured = error.InnerException.GetType().GetField("Win32Error", BindingFlags.Instance | BindingFlags.NonPublic);
            Check(captured != null && (int)captured.GetValue(error.InnerException) == 6);
            IntPtr other; Check(OpenProcessToken(GetCurrentProcess(), 8, out other)); Check(GuestJobNative.CloseHandle(other));
            Check((int)captured.GetValue(error.InnerException) == 6); // Later native calls cannot replace the captured failure.
        }
        IntPtr token = (IntPtr)Method("OpenHeldToken").Invoke(null, new object[] { GetCurrentProcess() });
        try {
            using (var identity = new WindowsIdentity(token)) using (var current = WindowsIdentity.GetCurrent())
            { Check(identity.User.Equals(current.User)); Check(new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator) == new WindowsPrincipal(current).IsInRole(WindowsBuiltInRole.Administrator)); }
        } finally { Check(GuestJobNative.CloseHandle(token)); }
    }
    private static void Unassigned()
    {
        Child child = Start();
        try {
            Check(TerminateProcess(child.Process, 137)); var receipt = new Dictionary<string, object>();
            Check(RootExit(child.Process, receipt)); Check((uint)receipt["cleanupRootExitCode"] == 137);
            Check(!receipt.ContainsKey("jobClosureConfirmed"));
            Check((bool)Method("CanReleaseDesktop").Invoke(null, new object[] { false, false, true, child.Process, true }));
            Check(!(bool)Method("CanReleaseDesktop").Invoke(null, new object[] { true, false, true, child.Process, true }));
            Check(!(bool)Method("CanReleaseDesktop").Invoke(null, new object[] { false, false, true, child.Process, false }));
        } finally { Close(child); }
    }
    private static void AssignedWithoutInventory()
    {
        Child child = new Child(); IntPtr job = IntPtr.Zero;
        try {
            child = Start(); job = CreateJobObject(IntPtr.Zero, null); Check(job != IntPtr.Zero);
            Check(AssignProcessToJobObject(job, child.Process)); Check(TerminateJobObject(job, 137));
            var receipt = new Dictionary<string, object>(); Check(RootExit(child.Process, receipt));
            GuestJobInventory absent = null;
            Check(!(true && absent != null && absent.ConfirmClosure(0))); // Exact old finally expression necessarily denies early closure.
            Check(JobClosure(job, child.Process, receipt));
            Check((uint)receipt["cleanupJobActiveBefore"] == 0 && (int)receipt["cleanupJobMemberCount"] == 0 &&
                (uint)receipt["cleanupJobActiveAfter"] == 0 && (bool)receipt["cleanupJobTotalStable"]);
            var unknown = new Dictionary<string, object>(); Check(!JobClosure(IntPtr.Zero, child.Process, unknown));
            Check(unknown.ContainsKey("cleanupQueryFailureStage"));
        } finally { Cleanup(child, new Child(), job); }
    }
    private static void NonemptyAndLive()
    {
        Child root = new Child(), other = new Child(); IntPtr job = IntPtr.Zero;
        try {
            root = Start(); other = Start(); job = CreateJobObject(IntPtr.Zero, null); Check(job != IntPtr.Zero);
            Check(AssignProcessToJobObject(job, root.Process)); Check(AssignProcessToJobObject(job, other.Process));
            Check(!JobClosure(job, root.Process, new Dictionary<string, object>())); // Live root is never settled.
            Check(TerminateProcess(root.Process, 137)); Check(RootExit(root.Process, new Dictionary<string, object>()));
            var receipt = new Dictionary<string, object>(); Check(!JobClosure(job, root.Process, receipt));
            Check(GuestJobNative.WaitForSingleObject(other.Process, 0) == 258 &&
                (uint)receipt["cleanupJobActiveAfter"] > 0 && (int)receipt["cleanupJobMemberCount"] > 0);
        } finally { Cleanup(root, other, job); }
    }
    private sealed class SetupFailure : Exception { }
    private static void InterruptedSetup()
    {
        for (int fault = 1; fault <= 3; fault++)
        {
            Child root = new Child(), other = new Child(); IntPtr job = IntPtr.Zero; bool observed = false;
            try
            {
                root = Start(); if (fault == 1) throw new SetupFailure();
                other = Start(); if (fault == 2) throw new SetupFailure();
                job = CreateJobObject(IntPtr.Zero, null); Check(job != IntPtr.Zero);
                Check(AssignProcessToJobObject(job, root.Process));
                throw new SetupFailure();
            }
            catch (SetupFailure) { observed = true; }
            finally { Cleanup(root, other, job); }
            Check(observed);
        }
    }
    public static int Main(string[] args)
    {
        if (args.Length == 1 && args[0] == "--held") { System.Threading.Thread.Sleep(10000); return 0; }
        if (args.Length != 0) return 2;
        string stage = "token";
        try {
            NativeErrorAndToken(); stage = "unassigned"; Unassigned(); stage = "assigned"; AssignedWithoutInventory(); stage = "nonempty"; NonemptyAndLive();
            stage = "invalid-root";
            var invalid = new Dictionary<string, object>(); Check(!RootExit(IntPtr.Zero, invalid));
            Check((uint)invalid["cleanupRootWaitCode"] == uint.MaxValue && !(bool)invalid["cleanupRootExitObserved"]);
            stage = "interrupted-setup"; InterruptedSetup();
            Console.WriteLine("native-cleanup-controls:11"); return 0;
        } catch (Exception error) { Console.WriteLine("native-cleanup-controls:refused;stage=" + stage + ";check=" + (failedOrdinal == 0 ? checkOrdinal : failedOrdinal) + ";hResult=" + error.HResult); return 1; }
    }
}
