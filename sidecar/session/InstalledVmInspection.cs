using System;

namespace Aegis.ProtectedSession
{
    // Inspect-owned admission authorizes observations only. No lifecycle method
    // or native manager escapes this retained registration.
    internal sealed class InstalledVmInspection : IDisposable
    {
        private readonly InstalledVmRegistration registration;
        private readonly IVmManagement native;
        private readonly IEnrollmentFiles storageFiles;
        private VmStorageInspection storage;
        private bool closed, refused;
        internal InstalledVmInspection(InstalledVmRegistration record, IVmManagement provider, IEnrollmentFiles files)
        {
            if (record == null || provider == null) throw new InvalidOperationException("installed-vm-manager-unavailable");
            registration = record; native = provider; storageFiles = files;
        }
        internal VmObservation Inspect()
        {
            if (closed || refused) throw new InvalidOperationException("installed-vm-observation-unavailable");
            try
            {
                registration.CheckCurrent();
                if (native.VmId != registration.VmId) throw new InvalidOperationException();
                VmObservation result = native.Inspect();
                registration.CheckObservation(result);
                if (registration.StorageHash != null)
                {
                    if (result.State != 3) throw new InvalidOperationException();
                    if (storage == null) storage = new VmStorageInspection(native as IVmStorageSource, storageFiles);
                    storage.CheckCurrent();
                    if (storage.Digest != registration.StorageHash) throw new InvalidOperationException();
                    VmObservation after = native.Inspect();
                    registration.CheckObservation(after);
                    if (after.State != 3) throw new InvalidOperationException();
                    storage.CheckCurrent();
                }
                registration.CheckCurrent(); return result;
            }
            catch { refused = true; throw new InvalidOperationException("installed-vm-observation-unavailable"); }
        }
        public void Dispose()
        {
            if (closed) return; closed = true;
            try { if (storage != null) storage.Dispose(); }
            finally { try { native.Dispose(); } finally { registration.Dispose(); } }
        }
    }
}
