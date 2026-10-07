using System;
using System.Collections.Generic;
using System.Diagnostics;

namespace Aegis.ProtectedSession
{
    // Trusted local owner supplies held handles and an exact image allowlist, never wire PIDs.
    // Retains an initial inventory. This is not a complete historical descendant observer.
    internal sealed class GuestJobInventory : IDisposable
    {
        private sealed class Member
        {
            internal IntPtr Handle;
            internal long Birth;
        }
        private readonly object gate = new object();
        private readonly Dictionary<uint, Member> members = new Dictionary<uint, Member>();
        private IntPtr job;
        private uint initialTotal;
        private bool disposed;
        internal int InitialCount { get { lock (gate) { GuestJobNative.Require(!disposed); return members.Count; } } }
        internal GuestJobInventory(IntPtr heldJob, IntPtr heldRoot, string[] approvedImages)
        {
            GuestJobNative.Require(approvedImages != null && approvedImages.Length > 0 && approvedImages.Length <= 8);
            IntPtr root = IntPtr.Zero;
            try
            {
                job = GuestJobNative.Retain(heldJob); root = GuestJobNative.Retain(heldRoot);
                uint rootPid = GuestJobNative.GetProcessId(root);
                long rootBirth = GuestJobNative.Birth(root, job, rootPid);
                string principal = GuestJobNative.Principal(root);
                var before = GuestJobNative.Counts(job);
                uint[] observed = GuestJobNative.Members(job);
                // A member that exited before acquisition cannot be silently omitted.
                GuestJobNative.Require(before.Total == before.Active && before.Active == observed.Length && observed.Length > 0);
                bool foundRoot = false;
                foreach (uint pid in observed)
                {
                    IntPtr handle = pid == rootPid ? GuestJobNative.Retain(root) : GuestJobNative.OpenMember(pid);
                    try
                    {
                        long birth = GuestJobNative.Birth(handle, job, pid);
                        string image = GuestJobNative.Image(handle);
                        bool approved = false;
                        foreach (string expected in approvedImages)
                            if (string.Equals(expected, image, StringComparison.OrdinalIgnoreCase)) approved = true;
                        GuestJobNative.Require(approved && GuestJobNative.Principal(handle) == principal);
                        if (pid == rootPid) { GuestJobNative.Require(birth == rootBirth); foundRoot = true; }
                        members.Add(pid, new Member { Handle = handle, Birth = birth }); handle = IntPtr.Zero;
                    }
                    finally { if (handle != IntPtr.Zero) GuestJobNative.CloseHandle(handle); }
                }
                GuestJobNative.Require(foundRoot); initialTotal = before.Total;
                ValidateInitial();
            }
            catch { Dispose(); throw; }
            finally { if (root != IntPtr.Zero) GuestJobNative.CloseHandle(root); }
        }
        // Any new/exited member or uncertain observation refuses bootstrap admission.
        internal void ValidateInitial()
        {
            lock (gate)
            {
                GuestJobNative.Require(!disposed);
                var before = GuestJobNative.Counts(job);
                uint[] observed = GuestJobNative.Members(job);
                GuestJobNative.Require(before.Total == initialTotal && before.Active == members.Count && observed.Length == members.Count);
                foreach (uint pid in observed)
                {
                    Member member;
                    GuestJobNative.Require(members.TryGetValue(pid, out member));
                    GuestJobNative.Require(GuestJobNative.Birth(member.Handle, job, pid) == member.Birth);
                }
                var after = GuestJobNative.Counts(job);
                GuestJobNative.Require(after.Total == before.Total && after.Active == before.Active);
            }
        }
        // Call only after the owner's pending spawn/termination operation has settled.
        // Unknown is false; never infer closure from a root exit or failed Job query.
        internal bool ConfirmClosure(int timeoutMilliseconds)
        {
            GuestJobNative.Require(timeoutMilliseconds >= 0 && timeoutMilliseconds <= 2000);
            lock (gate)
            {
                if (disposed) return false;
                var clock = Stopwatch.StartNew();
                do
                {
                    try
                    {
                        bool allExited = true;
                        foreach (var member in members.Values)
                            if (GuestJobNative.WaitForSingleObject(member.Handle, 0) != 0) allExited = false;
                        var before = GuestJobNative.Counts(job);
                        uint[] observed = GuestJobNative.Members(job);
                        var after = GuestJobNative.Counts(job);
                        if (allExited && before.Active == 0 && observed.Length == 0 && after.Active == 0 && before.Total == after.Total) return true;
                    }
                    catch { return false; }
                    if (clock.ElapsedMilliseconds >= timeoutMilliseconds) break;
                    System.Threading.Thread.Sleep(10);
                } while (true);
                return false;
            }
        }
        public void Dispose()
        {
            lock (gate)
            {
                if (disposed) return; disposed = true;
                foreach (var member in members.Values) GuestJobNative.CloseHandle(member.Handle);
                members.Clear();
                if (job != IntPtr.Zero) { GuestJobNative.CloseHandle(job); job = IntPtr.Zero; }
            }
        }
    }
}
