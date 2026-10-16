using System;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Management;
using System.Text.RegularExpressions;
using Aegis.ProtectedSession;

// Administrative, in-process authority only. Never wired to the caller dispatcher.
public sealed class ProtectedGuestVm : IDisposable
{
    private readonly OwnedVmLifecycle owner;
    private readonly VmManagementNative management;
    private readonly string identity;
    public bool PendingUnknown { get { return owner.PendingUnknown; } }
    public uint? ReturnCode { get; private set; }
    public ushort? JobState { get; private set; }
    public ushort? JobError { get; private set; }
    public int? FailureHResult { get { return owner.FailureHResult; } }
    public string ErrorCodes { get; private set; }
    public ProtectedGuestVm(string id, string expectedIdentity)
    {
        if (!new WindowsPrincipal(WindowsIdentity.GetCurrent()).IsInRole(WindowsBuiltInRole.Administrator))
            throw new InvalidOperationException("protected-guest-administrator-required");
        Guid parsed;
        if (!Guid.TryParseExact(id, "D", out parsed) || parsed == Guid.Empty)
            throw new InvalidOperationException("protected-guest-identity-refused");
        var native = new VmManagementNative(parsed);
        try {
            VmObservation initial = native.Inspect();
            string digest;
            using (var sha = SHA256.Create()) digest = BitConverter.ToString(sha.ComputeHash(
                new UTF8Encoding(false, true).GetBytes(initial.Identity))).Replace("-", "").ToLowerInvariant();
            if (initial.State != 3 || digest != expectedIdentity)
                throw new InvalidOperationException("protected-guest-identity-refused");
            owner = new OwnedVmLifecycle(native, 15000); management = native; identity = initial.Identity;
        } catch { native.Dispose(); throw; }
    }
    public bool Start() {
        bool result = owner.Start();
        VmOperationRecord operation = owner.LastOperation;
        ReturnCode = operation == null ? null : operation.ReturnCode;
        if (!result && operation != null && operation.JobPath != null) {
            try {
                VmJobObservation job = management.InspectJob(operation.JobPath); JobState = job.State; JobError = job.ErrorCode;
                var options = new ObjectGetOptions(); options.Timeout = TimeSpan.FromSeconds(3);
                using (var observed = new ManagementObject(null, VmManagementNative.ValidatePath(operation.JobPath, "Msvm_ConcreteJob"), options)) {
                    observed.Get(); var codes = new StringBuilder();
                    foreach (Match match in Regex.Matches(observed["ErrorDescription"] as string ?? "", "0x[0-9a-fA-F]{8}")) {
                        if (codes.Length >= 88) break;
                        if (codes.Length > 0) codes.Append(','); codes.Append(match.Value.ToLowerInvariant());
                    }
                    ErrorCodes = codes.ToString();
                }
            }
            catch { /* An unavailable diagnostic cannot change operation settlement. */ }
        }
        return result;
    }
    public bool Stop() { return owner.Stop(); }
    public ushort ObserveState() {
        VmObservation observed = management.Inspect();
        if (observed == null || observed.VmId != management.VmId || observed.Identity != identity)
            throw new InvalidOperationException("protected-guest-identity-refused");
        return observed.State;
    }
    public bool ObserveOff() { return owner.ObserveOff(); }
    public void Dispose() { owner.Dispose(); }
}
