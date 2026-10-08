using System;
using System.Diagnostics;
using System.Collections.Generic;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Threading;
using Aegis.ProtectedSession;

internal static class RuntimeGateFixture
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
    private static int passed;
    private static void Require(bool value) { if (!value) throw new InvalidOperationException("fixture-assertion"); }
    private static Process Start(string node, string arguments, CloudGuestRuntimeGate gate, string mode)
    {
        var info = new ProcessStartInfo(node, arguments);
        info.UseShellExecute = false; info.CreateNoWindow = true; info.RedirectStandardOutput = true;
        info.RedirectStandardError = true; info.RedirectStandardInput = true;
        info.EnvironmentVariables["AEGIS_CLOUD_GUEST_TASK"] = "1";
        info.EnvironmentVariables["AEGIS_RUNTIME_PIPE"] = gate.PipeName;
        info.EnvironmentVariables["AEGIS_RUNTIME_SESSION"] = mode == "session" ? Guid.NewGuid().ToString("N") : gate.Session;
        info.EnvironmentVariables["AEGIS_RUNTIME_REQUEST"] = mode == "request" ? Guid.NewGuid().ToString("N") : gate.Request;
        var process = Process.Start(info); IntPtr retained = process.Handle;
        Require(retained != IntPtr.Zero); return process;
    }
    private static void Case(string node, string root, string mode)
    {
        IntPtr job = CreateJobObject(IntPtr.Zero, null);
        Process child = null, sibling = null; GuestJobInventory inventory = null;
        using (var gate = new CloudGuestRuntimeGate(WindowsIdentity.GetCurrent().User.Value))
        {
            bool refused = false, released = false;
            try
            {
                Require(job != IntPtr.Zero);
                var limits = new Limits(); limits.Basic.Flags = 0x2000 | 8; limits.Basic.Active = 8;
                Require(SetInformationJobObject(job, 9, ref limits, Marshal.SizeOf(typeof(Limits))));
                child = Start(node, "\"" + root + "/client-control.cjs\" \"" + root + "/cloud-guest-runtime.cjs\" " + mode, gate, mode);
                Require(AssignProcessToJobObject(job, child.Handle));
                var started = child.StandardOutput.ReadLineAsync();
                Require(started.Wait(2000) && started.Result == "fixture-started");
                inventory = new GuestJobInventory(job, child.Handle, new string[] { node, @"C:\Windows\System32\conhost.exe" });
                if (mode == "sibling")
                {
                    sibling = Start(node, "-e \"setTimeout(()=>{},8000)\"", gate, mode);
                    gate.Attach(sibling.Handle);
                }
                else gate.Attach(child.Handle);
                if (mode == "disposed") gate.Dispose();
                try
                {
                    if (mode == "seal-before-auth") gate.SealInitializedRuntime(inventory);
                    gate.ObserveInitialized();
                    if (mode == "startup-node" || mode == "startup-exited")
                    {
                        sibling = Start(node, mode == "startup-node" ? "-e \"setTimeout(()=>{},8000)\"" : "-e \"process.exit(0)\"", gate, mode);
                        Require(AssignProcessToJobObject(job, sibling.Handle));
                        if (mode == "startup-exited") Require(sibling.WaitForExit(2000));
                    }
                    if (mode == "root-exited") { child.Kill(); Require(child.WaitForExit(2000)); }
                    if (mode != "unsealed") gate.SealInitializedRuntime(inventory);
                    if (mode == "reseal") gate.SealInitializedRuntime(inventory);
                    if (mode == "member")
                    {
                        sibling = Start(node, "-e \"setTimeout(()=>{},8000)\"", gate, mode);
                        Require(AssignProcessToJobObject(job, sibling.Handle));
                    }
                    gate.ReleaseFixedTask(inventory); released = true;
                }
                catch (InvalidOperationException) { refused = true; }
                catch (System.IO.InvalidDataException) { refused = true; }
                if (mode == "valid")
                {
                    Require(released && !refused && child.WaitForExit(3000) && child.ExitCode == 0);
                    Require(child.StandardOutput.ReadToEnd() == "fixed-task-loaded\n");
                }
                else
                {
                    Require(refused && !released);
                    Require(TerminateJobObject(job, 137) && child.WaitForExit(3000));
                    Require(!child.StandardOutput.ReadToEnd().Contains("fixed-task-loaded"));
                }
                Console.WriteLine(mode + ":passed"); passed++;
            }
            finally
            {
                TerminateJobObject(job, 137);
                Require(inventory == null || inventory.ConfirmClosure(2000));
                if (inventory != null) inventory.Dispose();
                if (sibling != null) { if (!sibling.HasExited) sibling.Kill(); sibling.WaitForExit(2000); sibling.Dispose(); }
                if (child != null) child.Dispose();
                GuestJobNative.CloseHandle(job);
            }
        }
    }
    public static int Main(string[] args)
    {
        try
        {
            foreach (string mode in new string[] { "valid", "session", "request", "sibling", "oversize", "extra", "member", "disposed", "seal-before-auth", "startup-node", "startup-exited", "root-exited", "unsealed", "reseal" })
                Case(args[0], args[1], mode);
            var complete = typeof(CloudGuestProcess).GetMethod("CompleteReceipt", BindingFlags.Static | BindingFlags.NonPublic);
            foreach (bool closure in new bool[] { false, true })
            {
                var receipt = new Dictionary<string, object> { { "runtimeResumed", true }, { "taskReleased", false } };
                try { complete.Invoke(null, new object[] { receipt, 259U, false, closure, "runtime-authenticated-ready", (int?)123 }); Require(false); }
                catch (TargetInvocationException error)
                {
                    var preserved = CloudGuestProcess.FailureReceipt(error);
                    Require(preserved != null && (string)preserved["failureStage"] == "runtime-authenticated-ready" &&
                        !(bool)preserved["taskReleased"] && (bool)preserved["runtimeResumed"] &&
                        (bool)preserved["jobClosureConfirmed"] == closure && !(bool)preserved["passed"] &&
                        !(bool)preserved["exitCodeObserved"] && (uint)preserved["exitCode"] == 259);
                }
            }
            Console.WriteLine("pure-failure-receipt-controls:2");
            RuntimeStartupFixture.TokenControls(); RuntimeStartupFixture.Run(args[0], args[1]);
            Console.WriteLine("native-controls:" + passed); return 0;
        }
        catch (Exception error) { Console.WriteLine("fixture-failed:" + error.GetType().Name + ":" + error.HResult + ":" + error.StackTrace); return 1; }
    }
}
