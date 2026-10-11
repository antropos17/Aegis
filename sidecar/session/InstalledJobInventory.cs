using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using Microsoft.Win32.SafeHandles;

namespace Aegis.ProtectedSession
{
    // Installed supervisor authority only. The first stable inventory is sealed;
    // even a permitted console host appearing after that seal is refused.
    internal sealed class InstalledJobInventory : IDisposable
    {
        private readonly SafeFileHandle job, supervisor;
        private readonly uint supervisorPid;
        private readonly long supervisorBirth;
        private readonly List<EnrollmentHeld> imageObjects = new List<EnrollmentHeld>();
        private SafeFileHandle helper;
        private uint helperPid;
        private long helperBirth;
        private CallerIdentity supervisorToken, helperToken;
        private AppContainerExecutable.PinnedFile image;
        private SafeFileHandle imageSecurityFile;
        private byte[] imageSecurity;
        private uint[] sealedMembers;
        private bool closed;
#if INSTALLED_JOB_TEST
        internal static Func<SafeFileHandle, CallerIdentity> TokenForTest;
#endif

        internal InstalledJobInventory(SafeFileHandle ownedJob, SafeFileHandle heldSupervisor, long birth, ref int checkpoint)
        {
            job = CallerNative.Duplicate(ownedJob.DangerousGetHandle());
            try
            {
                supervisor = CallerNative.Duplicate(heldSupervisor.DangerousGetHandle());
                supervisorPid = CallerNative.GetProcessId(supervisor); supervisorBirth = birth;
                CheckCurrent(ref checkpoint);
            }
            catch { Dispose(); throw; }
        }
        internal static bool ValidAccounting(GuestJobNative.Accounting counts, uint[] members)
        {
            // Total includes exited historical children; none may be omitted.
            return members != null && counts.Active >= 1 && counts.Active <= 2 &&
                counts.Total == counts.Active && counts.Terminated == 0 && counts.Active == members.Length;
        }
        internal static bool SameMembers(uint[] first, uint[] second)
        {
            if (first == null || second == null || first.Length != second.Length) return false;
            for (int index = 0; index < first.Length; index++) if (first[index] != second[index]) return false;
            return true;
        }
        private static CallerIdentity Token(SafeFileHandle process)
        {
#if INSTALLED_JOB_TEST
            if (TokenForTest != null) return TokenForTest(process);
#endif
            using (SafeFileHandle token = CallerNative.ProcessToken(process)) return CallerIdentity.Observe(token);
        }
        internal static bool PermittedHelper(CallerIdentity root, CallerIdentity candidate)
        { return root != null && root.InstalledSystem() && candidate != null && candidate.InstalledSystem() && root.SameOperator(candidate); }

        internal void CheckCurrent(ref int checkpoint)
        {
            checkpoint = 36; CallerNative.Require(!closed);
            var before = GuestJobNative.Counts(job.DangerousGetHandle());
            uint[] observed = GuestJobNative.Members(job.DangerousGetHandle());
            CallerNative.Require(ValidAccounting(before, observed));
            checkpoint = 37;
            CallerNative.Require(Array.IndexOf(observed, supervisorPid) >= 0 &&
                GuestJobNative.Birth(supervisor.DangerousGetHandle(), job.DangerousGetHandle(), supervisorPid) == supervisorBirth);
            checkpoint = 38;
            CallerIdentity currentRoot = Token(supervisor); CallerNative.Require(currentRoot.InstalledSystem());
            if (supervisorToken != null) CallerNative.Require(supervisorToken.SamePrimaryToken(currentRoot));
            checkpoint = 44;
            if (sealedMembers != null) CallerNative.Require(SameMembers(sealedMembers, observed));
            else if (observed.Length == 2)
            {
                checkpoint = 39;
                helperPid = observed[0] == supervisorPid ? observed[1] : observed[0];
                helper = new SafeFileHandle(GuestJobNative.OpenMember(helperPid), true);
                helperBirth = GuestJobNative.Birth(helper.DangerousGetHandle(), job.DangerousGetHandle(), helperPid);
                checkpoint = 40; PinConsoleHost();
            }
            if (helper != null)
            {
                checkpoint = 41;
                CallerNative.Require(GuestJobNative.Birth(helper.DangerousGetHandle(), job.DangerousGetHandle(), helperPid) == helperBirth &&
                    image.IsPinned && image.MatchesProcessImage(helper.DangerousGetHandle()));
                for (int index = 0; index < imageObjects.Count; index++) imageObjects[index].Recheck(index < imageObjects.Count - 1);
                CallerNative.Require(SameBytes(imageSecurity, ReadSecurity(imageSecurityFile)));
                checkpoint = 42;
                CallerIdentity currentHelper = Token(helper);
                CallerNative.Require(PermittedHelper(currentRoot, currentHelper));
                if (helperToken != null) CallerNative.Require(helperToken.SamePrimaryToken(currentHelper));
                else helperToken = currentHelper;
            }
            checkpoint = 43;
            uint[] again = GuestJobNative.Members(job.DangerousGetHandle());
            var after = GuestJobNative.Counts(job.DangerousGetHandle());
            CallerNative.Require(ValidAccounting(after, again) && before.Total == after.Total && SameMembers(observed, again));
            CallerNative.Require(GuestJobNative.Birth(supervisor.DangerousGetHandle(), job.DangerousGetHandle(), supervisorPid) == supervisorBirth &&
                currentRoot.SamePrimaryToken(Token(supervisor)));
            if (helper != null) CallerNative.Require(GuestJobNative.Birth(helper.DangerousGetHandle(), job.DangerousGetHandle(), helperPid) == helperBirth &&
                helperToken.SamePrimaryToken(Token(helper)));
            if (sealedMembers == null) { sealedMembers = observed; supervisorToken = currentRoot; }
        }

        // TrustedInstaller is an OS servicing principal on System32 leaves.
        // File writes use the full leaf mask; the ancestor mask alone is insufficient.
        internal static bool ProtectedSystemImage(byte[] bytes)
        {
            var descriptor = new RawSecurityDescriptor(bytes, 0);
            if (descriptor.Owner == null || !Trusted(descriptor.Owner.Value) || descriptor.DiscretionaryAcl == null ||
                (descriptor.ControlFlags & ControlFlags.DiscretionaryAclPresent) == 0) return false;
            foreach (GenericAce entry in descriptor.DiscretionaryAcl)
            {
                CommonAce ace = entry as CommonAce;
                if (ace == null || ace.IsCallback || ace.SecurityIdentifier == null) return false;
                if ((ace.AceFlags & AceFlags.InheritOnly) != 0 || ace.AceQualifier == AceQualifier.AccessDenied) continue;
                if (ace.AceQualifier != AceQualifier.AccessAllowed ||
                    ((unchecked((uint)ace.AccessMask) & 0x500D0156U) != 0 && !Trusted(ace.SecurityIdentifier.Value))) return false;
            }
            return true;
        }
        private static bool Trusted(string sid)
        { return sid == "S-1-5-18" || sid == "S-1-5-32-544" || sid == "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464"; }
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern SafeFileHandle CreateFile(string path,
            uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
        [DllImport("advapi32.dll")] private static extern uint GetSecurityInfo(SafeFileHandle file, int type, uint information,
            out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr descriptor);
        [DllImport("advapi32.dll")] private static extern uint GetSecurityDescriptorLength(IntPtr descriptor);
        [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr allocation);
        private static byte[] ReadSecurity(SafeFileHandle file)
        {
            IntPtr owner, group, dacl, sacl, descriptor;
            uint status = GetSecurityInfo(file, 1, 5, out owner, out group, out dacl, out sacl, out descriptor);
            try
            {
                CallerNative.Require(status == 0 && descriptor != IntPtr.Zero && owner != IntPtr.Zero && dacl != IntPtr.Zero);
                uint length = GetSecurityDescriptorLength(descriptor); CallerNative.Require(length > 0 && length <= 65536);
                byte[] bytes = new byte[(int)length]; Marshal.Copy(descriptor, bytes, 0, bytes.Length); return bytes;
            }
            finally { if (descriptor != IntPtr.Zero) LocalFree(descriptor); }
        }
        private static bool SameBytes(byte[] first, byte[] second)
        {
            if (first == null || second == null || first.Length != second.Length) return false;
            for (int index = 0; index < first.Length; index++) if (first[index] != second[index]) return false;
            return true;
        }
        private void PinConsoleHost()
        {
            string selected = Path.Combine(Environment.SystemDirectory, "conhost.exe");
            CallerNative.Require(String.Equals(GuestJobNative.Image(helper.DangerousGetHandle()), selected, StringComparison.OrdinalIgnoreCase));
            var ancestors = new List<string>(); string cursor = Path.GetDirectoryName(selected);
            while (cursor != null) { ancestors.Add(cursor); CallerNative.Require(ancestors.Count <= 32); cursor = Path.GetDirectoryName(cursor); }
            ancestors.Reverse(); var files = new EnrollmentNative();
            foreach (string path in ancestors)
            {
                EnrollmentHeld item = files.Open(path, true); imageObjects.Add(item);
                CallerNative.Require(item.Protected(true)); item.Recheck(true);
            }
            EnrollmentHeld leaf = files.Open(selected, false); imageObjects.Add(leaf);
            // Read and retain security from a held handle to the already pinned leaf.
            imageSecurityFile = CreateFile(selected, 0x20080U, 1, IntPtr.Zero, 3, 0x00200000U, IntPtr.Zero);
            CallerNative.Require(imageSecurityFile != null && !imageSecurityFile.IsInvalid);
            imageSecurity = ReadSecurity(imageSecurityFile); CallerNative.Require(ProtectedSystemImage(imageSecurity));
            byte[] content = leaf.Read(4 * 1024 * 1024);
            try { image = AppContainerExecutable.Open(selected, content.Length, EnrollmentInspection.ImageHash(content)); }
            finally { Array.Clear(content, 0, content.Length); }
            leaf.Recheck(false);
            CallerNative.Require(SameBytes(imageSecurity, ReadSecurity(imageSecurityFile)));
        }
        public void Dispose()
        {
            if (closed) return; closed = true; bool failed = false;
            var resources = new List<IDisposable>();
            if (image != null) resources.Add(image);
            if (imageSecurityFile != null) resources.Add(imageSecurityFile);
            for (int index = imageObjects.Count - 1; index >= 0; index--) resources.Add(imageObjects[index]);
            if (helper != null) resources.Add(helper);
            if (supervisor != null) resources.Add(supervisor);
            if (job != null) resources.Add(job);
            foreach (IDisposable resource in resources) try { resource.Dispose(); } catch { failed = true; }
            if (failed) throw new InvalidOperationException("installed-job-cleanup-unconfirmed");
        }
    }
}
