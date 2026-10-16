using System;
using System.Diagnostics;
using System.IO;

namespace Aegis.ProtectedSession
{
    // Inactive metadata only. Installation issues no candidate leaf in this slice.
    internal sealed class InstalledRuntimeCandidate : IDisposable
    {
        private const string Leaf = "runtime-candidate.json";
        private readonly object gate = new object();
        private readonly InstalledOwnerRegistration owner;
        private readonly InstalledOwnerPolicy policy;
        private readonly InstalledVmInspection inspection;
        private readonly string path;
        private EnrollmentHeld held;
        private byte[] original;
        private string volume, fileId;
        private RuntimeCandidateCodec.Metadata metadata;
        private bool closed, cleanupUnknown;
        internal RuntimeCandidateCodec.Metadata Metadata { get { CheckCurrent(); return metadata; } }

        private InstalledRuntimeCandidate(InstalledOwnerRegistration originalOwner, InstalledVmInspection originalVm, string root, IEnrollmentFiles files)
        {
            owner = originalOwner; inspection = originalVm;
            try
            {
                Require(owner != null && inspection != null && files != null);
                policy = owner.Policy; Require(policy != null); owner.CheckCurrent(); policy.CheckCurrent();
                path = Path.Combine(root, Leaf); held = files.Open(path, false);
                EnrollmentInspection.Check(held, path, false, false); volume = held.Volume; fileId = held.FileId;
                original = Read(); metadata = RuntimeCandidateCodec.Parse(original); CheckCurrent();
            }
            catch { Dispose(); throw Unavailable(); }
        }
        internal static InstalledRuntimeCandidate Acquire(InstalledOwnerRegistration owner, InstalledVmInspection inspection)
        { return new InstalledRuntimeCandidate(owner, inspection, InstalledOwnerPolicy.Root, new EnrollmentNative()); }

        private static InvalidOperationException Unavailable() { return new InvalidOperationException("installed-runtime-candidate-unavailable"); }
        private static void Require(bool value) { if (!value) throw Unavailable(); }
        private byte[] Read()
        {
            byte[] value = held.Read(RuntimeCandidateCodec.MaximumBytes);
            Require(value != null && value.Length > 0 && value.Length <= RuntimeCandidateCodec.MaximumBytes); return value;
        }
        private void CheckAssociation()
        {
            Require(Object.ReferenceEquals(owner.Policy, policy)); owner.CheckCurrent(); policy.CheckCurrent();
            Require(metadata.InstallId == policy.InstallId && metadata.Revision == policy.Revision && metadata.Epoch == policy.Epoch &&
                metadata.PolicyHash == policy.Digest && metadata.OperatorSid == policy.OperatorSid &&
                metadata.SelectionId == policy.SelectionId && metadata.SelectionEpoch == policy.SelectionEpoch);
            inspection.CheckCandidateBinding(owner, metadata.VmId, metadata.ConfigurationProfile, metadata.ConfigurationHash);
        }
        internal void CheckCurrent()
        {
            lock (gate)
            {
                byte[] current = null; var watch = Stopwatch.StartNew();
                try
                {
                    Require(!closed); CheckAssociation();
                    EnrollmentInspection.Check(held, path, false, false);
                    Require(held.Volume == volume && held.FileId == fileId); held.Recheck(false); current = Read();
                    Require(current.Length == original.Length);
                    for (int index = 0; index < current.Length; index++) Require(current[index] == original[index]);
                    CheckAssociation(); Require(watch.ElapsedMilliseconds < 2000);
                }
                catch { Dispose(); throw Unavailable(); }
                finally { if (current != null) Array.Clear(current, 0, current.Length); }
            }
        }
        public void Dispose()
        {
            lock (gate)
            {
                if (!closed)
                {
                    closed = true;
                    try { if (held != null) held.Dispose(); } catch { cleanupUnknown = true; }
                    if (original != null) Array.Clear(original, 0, original.Length);
                }
                if (cleanupUnknown) throw Unavailable();
            }
        }
#if RUNTIME_CANDIDATE_TEST
        internal static InstalledRuntimeCandidate AcquireForTest(InstalledOwnerRegistration owner, InstalledVmInspection inspection, string root, IEnrollmentFiles files)
        { return new InstalledRuntimeCandidate(owner, inspection, root, files); }
#endif
    }
}
