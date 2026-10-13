using System;
using System.Security.AccessControl;
using System.Security.Principal;

namespace Aegis.ProtectedSession
{
    // Read-only ACL eligibility. This creates no VM, repairs no permissions and
    // grants no lifecycle authority. The VM principal is resolved locally from
    // the exact registered GUID, never supplied by a caller or stored SID string.
    internal static class VmStorageProtection
    {
#if INSTALLED_VM_TEST
        internal static Func<Guid, string> ResolveForTest;
#endif
        internal static string Resolve(Guid id)
        {
            if (id == Guid.Empty) throw new InvalidOperationException();
#if INSTALLED_VM_TEST
            if (ResolveForTest != null) return ResolveForTest(id);
#endif
            var account = new NTAccount("NT VIRTUAL MACHINE", id.ToString("D"));
            var sid = (SecurityIdentifier)account.Translate(typeof(SecurityIdentifier));
            if (sid == null || !sid.Value.StartsWith("S-1-5-83-", StringComparison.Ordinal) ||
                sid.Value == "S-1-5-83-0") throw new InvalidOperationException();
            return sid.Value;
        }
        private static bool HostOwner(string sid)
        { return sid == "S-1-5-18" || sid == "S-1-5-32-544"; }
        internal static bool PrivateFile(byte[] bytes, string vmSid, bool writableDisk)
        {
            try
            {
                if (bytes == null || bytes.Length == 0 || bytes.Length > 65536 ||
                    String.IsNullOrEmpty(vmSid)) return false;
                // Parse the SID independently: string-prefix matches never grant access.
                var expected = new SecurityIdentifier(vmSid);
                var descriptor = new RawSecurityDescriptor(bytes, 0);
                if (descriptor.Owner == null || !HostOwner(descriptor.Owner.Value) ||
                    descriptor.DiscretionaryAcl == null ||
                    (descriptor.ControlFlags & ControlFlags.DiscretionaryAclPresent) == 0 ||
                    (descriptor.ControlFlags & ControlFlags.DiscretionaryAclProtected) == 0) return false;
                bool vmRead = false, vmWrite = false;
                foreach (GenericAce entry in descriptor.DiscretionaryAcl)
                {
                    CommonAce ace = entry as CommonAce;
                    if (ace == null || ace.IsCallback || ace.SecurityIdentifier == null) return false;
                    if ((ace.AceFlags & AceFlags.InheritOnly) != 0) continue;
                    if (ace.AceQualifier != AceQualifier.AccessAllowed) return false;
                    uint access = unchecked((uint)ace.AccessMask);
                    if (access == 0 || HostOwner(ace.SecurityIdentifier.Value)) continue;
                    if (!ace.SecurityIdentifier.Equals(expected)) return false;
                    // Hyper-V owns the writable disk principal. Attached images
                    // must give that same VM only read/execute/query access.
                    if (!writableDisk && (access & ~0xA01200A9U) != 0) return false;
                    vmRead |= (access & 0x90000001U) != 0;
                    vmWrite |= (access & 0x50000002U) != 0;
                }
                return vmRead && (!writableDisk || vmWrite);
            }
            catch (ArgumentException) { return false; }
        }
    }
}
