using System;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;

namespace Aegis.ProtectedSession
{
    // A fixed protected record supplies the VM selection; no caller-supplied GUID,
    // root or record is accepted by the installed-owner factory.
    internal sealed class InstalledVmRegistration : IDisposable
    {
        private const string Leaf = "registered-vm.json";
        private static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);
        private static readonly Regex Schema = new Regex(
            "\\A\\{\"schemaVersion\":1,\"installId\":\"([a-f0-9]{32})\",\"revision\":([1-9][0-9]{0,9})," +
            "\"epoch\":\"([a-f0-9]{32})\",\"policySha256\":\"([a-f0-9]{64})\"," +
            "\"selectionId\":\"([a-f0-9]{32})\",\"selectionEpoch\":\"([a-f0-9]{32})\"," +
            "\"vmId\":\"([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\"," +
            "\"identitySha256\":\"([a-f0-9]{64})\",\"status\":\"active\"\\}\\z",
            RegexOptions.CultureInvariant);
        private readonly Action checkAuthority;
        private readonly EnrollmentHeld held;
        private readonly byte[] original;
        private bool closed, refused;
        internal readonly Guid VmId;
        private readonly string identityHash;

        private InstalledVmRegistration(string root, string installId, uint revision, string epoch,
            string digest, string selection, string selectionEpoch, Action authority, IEnrollmentFiles files)
        {
            checkAuthority = authority;
            try
            {
                if (authority == null || files == null) throw new InvalidDataException();
                authority();
                string path = Path.Combine(root, Leaf);
                held = files.Open(path, false);
                EnrollmentInspection.Check(held, path, false, false);
                original = held.Read(4096);
                Match record = Schema.Match(Utf8.GetString(original));
                uint recordedRevision;
                if (!record.Success || !UInt32.TryParse(record.Groups[2].Value, out recordedRevision) ||
                    recordedRevision != revision || record.Groups[1].Value != installId ||
                    record.Groups[3].Value != epoch || record.Groups[4].Value != digest ||
                    record.Groups[5].Value != selection || record.Groups[6].Value != selectionEpoch ||
                    !Guid.TryParseExact(record.Groups[7].Value, "D", out VmId) || VmId == Guid.Empty)
                    throw new InvalidDataException();
                identityHash = record.Groups[8].Value;
                CheckCurrent();
            }
            catch { Dispose(); throw new InvalidOperationException("installed-vm-registration-unavailable"); }
        }

        internal static InstalledVmInspection AcquireInspection(InstalledOwnerRegistration owner,
            CallerMainOperation.Context admitted)
        {
            if (owner == null || admitted == null) throw new InvalidOperationException("installed-vm-registration-unavailable");
            InstalledOwnerPolicy policy = owner.Policy;
            Action authority = delegate { owner.CheckCurrent(); admitted.CheckInstalledOwner(owner); };
            var registration = new InstalledVmRegistration(InstalledOwnerPolicy.Root, policy.InstallId,
                policy.Revision, policy.Epoch, policy.Digest, policy.SelectionId, policy.SelectionEpoch,
                authority, new EnrollmentNative());
            return CreateInspection(registration, delegate(Guid id) { return new VmManagementNative(id); });
        }

        internal static InstalledVmInspection AcquireIfConfigured(InstalledOwnerRegistration owner,
            CallerMainOperation.Context admitted)
        {
            if (owner == null || admitted == null) throw new InvalidOperationException("installed-vm-registration-unavailable");
            owner.CheckCurrent(); admitted.CheckInstalledOwner(owner);
            try { System.IO.File.GetAttributes(Path.Combine(InstalledOwnerPolicy.Root, Leaf)); }
            catch (FileNotFoundException) { owner.CheckCurrent(); admitted.CheckInstalledOwner(owner); return null; }
            return AcquireInspection(owner, admitted);
        }

        private static InstalledVmInspection CreateInspection(InstalledVmRegistration registration,
            Func<Guid, IVmManagement> create)
        {
            IVmManagement native = null; InstalledVmInspection bound = null;
            try
            {
                registration.CheckCurrent(); native = create(registration.VmId);
                bound = new InstalledVmInspection(registration, native);
                bound.Inspect(); return bound;
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
                checkAuthority(); held.Recheck(false); bytes = held.Read(4096);
                if (bytes.Length != original.Length) throw new InvalidDataException();
                for (int index = 0; index < bytes.Length; index++)
                    if (bytes[index] != original[index]) throw new InvalidDataException();
                checkAuthority();
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

        public void Dispose()
        {
            if (closed) return; closed = true;
            try { if (held != null) held.Dispose(); }
            finally { if (original != null) Array.Clear(original, 0, original.Length); }
        }

#if INSTALLED_VM_TEST
        // Compiled only in the contract fixture. Production uses the typed native
        // installed registration/admission above, never an injected authority.
        internal static InstalledVmInspection AcquireForTest(string root, string installId, uint revision,
            string epoch, string digest, string selection, string selectionEpoch, Action authority,
            IEnrollmentFiles files, Func<Guid, IVmManagement> create)
        {
            return CreateInspection(new InstalledVmRegistration(root, installId, revision, epoch,
                digest, selection, selectionEpoch, authority, files), create);
        }
#endif
    }
}
