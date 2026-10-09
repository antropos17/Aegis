using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using Microsoft.Win32.SafeHandles;

namespace Aegis.ProtectedSession
{
    // Inactive, nonserializable retained observation. It supplies no installation,
    // protected-principal, broker, provisioning or launch authority.
    internal sealed class EnrollmentLease : IDisposable
    {
        private readonly object gate = new object();
        private List<EnrollmentHeld> held;
        private Snapshot[] snapshots;
        private SafeFileHandle process, job;
        private CallerRegistration owner;
        private AppContainerExecutable.PinnedFile image;
        private byte[] record;
        private string imageHash;
        private uint pid;
        private long birth;
        private bool revoked, cleanupUnknown;

        private sealed class Snapshot
        {
            internal readonly string Path, Volume, Id;
            internal readonly bool Directory, Ancestor;
            internal Snapshot(EnrollmentHeld value, bool ancestor)
            { Path = value.PathName; Volume = value.Volume; Id = value.FileId;
                Directory = value.Directory; Ancestor = ancestor; }
            internal void Check(EnrollmentHeld value)
            {
                EnrollmentNative.Require(value.PathName == Path && value.Volume == Volume && value.FileId == Id &&
                    value.Directory == Directory && !value.Reparse && value.Protected(Ancestor));
                value.Recheck();
            }
        }
        private EnrollmentLease() { }

        // Handles and root are selected by trusted native code, never wire fields.
        // Duplicate rather than consume the launcher's already-held handles.
        internal static EnrollmentLease Acquire(string root, IntPtr heldProcess, IntPtr heldJob)
        { return AcquireCore(root, heldProcess, heldJob, new EnrollmentNative()); }
#if ENROLLMENT_LEASE_TEST
        // Observation doubles are absent from the compiled production surface.
        internal static EnrollmentLease AcquireForTest(string root, IntPtr process, IntPtr job, IEnrollmentFiles files)
        { return AcquireCore(root, process, job, files); }
#endif
        private static EnrollmentLease AcquireCore(string root, IntPtr heldProcess, IntPtr heldJob, IEnrollmentFiles files)
        {
            var lease = new EnrollmentLease(); var watch = Stopwatch.StartNew();
            try
            {
                EnrollmentNative.Require(!CallerNative.HasThreadToken());
                lease.process = CallerNative.Duplicate(heldProcess);
                lease.job = CallerNative.Duplicate(heldJob);
                lease.pid = CallerNative.GetProcessId(lease.process);
                lease.birth = GuestJobNative.Birth(lease.process.DangerousGetHandle(), lease.job.DangerousGetHandle(), lease.pid);
                lease.owner = new CallerRegistration(lease.process.DangerousGetHandle(), Guid.NewGuid().ToString("N"));
                Deadline(watch);
                string imagePath = Path.Combine(root, "aegis-session.exe");
                EnrollmentInspection.RetainedFiles selected = EnrollmentInspection.RetainFiles(root, imagePath, files);
                lease.held = selected.Objects;
                lease.snapshots = new Snapshot[lease.held.Count];
                for (int index = 0; index < lease.held.Count; index++)
                    lease.snapshots[index] = new Snapshot(lease.held[index], index < lease.held.Count - 3);
                lease.record = selected.RecordBytes; lease.imageHash = selected.ImageHash;
                lease.image = AppContainerExecutable.Open(imagePath, selected.ImageSize, lease.imageHash);
                lease.CheckCore(watch);
                return lease;
            }
            catch { lease.Close(); throw Unavailable(); }
            finally { watch.Stop(); }
        }
        internal void CheckCurrent()
        {
            lock (gate)
            {
                var watch = Stopwatch.StartNew();
                try { EnrollmentNative.Require(!revoked); CheckCore(watch); }
                catch { Close(); throw Unavailable(); }
                finally { watch.Stop(); }
            }
        }
        private void CheckCore(Stopwatch watch)
        {
            EnrollmentNative.Require(!revoked && !CallerNative.HasThreadToken());
            owner.CheckCurrent(); Deadline(watch);
            EnrollmentNative.Require(GuestJobNative.Birth(process.DangerousGetHandle(), job.DangerousGetHandle(), pid) == birth &&
                GuestJobNative.Counts(job.DangerousGetHandle()).Active >= 1);
            Deadline(watch);
            for (int index = 0; index < held.Count; index++) { snapshots[index].Check(held[index]); Deadline(watch); }
            byte[] current = held[held.Count - 2].Read(1024);
            try { EnrollmentNative.Require(Same(record, current)); }
            finally { if (current != null) Array.Clear(current, 0, current.Length); }
            Deadline(watch);
            byte[] bytes = held[held.Count - 1].Read(4 * 1024 * 1024);
            try { EnrollmentNative.Require(Hash(bytes) == imageHash); }
            finally { if (bytes != null) Array.Clear(bytes, 0, bytes.Length); }
            Deadline(watch);
            EnrollmentNative.Require(image.IsPinned && image.MatchesProcessImage(process.DangerousGetHandle()));
            owner.CheckCurrent(); EnrollmentNative.Require(!CallerNative.HasThreadToken()); Deadline(watch);
        }
        private static string Hash(byte[] bytes)
        {
            EnrollmentNative.Require(bytes != null && bytes.Length > 0 && bytes.Length <= 4 * 1024 * 1024);
            using (SHA256 hash = SHA256.Create())
                return BitConverter.ToString(hash.ComputeHash(bytes)).Replace("-", "").ToLowerInvariant();
        }
        private static bool Same(byte[] first, byte[] second)
        {
            if (first == null || second == null || first.Length == 0 || first.Length > 1024 || first.Length != second.Length) return false;
            for (int index = 0; index < first.Length; index++) if (first[index] != second[index]) return false;
            return true;
        }
        // Post-call observation budget, not cancellation of synchronous native calls.
        private static void Deadline(Stopwatch watch) { EnrollmentNative.Require(watch.ElapsedMilliseconds < 2000); }
        private static InvalidDataException Unavailable() { return new InvalidDataException("enrollment-lease-unavailable"); }
        private void Close()
        {
            if (revoked) return;
            revoked = true;
            Action<IDisposable> close = value => { if (value != null) try { value.Dispose(); } catch { cleanupUnknown = true; } };
            close(image); close(owner); close(job); close(process);
            if (held != null) for (int index = held.Count - 1; index >= 0; index--) close(held[index]);
            if (record != null) Array.Clear(record, 0, record.Length);
        }
        internal void Revoke() { Dispose(); }
        public void Dispose()
        {
            lock (gate) { Close(); if (cleanupUnknown) throw Unavailable(); }
        }
    }
}
