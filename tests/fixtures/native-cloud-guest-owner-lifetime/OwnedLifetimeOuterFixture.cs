using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Principal;
using Aegis.ProtectedSession;

// Own disposable local fixture only: real admission pipe and nested Job composition.
internal static class OwnedLifetimeOuterFixture
{
    [StructLayout(LayoutKind.Sequential)] private struct Basic
    { internal long User, Job; internal uint Flags; internal IntPtr Min, Max; internal uint Active; internal IntPtr Affinity; internal uint Priority, Scheduling; }
    [StructLayout(LayoutKind.Sequential)] private struct Io
    { internal ulong R, W, O, RB, WB, OB; }
    [StructLayout(LayoutKind.Sequential)] private struct Limits
    { internal Basic Basic; internal Io Io; internal IntPtr P, J, PP, PJ; }
    [DllImport("kernel32.dll")] private static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll")] private static extern bool SetInformationJobObject(IntPtr job, int kind, ref Limits limits, int size);
    [DllImport("kernel32.dll")] private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll")] private static extern bool TerminateJobObject(IntPtr job, uint code);
    private static void Need(bool value) { if (!value) throw new InvalidOperationException("nested-owner-lifetime-refused"); }
    public static int Main(string[] args)
    {
        IntPtr job = IntPtr.Zero; Process child = null; GuestJobInventory inventory = null;
        var receipt = new Dictionary<string, object>(); bool passed = false;
        try
        {
            string sid = WindowsIdentity.GetCurrent().User.Value;
            using (var gate = new CloudGuestRuntimeGate(sid))
            {
                job = CreateJobObject(IntPtr.Zero, null); Need(job != IntPtr.Zero);
                var limits = new Limits(); limits.Basic.Flags = 0x2000 | 8; limits.Basic.Active = 16;
                Need(SetInformationJobObject(job, 9, ref limits, Marshal.SizeOf(typeof(Limits))));
                var start = new ProcessStartInfo(args[0], "\"" + args[1] + "/owner-lifetime-local-client.cjs\" \"" + args[1] + "/cloud-owner-lifetime-runtime.cjs\"");
                start.UseShellExecute = false; start.CreateNoWindow = true;
                start.RedirectStandardOutput = true; start.RedirectStandardError = true;
                start.EnvironmentVariables.Clear(); start.EnvironmentVariables["SystemRoot"] = Environment.GetEnvironmentVariable("SystemRoot");
                start.EnvironmentVariables["TEMP"] = args[1]; start.EnvironmentVariables["TMP"] = args[1];
                start.EnvironmentVariables["NODE_DISABLE_COMPILE_CACHE"] = "1";
                start.EnvironmentVariables["AEGIS_CLOUD_GUEST_TASK"] = "1";
                start.EnvironmentVariables["AEGIS_OWNER_LIFETIME_EXPECTED_SID"] = sid;
                start.EnvironmentVariables["AEGIS_RUNTIME_PIPE"] = gate.PipeName;
                start.EnvironmentVariables["AEGIS_RUNTIME_SESSION"] = gate.Session;
                start.EnvironmentVariables["AEGIS_RUNTIME_REQUEST"] = gate.Request;
                child = Process.Start(start); IntPtr handle = child.Handle;
                Need(AssignProcessToJobObject(job, handle));
                var started = child.StandardOutput.ReadLineAsync(); Need(started.Wait(2000) && started.Result == "fixture-started");
                inventory = new GuestJobInventory(job, handle, new string[] { args[0], System.IO.Path.Combine(Environment.SystemDirectory, "conhost.exe") });
                long birth = GuestJobNative.Birth(handle, job, (uint)child.Id);
                Need(GuestJobNative.Principal(handle) == sid); receipt["sid"] = sid;
                gate.Attach(handle); gate.ObserveInitialized(); gate.SealInitializedRuntime(inventory);
                inventory.ValidateInitial(); Need(!inventory.ConfirmClosure(0));
                receipt["liveOuterClosureRefused"] = true;
                receipt["heldIdentityBeforeRelease"] = true; receipt["runtimeResumed"] = true;
                receipt["runtimeCallerAuthenticated"] = true; receipt["runtimeInitializedBeforeProject"] = true;
                gate.ReleaseFixedTask(inventory); receipt["taskReleased"] = true;
                Need(child.WaitForExit(14000) && child.ExitCode == 0);
                Need(child.StandardOutput.ReadToEnd().Length == 0 && child.StandardError.ReadToEnd().Length == 0);
                Need(TerminateJobObject(job, 137) && inventory.ConfirmClosure(2000));
                receipt["jobClosureConfirmed"] = true; receipt["exitCodeObserved"] = true; receipt["exitCode"] = 0;
                receipt["pid"] = child.Id; receipt["birthFileTime"] = birth;
                // This same-principal fixture does not create a guest/private desktop or standard account.
                receipt["privateDesktopCreated"] = false; receipt["standardPrincipalVerified"] = false;
                receipt["failureStage"] = null; passed = true;
            }
            return 0;
        }
        catch { Console.Error.WriteLine("nested-owner-lifetime-refused"); return 1; }
        finally
        {
            if (job != IntPtr.Zero) TerminateJobObject(job, 137);
            if (child != null) { if (!child.HasExited) { child.Kill(); child.WaitForExit(2000); } child.Dispose(); }
            if (inventory != null) inventory.Dispose();
            if (job != IntPtr.Zero) GuestJobNative.CloseHandle(job);
            receipt["passed"] = passed;
            Console.WriteLine(new System.Web.Script.Serialization.JavaScriptSerializer().Serialize(receipt));
        }
    }
}
