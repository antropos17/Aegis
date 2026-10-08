using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;

namespace Aegis.ProtectedSession
{
    // Trusted local owner supplies held handles and an exact image allowlist, never wire PIDs.
    // Retains pre-resume members and one sealed initialized-runtime inventory.
    // This is not a complete historical descendant observer.
    internal sealed class GuestJobInventory : IDisposable
    {
        private sealed class Member
        {
            internal IntPtr Handle;
            internal long Birth;
            internal string Image;
        }
        private readonly object gate = new object();
        private Dictionary<uint, Member> members = new Dictionary<uint, Member>();
        private IntPtr job;
        private uint initialTotal;
        private bool disposed;
        private readonly string principal;
        private readonly int session;
        private bool startupSealAttempted;
        private readonly Dictionary<string, object> startup = new Dictionary<string, object> { { "status", "not-attempted" } };
        internal Dictionary<string, object> RuntimeStartupObservation { get { lock (gate) { return new Dictionary<string, object>(startup); } } }
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
                principal = GuestJobNative.Principal(root); session = GuestJobNative.Session(root);
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
                        members.Add(pid, new Member { Handle = handle, Birth = birth, Image = image }); handle = IntPtr.Zero;
                    }
                    finally { if (handle != IntPtr.Zero) GuestJobNative.CloseHandle(handle); }
                }
                GuestJobNative.Require(foundRoot); initialTotal = before.Total;
                ValidateInitial();
            }
            catch { Dispose(); throw; }
            finally { if (root != IntPtr.Zero) GuestJobNative.CloseHandle(root); }
        }
        // Trusted owner calls once after authenticated core initialization, before
        // project ACK. Every prior held member survives; only the OS console host
        // may appear late. Accounting refuses even an already-exited unknown child.
        internal void SealInitializedRuntime()
        {
            lock (gate)
            {
                GuestJobNative.Require(!disposed && !startupSealAttempted);
                startupSealAttempted = true; startup["status"] = "observing"; startup["check"] = "accounting";
                startup["standardStartupTokenVerified"] = false; startup["startupObservedMembers"] = 0;
                var added = new Dictionary<uint, Member>();
                try
                {
                    var before = GuestJobNative.Counts(job); uint[] observed = GuestJobNative.Members(job);
                    startup["beforeTotal"] = before.Total; startup["beforeActive"] = before.Active; startup["beforeMembers"] = observed.Length;
                    GuestJobNative.Require(before.Total == before.Active && before.Active == observed.Length &&
                        before.Total >= initialTotal && before.Total <= initialTotal + 1);
                    string helper = Path.Combine(Environment.SystemDirectory, "conhost.exe"); int helpers = 0, retained = 0;
                    foreach (uint pid in observed)
                    {
                        Member member;
                        if (members.TryGetValue(pid, out member))
                        {
                            startup["check"] = "original-held-identity";
                            GuestJobNative.Require(GuestJobNative.Birth(member.Handle, job, pid) == member.Birth &&
                                String.Equals(GuestJobNative.Image(member.Handle), member.Image, StringComparison.OrdinalIgnoreCase));
                            retained++;
                            if (String.Equals(member.Image, helper, StringComparison.OrdinalIgnoreCase)) helpers++;
                            continue;
                        }
                        IntPtr handle = GuestJobNative.OpenMember(pid);
                        try
                        {
                            startup["check"] = "startup-held-image";
                            long birth = GuestJobNative.Birth(handle, job, pid); string image = GuestJobNative.Image(handle);
                            GuestJobNative.Require(String.Equals(image, helper, StringComparison.OrdinalIgnoreCase));
                            startup["startupObservedMembers"] = 1; startup["startupMemberPid"] = pid;
                            startup["startupMemberBirthFileTime"] = birth; startup["startupImageMatched"] = true;
                            helpers++; GuestJobNative.Require(helpers <= 1);
                            startup["check"] = "startup-standard-token";
                            GuestJobNative.RequireStandardPrincipal(handle, principal, session);
                            startup["standardStartupTokenVerified"] = true;
                            added.Add(pid, new Member { Handle = handle, Birth = birth, Image = image }); handle = IntPtr.Zero;
                        }
                        finally { if (handle != IntPtr.Zero) GuestJobNative.CloseHandle(handle); }
                    }
                    startup["check"] = "original-member-preservation";
                    GuestJobNative.Require(retained == members.Count && helpers <= 1 && added.Count <= 1);
                    startup["check"] = "snapshot-stability";
                    uint[] again = GuestJobNative.Members(job); var after = GuestJobNative.Counts(job);
                    startup["afterTotal"] = after.Total; startup["afterActive"] = after.Active; startup["afterMembers"] = again.Length;
                    GuestJobNative.Require(after.Total == before.Total && after.Active == before.Active && again.Length == observed.Length);
                    for (int index = 0; index < observed.Length; index++) GuestJobNative.Require(again[index] == observed[index]);
                    startup["check"] = "final-held-identity";
                    foreach (var item in members) GuestJobNative.Require(GuestJobNative.Birth(item.Value.Handle, job, item.Key) == item.Value.Birth);
                    foreach (var item in added) GuestJobNative.Require(GuestJobNative.Birth(item.Value.Handle, job, item.Key) == item.Value.Birth);
                    // Transfer only after all acquisitions and stable observations succeed.
                    var sealedMembers = new Dictionary<uint, Member>(members);
                    foreach (var item in added) sealedMembers.Add(item.Key, item.Value);
                    members = sealedMembers; added.Clear(); initialTotal = before.Total;
                    startup["retainedMembers"] = members.Count; startup["status"] = "sealed"; startup["check"] = "complete";
                }
                catch { startup["status"] = "refused"; throw; }
                finally { foreach (var member in added.Values) GuestJobNative.CloseHandle(member.Handle); }
            }
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
