using System;
using System.Collections.Generic;
using System.Management;
using Aegis.ProtectedSession;

// Cloud lab only: retain one native lifecycle owner across Setup and guest work.
// The production dispatcher still exposes no launch or VM mutation route.
public sealed class CloudGuestVm : IDisposable
{
    private readonly OwnedVmLifecycle owner;
    public bool PendingUnknown { get { return owner.PendingUnknown; } }
    public string VmId { get { return owner.VmId.ToString("D"); } }
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
    public bool Start() { Guard(); return owner.Start(); }
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
    public void SetupSpaceKey()
    {
        Guard();
        // Fixed key through the exact VM's associated virtual keyboard; no host UI.
        var scope = new ManagementScope(@"\\.\root\virtualization\v2", new ConnectionOptions { Timeout = TimeSpan.FromSeconds(5) });
        string query = "ASSOCIATORS OF {Msvm_ComputerSystem.CreationClassName=\"Msvm_ComputerSystem\",Name=\"" + VmId + "\"} WHERE ResultClass=Msvm_Keyboard";
        using (var search = new ManagementObjectSearcher(scope, new ObjectQuery(query), new EnumerationOptions { Timeout = TimeSpan.FromSeconds(5), ReturnImmediately = false }))
        using (var objects = search.Get())
        {
            if (objects.Count != 1) throw new InvalidOperationException("exact-vm-keyboard-unavailable");
            foreach (ManagementObject keyboard in objects)
            using (keyboard)
            {
                if (!String.Equals(Convert.ToString(keyboard["SystemName"]), VmId, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("keyboard-owner-mismatch");
                using (var input = keyboard.GetMethodParameters("TypeKey"))
                {
                    input["keyCode"] = 32U;
                    using (var result = keyboard.InvokeMethod("TypeKey", input, new InvokeMethodOptions { Timeout = TimeSpan.FromSeconds(5) }))
                        if (result == null || VmManagementNative.UInt32Value(result["ReturnValue"]) != 0) throw new InvalidOperationException("setup-key-not-synchronously-confirmed");
                }
            }
        }
    }
    public void Dispose() { owner.Dispose(); }
}
