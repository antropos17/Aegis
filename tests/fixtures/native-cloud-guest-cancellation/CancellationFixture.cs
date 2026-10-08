using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Principal;
using Aegis.ProtectedSession;

internal static class CancellationFixture
{
    [StructLayout(LayoutKind.Sequential)] private struct Basic
    { internal long User, Job; internal uint Flags; internal IntPtr Min, Max; internal uint Active; internal IntPtr Affinity; internal uint Priority, Scheduling; }
    [StructLayout(LayoutKind.Sequential)] private struct Io
    { internal ulong R, W, O, RB, WB, OB; }
    [StructLayout(LayoutKind.Sequential)] private struct Limits
    { internal Basic Basic; internal Io Io; internal IntPtr P, J, PP, PJ; }
    [DllImport("kernel32.dll")] private static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll")] private static extern bool SetInformationJobObject(IntPtr job, int kind, ref Limits limits, int length);
    [DllImport("kernel32.dll")] private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll")] private static extern bool TerminateJobObject(IntPtr job, uint code);
    private static void Need(bool value) { if (!value) throw new InvalidOperationException("cancellation-control-refused"); }
    private static Dictionary<string, object> Positive(bool after)
    {
        var result = new Dictionary<string, object>();
        foreach (string key in new string[] { "runtimeCallerAuthenticated", "runtimeInitializedBeforeProject", "heldIdentityBeforeRelease",
            "cancellationRequested", "cancellationHeldRootAlive", "cleanupJobTerminationAccepted", "privateDesktopHandlesClosedAfterJobClosure", "descendantIdentityVerified" }) result[key] = true;
        result["taskReleased"] = after; result["cancellationReceiverStarted"] = false; return result;
    }
    private static int Pure()
    {
        int passed = 0;
        Need(CloudGuestCancellation.Complete(Positive(false), false, null, true, 137, true, false)); passed++;
        Need(CloudGuestCancellation.Complete(Positive(true), true, null, true, 137, true, true)); passed++;
        foreach (string key in new string[] { "runtimeCallerAuthenticated", "runtimeInitializedBeforeProject", "heldIdentityBeforeRelease",
            "cancellationRequested", "cancellationHeldRootAlive", "cleanupJobTerminationAccepted", "privateDesktopHandlesClosedAfterJobClosure", "descendantIdentityVerified" })
        {
            var record = Positive(true); record[key] = false;
            Need(!CloudGuestCancellation.Complete(record, true, null, true, 137, true, true)); passed++;
            record[key] = "true"; Need(!CloudGuestCancellation.Complete(record, true, null, true, 137, true, true)); passed++;
        }
        Need(!CloudGuestCancellation.Complete(Positive(true), true, null, true, 137, true, false)); passed++;
        Need(!CloudGuestCancellation.Complete(Positive(true), true, null, true, 0, true, true)); passed++;
        Need(!CloudGuestCancellation.Complete(Positive(true), true, null, false, 137, true, true)); passed++;
        Need(!CloudGuestCancellation.Complete(Positive(true), true, null, true, 137, false, true)); passed++;
        Need(!CloudGuestCancellation.Complete(Positive(true), true, "runtime-authenticated-ready", true, 137, true, true)); passed++;
        var wrong = Positive(true); wrong["taskReleased"] = false;
        Need(!CloudGuestCancellation.Complete(wrong, true, null, true, 137, true, true)); passed++;
        wrong = Positive(true); wrong["cancellationReceiverStarted"] = true;
        Need(!CloudGuestCancellation.Complete(wrong, true, null, true, 137, true, true)); passed++;
        var natural = new Dictionary<string, object>();
        Need(!CloudGuestCancellation.Complete(natural, true, "cancellation-live-descendant", true, 125, true, false) && natural["naturalCompletion"].Equals(true)); passed++;
        var unknown = new Dictionary<string, object>();
        Need(!CloudGuestCancellation.Complete(unknown, false, "runtime-authenticated-ready", false, 259, false, false) && unknown["naturalCompletion"] == null); passed++;
        return passed;
    }
    private static void Native(string node, string root, bool after)
    {
        IntPtr job = CreateJobObject(IntPtr.Zero, null); Process child = null; GuestJobInventory inventory = null;
        CloudGuestCancellation.Descendant descendant = null; bool released = false;
        string marker = root + "/released.txt";
        using (var gate = new CloudGuestRuntimeGate(WindowsIdentity.GetCurrent().User.Value))
        {
            try
            {
                Need(job != IntPtr.Zero);
                var limits = new Limits(); limits.Basic.Flags = 0x2000 | 8; limits.Basic.Active = 8;
                Need(SetInformationJobObject(job, 9, ref limits, Marshal.SizeOf(typeof(Limits))));
                var start = new ProcessStartInfo(node, "\"" + root + "/cancellation-client.cjs\" \"" + root + "\"");
                start.UseShellExecute = false; start.CreateNoWindow = true; start.RedirectStandardOutput = true; start.RedirectStandardError = true;
                start.EnvironmentVariables.Clear(); start.EnvironmentVariables["SystemRoot"] = Environment.GetEnvironmentVariable("SystemRoot");
                start.EnvironmentVariables["TEMP"] = root; start.EnvironmentVariables["TMP"] = root;
                start.EnvironmentVariables["NODE_DISABLE_COMPILE_CACHE"] = "1";
                start.EnvironmentVariables["AEGIS_CLOUD_GUEST_TASK"] = "1";
                start.EnvironmentVariables["AEGIS_RUNTIME_PIPE"] = gate.PipeName;
                start.EnvironmentVariables["AEGIS_RUNTIME_SESSION"] = gate.Session;
                start.EnvironmentVariables["AEGIS_RUNTIME_REQUEST"] = gate.Request;
                child = Process.Start(start); Need(AssignProcessToJobObject(job, child.Handle));
                var signal = child.StandardOutput.ReadLineAsync(); Need(signal.Wait(2000) && signal.Result == "fixture-started");
                inventory = new GuestJobInventory(job, child.Handle, new string[] { node, @"C:\Windows\System32\conhost.exe" });
                gate.Attach(child.Handle); gate.ObserveInitialized(); gate.SealInitializedRuntime(inventory); inventory.ValidateInitial();
                if (!after) gate.CheckBeforeCancellation(inventory);
                if (after)
                {
                    gate.ReleaseFixedTask(inventory);
                    released = true;
                    descendant = CloudGuestCancellation.Observe(job, (uint)child.Id, node, WindowsIdentity.GetCurrent().User.Value);
                    descendant.Validate(); Need(!descendant.Exited && System.IO.File.ReadAllText(marker) == "fixed-cancellation-payload");
                    // This actual same-principal fixture does not assert a standard-user token.
                }
                else Need(!System.IO.File.Exists(marker));
                Need(!child.HasExited && TerminateJobObject(job, 137)); Need(child.WaitForExit(2000) && child.ExitCode == 137);
                Need(descendant == null || descendant.Exited); Need(inventory.ConfirmClosure(2000));
                Need(child.StandardError.ReadToEnd().Length == 0);
                if (!after) Need(!System.IO.File.Exists(marker));
                Console.WriteLine(after ? "native-after-ack-live-held-descendant:passed" : "native-before-ack-no-payload:passed");
            }
            finally
            {
                TerminateJobObject(job, 137);
                Console.WriteLine("native-observation:after=" + after + ";release=" + released + ";payload=" + System.IO.File.Exists(marker));
                if (child != null) { Need(child.WaitForExit(2000)); child.Dispose(); }
                if (descendant != null) descendant.Dispose();
                if (inventory != null) inventory.Dispose(); GuestJobNative.CloseHandle(job);
            }
        }
    }
    public static int Main(string[] args)
    {
        try
        {
            Console.WriteLine("pure-cancellation-controls:" + Pure());
            Native(args[0], args[1], false); Native(args[0], args[1], true);
            return 0;
        }
        catch { Console.Error.WriteLine("cancellation-native-controls-refused"); return 1; }
    }
}
