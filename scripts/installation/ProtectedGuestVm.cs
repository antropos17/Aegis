using System;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using Aegis.ProtectedSession;

// Administrative, in-process authority only. Never wired to the caller dispatcher.
public sealed class ProtectedGuestVm : IDisposable
{
    private readonly OwnedVmLifecycle owner;
    private readonly VmManagementNative management;
    public bool PendingUnknown { get { return owner.PendingUnknown; } }
    public uint? ReturnCode { get; private set; }
    public ushort? JobState { get; private set; }
    public ushort? JobError { get; private set; }
    public int? FailureHResult { get { return owner.FailureHResult; } }
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
            owner = new OwnedVmLifecycle(native, 15000); management = native;
        } catch { native.Dispose(); throw; }
    }
    public bool Start() {
        bool result = owner.Start();
        VmOperationRecord operation = owner.LastOperation;
        ReturnCode = operation == null ? null : operation.ReturnCode;
        if (!result && operation != null && operation.JobPath != null) {
            try { VmJobObservation job = management.InspectJob(operation.JobPath); JobState = job.State; JobError = job.ErrorCode; }
            catch { /* An unavailable diagnostic cannot change operation settlement. */ }
        }
        return result;
    }
    public bool Stop() { return owner.Stop(); }
    public bool ObserveOff() { return owner.ObserveOff(); }
    public void Dispose() { owner.Dispose(); }
}
