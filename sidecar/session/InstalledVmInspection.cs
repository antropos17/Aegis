using System;

namespace Aegis.ProtectedSession
{
    // Fixed native failure position only; no paths, provider text or bytes.
    internal sealed class VmInspectionCheckpoint { internal int Code; }
    // Inspect-owned admission authorizes observations only. No lifecycle method
    // or native manager escapes this retained registration.
    internal sealed partial class InstalledVmInspection : IDisposable
    {
        private readonly InstalledVmRegistration registration;
        private readonly IVmManagement native;
        private readonly IEnrollmentFiles storageFiles;
        private VmStorageInspection storage;
        private readonly VmInspectionCheckpoint checkpoint;
        private bool closed, refused;
        internal InstalledVmInspection(InstalledVmRegistration record, IVmManagement provider, IEnrollmentFiles files, VmInspectionCheckpoint diagnostic)
        {
            if (record == null || provider == null) throw new InvalidOperationException("installed-vm-manager-unavailable");
            registration = record; native = provider; storageFiles = files; checkpoint = diagnostic;
        }
        internal VmObservation Inspect()
        {
            if (!registration.IsBound) throw new InvalidOperationException("installed-vm-caller-unavailable");
            return InspectCore();
        }
        internal VmObservation InspectPrepared()
        {
            if (registration.IsBound) throw new InvalidOperationException("installed-vm-caller-unavailable");
            return InspectCore();
        }
        internal void BindCaller(CallerMainOperation.InspectionCompletion admitted) { registration.BindCaller(admitted); }
        internal void CheckCandidateBinding(InstalledOwnerRegistration owner, Guid vmId, string profile, string digest)
        {
            try
            {
                if (closed || refused) throw new InvalidOperationException();
                registration.CheckCandidateBinding(owner, vmId, profile, digest);
                Inspect(); // Original caller-bound registration, fresh VM/configuration/storage observation.
                registration.CheckCandidateBinding(owner, vmId, profile, digest);
            }
            catch { refused = true; throw new InvalidOperationException("installed-vm-candidate-binding-unavailable"); }
        }
#if INSTALLED_VM_TEST
        internal void BindForTest(Action caller) { registration.BindForTest(caller); }
#endif
        private VmObservation InspectCore()
        {
            if (closed || refused) throw new InvalidOperationException("installed-vm-observation-unavailable");
            try
            {
                checkpoint.Code = 1; registration.CheckCurrent();
                if (native.VmId != registration.VmId) throw new InvalidOperationException();
                checkpoint.Code = 2; VmObservation result = native.Inspect();
                checkpoint.Code = 3; registration.CheckObservation(result);
                IVmConfigurationSource configuration = null;
                if (registration.ConfigurationHash != null)
                {
                    checkpoint.Code = 15; configuration = native as IVmConfigurationSource;
                    if (configuration == null || result.State != 3) throw new InvalidOperationException();
                    registration.CheckCurrent(); registration.CheckConfiguration(configuration.ReadConfiguration());
                }
                if (registration.StorageHash != null)
                {
                    checkpoint.Code = 4; if (result.State != 3) throw new InvalidOperationException();
                    if (storage == null) storage = new VmStorageInspection(native as IVmStorageSource, storageFiles, checkpoint);
                    if (registration.PrivateStorage) storage.RequireProtectedStorage(registration.VmId);
                    storage.CheckCurrent();
                    checkpoint.Code = 14; if (storage.Digest != registration.StorageHash) throw new InvalidOperationException();
                    // ReadStorage itself fences the exact captured VM identity
                    // and Off state around its topology query. A second identical
                    // query adds no intervening operation here.
                }
                if (configuration != null)
                {
                    checkpoint.Code = 16; registration.CheckCurrent(); registration.CheckConfiguration(configuration.ReadConfiguration());
                }
                checkpoint.Code = 17; registration.CheckCurrent(); return result;
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
