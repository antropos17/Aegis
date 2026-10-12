using System;

namespace Aegis.ProtectedSession
{
    // Inspect-owned admission authorizes observations only. No lifecycle method
    // or native manager escapes this retained registration.
    internal sealed class InstalledVmInspection : IDisposable
    {
        private readonly InstalledVmRegistration registration;
        private readonly IVmManagement native;
        private bool closed, refused;
        internal InstalledVmInspection(InstalledVmRegistration record, IVmManagement provider)
        {
            if (record == null || provider == null) throw new InvalidOperationException("installed-vm-manager-unavailable");
            registration = record; native = provider;
        }
        internal VmObservation Inspect()
        {
            if (closed || refused) throw new InvalidOperationException("installed-vm-observation-unavailable");
            try
            {
                registration.CheckCurrent();
                if (native.VmId != registration.VmId) throw new InvalidOperationException();
                VmObservation result = native.Inspect();
                registration.CheckObservation(result); registration.CheckCurrent(); return result;
            }
            catch { refused = true; throw new InvalidOperationException("installed-vm-observation-unavailable"); }
        }
        public void Dispose()
        {
            if (closed) return; closed = true;
            try { native.Dispose(); } finally { registration.Dispose(); }
        }
    }
}
