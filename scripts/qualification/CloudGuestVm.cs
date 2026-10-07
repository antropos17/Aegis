using System;
using System.Collections.Generic;
using System.Management;
using System.Diagnostics;
using Aegis.ProtectedSession;

// Cloud lab only: retain one native lifecycle owner across Setup and guest work.
// The production dispatcher still exposes no launch or VM mutation route.
public sealed class CloudGuestVm : IDisposable
{
    private readonly OwnedVmLifecycle owner;
    public bool PendingUnknown { get { return owner.PendingUnknown; } }
    public string VmId { get { return owner.VmId.ToString("D"); } }
    public Dictionary<string, object> KeyboardObservation { get; private set; }
    private int keyboardCalls;
    private int bootCaptures;
    private bool bootWindowClosed;
    private Stopwatch bootWatch;
    public CloudGuestVm(string id)
    {
        Guard(); Guid parsed;
        if (!Guid.TryParseExact(id, "D", out parsed) || parsed == Guid.Empty) throw new InvalidOperationException("lab-vm-id-invalid");
        owner = OwnedVmLifecycle.ForTrustedFixture(parsed);
    }
    private static void Guard()
    {
        if (Environment.GetEnvironmentVariable("GITHUB_ACTIONS") != "true" ||
            Environment.GetEnvironmentVariable("RUNNER_ENVIRONMENT") != "github-hosted" ||
            Environment.GetEnvironmentVariable("RUNNER_OS") != "Windows") throw new InvalidOperationException("cloud-lab-only");
    }
    public bool Start() { Guard(); bool started = owner.Start(); if (started) bootWatch = Stopwatch.StartNew(); return started; }
    public void CloseBootWindow() { bootWindowClosed = true; }
    private bool WindowOpen(long limit, int count, int cap)
    { return bootWatch != null && !owner.PendingUnknown && CloudGuestBootDiagnostics.WindowAllowed(bootWindowClosed, bootWatch.ElapsedMilliseconds, count, limit, cap); }
    private TimeSpan KeyTimeout()
    {
        if (!WindowOpen(60000, keyboardCalls - 1, 60)) throw new InvalidOperationException("boot-key-window-closed");
        return TimeSpan.FromMilliseconds(Math.Min(5000, 60000 - bootWatch.ElapsedMilliseconds));
    }
    public Dictionary<string, object> BootSnapshot()
    {
        Guard();
        if (!WindowOpen(20000, bootCaptures, 2)) throw new InvalidOperationException("boot-diagnostic-window-closed");
        bootCaptures++;
        var result = CloudGuestBootDiagnostics.Capture(VmId, delegate { return WindowOpen(20000, bootCaptures - 1, 2); });
        result["elapsedMilliseconds"] = bootWatch.ElapsedMilliseconds;
        return result;
    }
    public bool Stop() { Guard(); return owner.Stop(); }
    public bool ObserveOff() { Guard(); return owner.ObserveOff(); }
    public Dictionary<string, object> Operation()
    {
        var value = owner.LastOperation;
        return new Dictionary<string, object> {
            { "vmId", VmId }, { "pendingUnknown", owner.PendingUnknown },
            { "operationId", value == null ? null : value.OperationId.ToString("D") },
            { "requestedState", value == null ? null : (object)value.RequestedState },
            { "returnCode", value == null ? null : (object)value.ReturnCode },
            { "jobPath", value == null ? null : value.JobPath },
            { "unresolved", value != null && value.Unresolved },
            { "failureReason", owner.FailureReason }, { "failureHResult", owner.FailureHResult }
        };
    }
    internal static string KeyboardQuery(string id)
    {
        Guid parsed;
        if (!Guid.TryParseExact(id, "D", out parsed) || parsed == Guid.Empty) throw new InvalidOperationException("keyboard-query-id-invalid");
        return "SELECT * FROM Msvm_Keyboard WHERE SystemName='" + parsed.ToString("D") + "'";
    }
    internal static bool KeyboardIdentity(string id, string creationClass, string systemClass, string systemName)
    {
        return String.Equals(creationClass, "Msvm_Keyboard", StringComparison.Ordinal) &&
            String.Equals(systemClass, "Msvm_ComputerSystem", StringComparison.Ordinal) &&
            String.Equals(systemName, id, StringComparison.OrdinalIgnoreCase);
    }
    internal static bool KeyCompleted(object code)
    {
        uint value = VmManagementNative.UInt32Value(code);
        if (value == 0) return true;
        if (value == 32775) return false; // Documented terminal InvalidState, retry only in fixed window.
        throw new InvalidOperationException("setup-key-return-unconfirmed");
    }
    public bool SetupSpaceKey()
    {
        Guard();
        if (!WindowOpen(60000, keyboardCalls, 60)) throw new InvalidOperationException("boot-key-window-closed");
        KeyboardObservation = new Dictionary<string, object> {
            { "call", ++keyboardCalls }, { "phase", "vm-observe" }, { "count", null }, { "class", "Msvm_Keyboard" },
            { "systemNameMatch", false }, { "vmRunningObserved", false }, { "keyCode", 32U },
            { "returnCode", null }, { "completed", false }, { "hResult", null }, { "managementStatus", null }
        };
        // Fixed key through the exact VM's associated virtual keyboard; no host UI.
        var scope = new ManagementScope(@"\\.\root\virtualization\v2", new ConnectionOptions { Timeout = KeyTimeout() });
        try
        {
        // Verify this exact VM remains Running before every fixed key/retry.
        using (var vm = new ManagementObject(scope, new ManagementPath("Msvm_ComputerSystem.CreationClassName=\"Msvm_ComputerSystem\",Name=\"" + VmId + "\""), new ObjectGetOptions { Timeout = KeyTimeout() }))
        {
            vm.Get(); VmManagementNative.ValidatePath(vm.Path.Path, "Msvm_ComputerSystem");
            if (!String.Equals(vm["Name"] as string, VmId, StringComparison.OrdinalIgnoreCase) || VmManagementNative.UInt16Value(vm["EnabledState"]) != 2) throw new InvalidOperationException("keyboard-owned-vm-not-running");
            KeyboardObservation["vmRunningObserved"] = true;
        }
        KeyboardObservation["phase"] = "query";
        using (var search = new ManagementObjectSearcher(scope, new ObjectQuery(KeyboardQuery(VmId)), new EnumerationOptions { Timeout = KeyTimeout(), ReturnImmediately = true }))
        using (var objects = search.Get())
        {
            KeyboardObservation["count"] = objects.Count;
            if (objects.Count != 1) throw new InvalidOperationException("exact-vm-keyboard-unavailable");
            foreach (ManagementObject keyboard in objects)
            using (keyboard)
            {
                KeyboardObservation["phase"] = "identity";
                VmManagementNative.ValidatePath(keyboard.Path.Path, "Msvm_Keyboard");
                bool matched = KeyboardIdentity(VmId, keyboard["CreationClassName"] as string, keyboard["SystemCreationClassName"] as string, keyboard["SystemName"] as string);
                KeyboardObservation["systemNameMatch"] = matched;
                if (!matched) throw new InvalidOperationException("keyboard-owner-mismatch");
                keyboard.Options.Timeout = KeyTimeout();
                using (var input = keyboard.GetMethodParameters("TypeKey"))
                {
                    if (!WindowOpen(60000, keyboardCalls - 1, 60)) throw new InvalidOperationException("boot-key-window-closed");
                    input["keyCode"] = 32U;
                    KeyboardObservation["phase"] = "invoke";
                    using (var result = keyboard.InvokeMethod("TypeKey", input, new InvokeMethodOptions { Timeout = KeyTimeout() }))
                    {
                        if (result == null) throw new InvalidOperationException("setup-key-result-missing");
                        uint code = VmManagementNative.UInt32Value(result["ReturnValue"]);
                        KeyboardObservation["returnCode"] = code;
                        bool completed = KeyCompleted(code); KeyboardObservation["completed"] = completed;
                        KeyboardObservation["phase"] = completed ? "completed" : "terminal-invalid-state";
                        return completed;
                    }
                }
            }
        }
        }
        catch (Exception error)
        {
            KeyboardObservation["hResult"] = error.HResult;
            var management = error as ManagementException;
            if (management != null) KeyboardObservation["managementStatus"] = (int)management.ErrorCode;
            throw;
        }
        throw new InvalidOperationException("exact-vm-keyboard-unavailable");
    }
    public void Dispose() { owner.Dispose(); }
}
