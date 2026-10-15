using System;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using Aegis.ProtectedSession;

// Administrative, in-process authority only. Never wired to the caller dispatcher.
public sealed class ProtectedGuestVm : IDisposable
{
    private readonly OwnedVmLifecycle owner;
    public bool PendingUnknown { get { return owner.PendingUnknown; } }
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
            owner = new OwnedVmLifecycle(native, 15000);
        } catch { native.Dispose(); throw; }
    }
    public bool Start() { return owner.Start(); }
    public bool Stop() { return owner.Stop(); }
    public bool ObserveOff() { return owner.ObserveOff(); }
    public void Dispose() { owner.Dispose(); }
}
