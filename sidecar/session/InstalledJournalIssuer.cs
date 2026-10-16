using System;
using System.IO;

namespace Aegis.ProtectedSession
{
    // All production inputs are original retained native objects; no callbacks or imported roots.
    internal sealed class InstalledJournalAuthority : IDisposable
    {
        private readonly InstalledOwnerRegistration owner;
        private readonly InstalledVmRegistration vm;
        private readonly CallerMainOperation.InspectionCompletion caller;
        private readonly EnrollmentHeld held;
        private readonly byte[] original;
        private bool closed;
        internal readonly ProtectedJournalRegistration Registration;
        internal readonly ProtectedOperationBinding Binding;
        internal object Gate { get { return owner.JournalGate; } }
        internal object CallerGate { get { return caller.SynchronizationGate; } }
        internal InstalledJournalAuthority(InstalledOwnerRegistration originalOwner, InstalledVmRegistration originalVm, ProtectedOperationBinding binding)
        {
            owner = originalOwner; vm = originalVm; Binding = binding; caller = vm.JournalCaller;
            try
            {
                ProtectedJournalRegistration.Require(caller != null); owner.CheckCurrent(); string path = Path.Combine(InstalledOwnerPolicy.Root, "registered-journal.json");
                held = new EnrollmentNative().Open(path, false); EnrollmentInspection.Check(held, path, false, false);
                original = held.Read(ProtectedJournalRegistration.MaximumBytes); Registration = ProtectedJournalRegistration.Parse(original);
                Check();
            }
            catch { Dispose(); throw; }
        }
        internal void Check()
        {
            ProtectedJournalRegistration.Require(!closed); owner.CheckCurrent(); Registration.CheckPolicy(owner.Policy); Registration.CheckBinding(Binding);
            ProtectedJournalRegistration.Require(Object.ReferenceEquals(caller, vm.JournalCaller)); caller.CheckInstalledOwner(owner);
            // This rechecks immutable original selection/caller records. It makes no running VM configuration claim.
            vm.CheckJournalAssociation(owner, Binding); held.Recheck(false);
            ProtectedJournalRegistration.Require(ProtectedOperationRecord.Equal(held.Read(ProtectedJournalRegistration.MaximumBytes), original)); owner.CheckCurrent();
        }
        public void Dispose() { if (closed) return; closed = true; if (held != null) held.Dispose(); }
    }
    internal sealed partial class InstalledOwnerRegistration
    {
        private bool journalAttempted;
        private ProtectedJournalLease journal;
        internal ProtectedJournalLease IssueJournal(InstalledVmInspection inspection)
        {
            object callerGate = inspection.JournalSynchronizationGate(this);
            lock (callerGate)
            lock (JournalGate)
            {
                ProtectedJournalRegistration.Require(!journalAttempted); journalAttempted = true;
                CheckCurrent(); ProtectedJournalRegistration.Require(setup != null);
                InstalledJournalAuthority authority = inspection.PrepareJournal(this, setup.Session);
                ProtectedJournalNative native = null;
                try
                {
                    native = ProtectedJournalNative.Acquire(authority.Registration);
                    journal = ProtectedJournalLease.Create(authority, native); JournalResource = journal; return journal;
                }
                catch { if (native != null) native.Dispose(); authority.Dispose(); throw; }
            }
        }
    }
    internal sealed partial class InstalledVmRegistration
    {
        internal ProtectedOperationBinding JournalBinding(InstalledOwnerRegistration owner, string session)
        {
            CheckCandidateBinding(owner, VmId, ConfigurationProfile, ConfigurationHash);
            InstalledOwnerPolicy policy = owner.Policy;
            return new ProtectedOperationBinding(policy.InstallId, policy.Revision, policy.Epoch, policy.Digest,
                policy.SelectionId, policy.SelectionEpoch, VmId, identityHash, ConfigurationProfile, ConfigurationHash,
                session, ProtectedJournalRegistration.Nonce());
        }
        internal void CheckJournalAssociation(InstalledOwnerRegistration owner, ProtectedOperationBinding expected)
        {
            CheckCandidateBinding(owner, expected.VmId, expected.ConfigurationProfile, expected.ConfigurationSha256);
            ProtectedJournalRegistration.Require(identityHash == expected.VmIdentitySha256);
        }
    }
    internal sealed partial class InstalledVmInspection
    {
        internal object JournalSynchronizationGate(InstalledOwnerRegistration owner)
        {
            ProtectedJournalRegistration.Require(!closed && !refused && registration.JournalCaller != null);
            registration.JournalCaller.CheckInstalledOwner(owner); return registration.JournalCaller.SynchronizationGate;
        }
        internal InstalledJournalAuthority PrepareJournal(InstalledOwnerRegistration owner, string originalSession)
        {
            if (closed || refused) throw new InvalidOperationException("protected-journal-unavailable");
            // Existing original caller-bound Off/configuration/storage preflight applies only to issuance.
            VmObservation observation = Inspect(); ProtectedJournalRegistration.Require(observation.State == 3);
            ProtectedOperationBinding binding = registration.JournalBinding(owner, originalSession);
            return new InstalledJournalAuthority(owner, registration, binding);
        }
    }
}
