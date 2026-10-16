using System;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;

namespace Aegis.ProtectedSession
{
    // A fixed protected record supplies the VM selection; no caller-supplied GUID,
    // root or record is accepted by the installed-owner factory.
    internal sealed partial class InstalledVmRegistration : IDisposable
    {
        private const string Leaf = "registered-vm.json";
        private static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);
        private const string Prefix =
            "\\A\\{\"schemaVersion\":1,\"installId\":\"([a-f0-9]{32})\",\"revision\":([1-9][0-9]{0,9})," +
            "\"epoch\":\"([a-f0-9]{32})\",\"policySha256\":\"([a-f0-9]{64})\"," +
            "\"selectionId\":\"([a-f0-9]{32})\",\"selectionEpoch\":\"([a-f0-9]{32})\",";
        private static readonly Regex Schema = new Regex(Prefix +
            "\"vmId\":\"([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\"," +
            "\"identitySha256\":\"([a-f0-9]{64})\",\"status\":\"active\"\\}\\z",
            RegexOptions.CultureInvariant);
        private static readonly Regex Unconfigured = new Regex(Prefix + "\"status\":\"unconfigured\"\\}\\z", RegexOptions.CultureInvariant);
        private static readonly Regex StorageSchema = new Regex(Prefix.Replace("schemaVersion\":1", "schemaVersion\":2") +
            "\"vmId\":\"([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\"," +
            "\"identitySha256\":\"([a-f0-9]{64})\",\"storageSha256\":\"([a-f0-9]{64})\",\"status\":\"active\"\\}\\z",
            RegexOptions.CultureInvariant);
        private static readonly Regex ProtectedStorageSchema = new Regex(StorageSchema.ToString()
            .Replace("schemaVersion\":2", "schemaVersion\":3")
            .Replace("\"status\":\"active\"", "\"storageProtection\":\"private-vm\",\"status\":\"active\""), RegexOptions.CultureInvariant);
        private static readonly Regex ConfigurationSchema = new Regex(ProtectedStorageSchema.ToString()
            .Replace("schemaVersion\":3", "schemaVersion\":4")
            .Replace("\"status\":\"active\"", "\"configurationProfile\":\"(aegis-offline-fixed-v1)\",\"configurationSha256\":\"([a-f0-9]{64})\",\"status\":\"active\""), RegexOptions.CultureInvariant);
        private readonly Action checkAuthority;
        private Action checkCaller;
        private readonly InstalledOwnerRegistration installed;
        private readonly bool mustBindCaller;
        internal CallerMainOperation.InspectionCompletion JournalCaller { get; private set; }
        internal bool IsBound { get { return !mustBindCaller || checkCaller != null; } }
        private readonly EnrollmentHeld held;
        private readonly byte[] original;
        private bool closed, refused;
        internal readonly Guid VmId;
        private readonly string identityHash;
        internal readonly string StorageHash;
        internal readonly bool PrivateStorage;
        internal readonly string ConfigurationProfile, ConfigurationHash;
        private readonly bool configured;

        private InstalledVmRegistration(string root, string installId, uint revision, string epoch,
            string digest, string selection, string selectionEpoch, Action authority, IEnrollmentFiles files,
            InstalledOwnerRegistration owner = null, bool requiresCaller = false)
        {
            checkAuthority = authority; installed = owner; mustBindCaller = owner != null || requiresCaller;
            try
            {
                if (authority == null || files == null) throw new InvalidDataException();
                authority();
                string path = Path.Combine(root, Leaf);
                held = files.Open(path, false);
                EnrollmentInspection.Check(held, path, false, false);
                original = held.Read(4096);
                Match record = Schema.Match(Utf8.GetString(original));
                if (!record.Success) record = StorageSchema.Match(Utf8.GetString(original));
                if (!record.Success) { record = ProtectedStorageSchema.Match(Utf8.GetString(original)); PrivateStorage = record.Success; }
                if (!record.Success) { record = ConfigurationSchema.Match(Utf8.GetString(original)); PrivateStorage = record.Success; }
                configured = record.Success;
                if (!configured) record = Unconfigured.Match(Utf8.GetString(original));
                uint recordedRevision;
                if (!record.Success || !UInt32.TryParse(record.Groups[2].Value, out recordedRevision) ||
                    recordedRevision != revision || record.Groups[1].Value != installId ||
                    record.Groups[3].Value != epoch || record.Groups[4].Value != digest ||
                    record.Groups[5].Value != selection || record.Groups[6].Value != selectionEpoch)
                    throw new InvalidDataException();
                if (configured)
                {
                    if (!Guid.TryParseExact(record.Groups[7].Value, "D", out VmId) || VmId == Guid.Empty) throw new InvalidDataException();
                    identityHash = record.Groups[8].Value;
                    if (record.Groups.Count >= 10) StorageHash = record.Groups[9].Value;
                    if (record.Groups.Count == 12)
                    { ConfigurationProfile = record.Groups[10].Value; ConfigurationHash = record.Groups[11].Value; }
                }
                CheckCurrent();
            }
            catch { Dispose(); throw new InvalidOperationException("installed-vm-registration-unavailable"); }
        }

        internal static InstalledVmInspection AcquireInspection(InstalledOwnerRegistration owner,
            CallerMainOperation.Context admitted)
        { return AcquireCore(owner, admitted, false); }
        private static InstalledVmInspection AcquireCore(InstalledOwnerRegistration owner,
            CallerMainOperation.Context admitted, bool allowUnconfigured, VmInspectionCheckpoint checkpoint = null)
        {
            if (owner == null || admitted == null) throw new InvalidOperationException("installed-vm-registration-unavailable");
            InstalledOwnerPolicy policy = owner.Policy;
            Action authority = delegate { owner.CheckCurrent(); admitted.CheckInstalledOwner(owner); };
            checkpoint = checkpoint ?? new VmInspectionCheckpoint(); checkpoint.Code = 18;
            var registration = new InstalledVmRegistration(InstalledOwnerPolicy.Root, policy.InstallId,
                policy.Revision, policy.Epoch, policy.Digest, policy.SelectionId, policy.SelectionEpoch,
                authority, new EnrollmentNative());
            return CreateInspection(registration, delegate(Guid id) { return new VmManagementNative(id); }, allowUnconfigured, null, checkpoint);
        }

        internal static InstalledVmInspection PrepareIfConfigured(InstalledOwnerRegistration owner,
            VmInspectionCheckpoint checkpoint)
        {
            if (checkpoint != null) checkpoint.Code = 20;
            if (owner == null) throw new InvalidOperationException("installed-vm-registration-unavailable");
            owner.CheckCurrent();
            try { System.IO.File.GetAttributes(Path.Combine(InstalledOwnerPolicy.Root, Leaf)); }
            catch (FileNotFoundException) { owner.CheckCurrent(); return null; }
            InstalledOwnerPolicy policy = owner.Policy;
            checkpoint.Code = 18;
            var registration = new InstalledVmRegistration(InstalledOwnerPolicy.Root, policy.InstallId,
                policy.Revision, policy.Epoch, policy.Digest, policy.SelectionId, policy.SelectionEpoch,
                owner.CheckCurrent, new EnrollmentNative(), owner);
            return CreateInspection(registration, delegate(Guid id) { return new VmManagementNative(id); }, true, null, checkpoint, true);
        }

        private static InstalledVmInspection CreateInspection(InstalledVmRegistration registration,
            Func<Guid, IVmManagement> create, bool allowUnconfigured = false, IEnrollmentFiles storageFiles = null, VmInspectionCheckpoint checkpoint = null, bool prepared = false)
        {
            IVmManagement native = null; InstalledVmInspection bound = null;
            try
            {
                registration.CheckCurrent();
                if (!registration.configured)
                {
                    if (!allowUnconfigured) throw new InvalidOperationException("installed-vm-registration-unconfigured");
                    registration.Dispose(); return null;
                }
                if (checkpoint != null) checkpoint.Code = 19;
                native = create(registration.VmId);
                bound = new InstalledVmInspection(registration, native, storageFiles ?? new EnrollmentNative(), checkpoint ?? new VmInspectionCheckpoint());
                if (prepared) bound.InspectPrepared(); else bound.Inspect();
                return bound;
            }
            catch
            {
                if (bound != null) bound.Dispose();
                else try { if (native != null) native.Dispose(); } finally { registration.Dispose(); }
                throw;
            }
        }

        internal void CheckCurrent()
        {
            if (closed || refused) throw new InvalidOperationException("installed-vm-registration-unavailable");
            byte[] bytes = null;
            try
            {
                checkAuthority(); if (checkCaller != null) checkCaller(); held.Recheck(false); bytes = held.Read(4096);
                if (bytes.Length != original.Length) throw new InvalidDataException();
                for (int index = 0; index < bytes.Length; index++)
                    if (bytes[index] != original[index]) throw new InvalidDataException();
                checkAuthority(); if (checkCaller != null) checkCaller();
            }
            catch { refused = true; throw new InvalidOperationException("installed-vm-registration-unavailable"); }
            finally { if (bytes != null) Array.Clear(bytes, 0, bytes.Length); }
        }

        internal void CheckObservation(VmObservation observation)
        {
            CheckCurrent();
            if (observation == null || observation.VmId != VmId || String.IsNullOrEmpty(observation.Identity) ||
                observation.Identity.Length > 2048 || EnrollmentInspection.ImageHash(Utf8.GetBytes(observation.Identity)) != identityHash)
            {
                refused = true; throw new InvalidOperationException("installed-vm-identity-unavailable");
            }
        }

        internal void CheckConfiguration(VmConfigurationObservation observation)
        {
            CheckCurrent();
            if (observation == null || observation.VmId != VmId || String.IsNullOrEmpty(observation.Identity) ||
                observation.Identity.Length > 2048 || EnrollmentInspection.ImageHash(Utf8.GetBytes(observation.Identity)) != identityHash ||
                ConfigurationProfile != VmConfigurationProfile.Name || observation.Profile != ConfigurationProfile ||
                observation.Digest != ConfigurationHash)
            {
                refused = true; throw new InvalidOperationException("installed-vm-configuration-unavailable");
            }
            CheckCurrent();
        }

        // Association check only; copied candidate fields issue no authority.
        internal void CheckCandidateBinding(InstalledOwnerRegistration owner, Guid vmId, string profile, string digest)
        {
            try
            {
                if (owner == null || !Object.ReferenceEquals(installed, owner) || !mustBindCaller || checkCaller == null ||
                    ConfigurationHash == null || ConfigurationProfile != VmConfigurationProfile.Name ||
                    VmId != vmId || ConfigurationProfile != profile || ConfigurationHash != digest)
                    throw new InvalidOperationException();
                CheckCurrent();
            }
            catch { refused = true; throw new InvalidOperationException("installed-vm-candidate-binding-unavailable"); }
        }

        internal void BindCaller(CallerMainOperation.InspectionCompletion admitted)
        {
            if (installed == null || admitted == null) throw new InvalidOperationException("installed-vm-caller-unavailable");
            BindCore(delegate { admitted.CheckInstalledOwner(installed); });
            JournalCaller = admitted;
        }
        private void BindCore(Action caller)
        {
            try
            {
                if (!mustBindCaller || checkCaller != null || caller == null) throw new InvalidOperationException();
                CheckCurrent(); caller(); checkCaller = caller; CheckCurrent();
            }
            catch { refused = true; throw new InvalidOperationException("installed-vm-caller-unavailable"); }
        }

        public void Dispose()
        {
            if (closed) return; closed = true;
            try { if (held != null) held.Dispose(); }
            finally { if (original != null) Array.Clear(original, 0, original.Length); }
        }

        // Read-only metadata used by the administrative installer after verifying
        // the source image bytes. This returns no enrollment or mutation authority.
        public static string ObserveForInstaller(Guid id)
        {
            using (var native = new VmManagementNative(id))
            {
                VmObservation value = native.Inspect();
                if (value == null || value.VmId != id || value.State != 3 || String.IsNullOrEmpty(value.Identity) || value.Identity.Length > 2048)
                    throw new InvalidOperationException("installed-vm-observation-unavailable");
                return EnrollmentInspection.ImageHash(Utf8.GetBytes(value.Identity));
            }
        }

        public static string ObserveStorageForInstaller(Guid id)
        { return ObserveStorage(id, false); }
        public static string ObserveProtectedStorageForInstaller(Guid id)
        { return ObserveStorage(id, true); }
        public static string ObserveProtectedConfigurationForInstaller(Guid id)
        { return ObserveStorage(id, true, true); }
        private static void ValidateInstallerConfiguration(VmConfigurationObservation value, VmObservation vm)
        {
            if (value == null || value.VmId != vm.VmId || value.Identity != vm.Identity ||
                value.Profile != VmConfigurationProfile.Name || value.Digest == null ||
                !Regex.IsMatch(value.Digest, "\\A[a-f0-9]{64}\\z", RegexOptions.CultureInvariant))
                throw new InvalidOperationException("installed-vm-observation-unavailable");
        }
        private static string ObserveStorage(Guid id, bool requireProtection, bool requireConfiguration = false)
        {
            var checkpoint = new VmInspectionCheckpoint();
            try
            {
            using (var native = new VmManagementNative(id))
            {
                VmObservation before = native.Inspect();
                if (before == null || before.VmId != id || before.State != 3 || String.IsNullOrEmpty(before.Identity) || before.Identity.Length > 2048)
                    throw new InvalidOperationException("installed-vm-observation-unavailable");
                VmConfigurationObservation configuration = null;
                if (requireConfiguration)
                {
                    checkpoint.Code = 15; configuration = ((IVmConfigurationSource)native).ReadConfiguration();
                    ValidateInstallerConfiguration(configuration, before);
                }
                using (var storage = new VmStorageInspection(native, new EnrollmentNative(), checkpoint))
                {
                    if (requireProtection) storage.RequireProtectedStorage(id);
                    VmObservation after = native.Inspect(); storage.CheckCurrent();
                    if (after == null || after.VmId != id || after.State != 3 || after.Identity != before.Identity)
                        throw new InvalidOperationException("installed-vm-observation-unavailable");
                    if (requireConfiguration)
                    {
                        checkpoint.Code = 16; var current = ((IVmConfigurationSource)native).ReadConfiguration();
                        ValidateInstallerConfiguration(current, after);
                        if (current.Profile != configuration.Profile || current.Digest != configuration.Digest)
                            throw new InvalidOperationException("installed-vm-observation-unavailable");
                    }
                    return EnrollmentInspection.ImageHash(Utf8.GetBytes(before.Identity)) + "\n" + storage.Digest +
                        (requireConfiguration ? "\n" + configuration.Profile + "\n" + configuration.Digest : "");
                }
            }
            }
            catch
            {
                var failure = new InvalidOperationException("installed-vm-observation-unavailable");
                if (checkpoint.Code >= 0 && checkpoint.Code <= 24) failure.Data["protectedStorageCheckpoint"] = checkpoint.Code;
                throw failure;
            }
        }

#if INSTALLED_VM_TEST
        internal static InstalledVmInspection PrepareForTest(string root, string installId, uint revision,
            string epoch, string digest, string selection, string selectionEpoch, Action authority,
            IEnrollmentFiles files, Func<Guid, IVmManagement> create, IEnrollmentFiles storageFiles)
        {
            return CreateInspection(new InstalledVmRegistration(root, installId, revision, epoch, digest,
                selection, selectionEpoch, authority, files, null, true), create, true, storageFiles, null, true);
        }
        internal void BindForTest(Action caller) { BindCore(caller); }
        // Compiled only in the contract fixture. Production uses the typed native
        // installed registration/admission above, never an injected authority.
        internal static InstalledVmInspection AcquireForTest(string root, string installId, uint revision,
            string epoch, string digest, string selection, string selectionEpoch, Action authority,
            IEnrollmentFiles files, Func<Guid, IVmManagement> create, IEnrollmentFiles storageFiles = null)
        {
            return CreateInspection(new InstalledVmRegistration(root, installId, revision, epoch,
                digest, selection, selectionEpoch, authority, files), create, true, storageFiles);
        }
#endif
#if RUNTIME_CANDIDATE_TEST
        internal static InstalledVmInspection PrepareCandidateForTest(string root, InstalledOwnerRegistration owner,
            IEnrollmentFiles records, Func<Guid, IVmManagement> create, IEnrollmentFiles storageFiles)
        {
            InstalledOwnerPolicy policy = owner.Policy;
            return CreateInspection(new InstalledVmRegistration(root, policy.InstallId, policy.Revision, policy.Epoch,
                policy.Digest, policy.SelectionId, policy.SelectionEpoch, owner.CheckCurrent, records, owner),
                create, false, storageFiles, null, true);
        }
#endif
    }
}
