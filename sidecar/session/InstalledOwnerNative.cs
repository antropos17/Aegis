using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace Aegis.ProtectedSession
{
    internal sealed partial class CallerIdentity
    {
        internal bool InstalledSystem()
        { return Type == 1 && sid == "S-1-5-18" && integrity == "S-1-16-16384" && session == 0 && appContainer == 0 && uiAccess == 0 && restricting.Length == 0; }
        internal bool InstalledOperator(string approvedSid)
        {
            if (!PermittedBroker() || sid != approvedSid || integrity != "S-1-16-8192" || session != 0 ||
                elevation != 0 || restrictions != 0) return false;
            foreach (string entry in groups)
            {
                string group = entry.Substring(0, entry.LastIndexOf(':'));
                // Deny-only admin membership also identifies an admin-capable profile.
                if (group == "S-1-5-32-544" || group == "S-1-5-32-547" || group == "S-1-5-32-548" ||
                    group == "S-1-5-32-549" || group == "S-1-5-32-550" || group == "S-1-5-32-551" ||
                    group == "S-1-5-32-552" || group.EndsWith("-512", StringComparison.Ordinal) ||
                    group.EndsWith("-518", StringComparison.Ordinal) || group.EndsWith("-519", StringComparison.Ordinal)) return false;
            }
            foreach (string entry in privileges)
                if (!InstalledOwnerNative.OrdinaryPrivilege(entry)) return false;
            return true;
        }
    }

    internal static class InstalledOwnerNative
    {
        [StructLayout(LayoutKind.Sequential)] private struct Luid { internal uint Low; internal int High; }
        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool LookupPrivilegeValue(string system, string name, out Luid luid);
        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool LogonUser(string user, string domain, IntPtr password, int kind, int provider, out SafeFileHandle token);
        [DllImport("advapi32.dll", SetLastError = true)] private static extern bool OpenProcessToken(SafeFileHandle process, uint rights, out SafeFileHandle token);
        [DllImport("advapi32.dll", SetLastError = true)] private static extern bool DuplicateTokenEx(SafeFileHandle token, uint rights, IntPtr attributes, int level, int type, out SafeFileHandle copy);
        [DllImport("advapi32.dll", SetLastError = true)] private static extern uint SetSecurityInfo(SafeFileHandle handle, int kind, uint information,
            IntPtr owner, IntPtr group, IntPtr dacl, IntPtr sacl);
        [DllImport("advapi32.dll", SetLastError = true)] private static extern bool GetSecurityDescriptorDacl(IntPtr descriptor, out bool present, out IntPtr dacl, out bool defaulted);
        internal static SafeFileHandle SupervisorToken(string operatorSid)
        {
            using (SafeFileHandle self = CallerNative.DuplicateSelf())
            {
                SafeFileHandle original = null, copy = null;
                IntPtr descriptor = IntPtr.Zero;
                try
                {
                    CallerNative.Require(OpenProcessToken(self, 0xA, out original)); // query + duplicate, original ACL unchanged
                    CallerNative.Require(CallerIdentity.Observe(original).InstalledSystem());
                    CallerNative.Require(DuplicateTokenEx(original, 0xF01FF, IntPtr.Zero, 2, 1, out copy));
                    uint bytes;
                    CallerNative.Require(CallerEndpointNative.ConvertStringSecurityDescriptorToSecurityDescriptor(
                        "D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;0x8;;;" + operatorSid + ")", 1, out descriptor, out bytes));
                    bool present, defaulted; IntPtr dacl;
                    CallerNative.Require(GetSecurityDescriptorDacl(descriptor, out present, out dacl, out defaulted) && present && dacl != IntPtr.Zero && !defaulted);
                    CallerNative.Require(SetSecurityInfo(copy, 6, 4 | 0x80000000, IntPtr.Zero, IntPtr.Zero, dacl, IntPtr.Zero) == 0);
                    CallerEndpointNative.RequireNonInherited(copy); CallerNative.Require(CallerIdentity.Observe(copy).InstalledSystem());
                    SafeFileHandle result = copy; copy = null; return result;
                }
                finally { if (descriptor != IntPtr.Zero) CallerEndpointNative.LocalFree(descriptor); if (copy != null) copy.Dispose(); if (original != null) original.Dispose(); }
            }
        }
        internal static string ChangeNotifyLuid()
        { Luid luid; CallerNative.Require(LookupPrivilegeValue(null, "SeChangeNotifyPrivilege", out luid)); return unchecked((uint)luid.High).ToString("x8") + luid.Low.ToString("x8"); }
        internal static bool OrdinaryPrivilege(string entry)
        {
            // Assigned-but-disabled powerful privileges can later be enabled; reject them too.
            string[] ordinary = { "SeChangeNotifyPrivilege", "SeShutdownPrivilege", "SeUndockPrivilege", "SeIncreaseWorkingSetPrivilege", "SeTimeZonePrivilege" };
            foreach (string name in ordinary)
            {
                Luid luid; CallerNative.Require(LookupPrivilegeValue(null, name, out luid));
                if (entry.Substring(0, 16) != unchecked((uint)luid.High).ToString("x8") + luid.Low.ToString("x8")) continue;
                return (Convert.ToUInt32(entry.Substring(17), 16) & 2) == 0 || name == "SeChangeNotifyPrivilege";
            }
            return false;
        }
        internal static SafeFileHandle OperatorToken(InstalledOwnerPolicy policy)
        {
            policy.CheckCurrent(); string path = Path.Combine(InstalledOwnerPolicy.Root, "operator.credential");
            using (EnrollmentHeld held = new EnrollmentNative().Open(path, false))
            {
                EnrollmentInspection.Check(held, path, false, false);
                // LocalMachine DPAPI is not per-user authorization: only SY/BA may obtain the blob.
                var descriptor = new RawSecurityDescriptor(File.GetAccessControl(path).GetSecurityDescriptorBinaryForm(), 0);
                CallerNative.Require(descriptor.Owner != null && Trusted(descriptor.Owner.Value) && descriptor.DiscretionaryAcl != null);
                foreach (GenericAce entry in descriptor.DiscretionaryAcl)
                {
                    CommonAce ace = entry as CommonAce;
                    CallerNative.Require(ace != null && !ace.IsCallback && ace.SecurityIdentifier != null);
                    if (ace.AceQualifier == AceQualifier.AccessAllowed && (ace.AceFlags & AceFlags.InheritOnly) == 0)
                        CallerNative.Require(Trusted(ace.SecurityIdentifier.Value));
                    else CallerNative.Require(ace.AceQualifier == AceQualifier.AccessDenied || (ace.AceFlags & AceFlags.InheritOnly) != 0);
                }
                byte[] blob = held.Read(4096), clear = null, terminated = null;
                SafeFileHandle token = null; GCHandle pinned = new GCHandle();
                try
                {
                    clear = ProtectedData.Unprotect(blob, Encoding.ASCII.GetBytes("AEGIS-installed-owner-credential-v1"), DataProtectionScope.LocalMachine);
                    CallerNative.Require(clear.Length >= 2 && clear.Length <= 256 && clear.Length % 2 == 0);
                    for (int index = 0; index < clear.Length; index += 2) CallerNative.Require(clear[index] != 0 || clear[index + 1] != 0);
                    terminated = new byte[clear.Length + 2]; Buffer.BlockCopy(clear, 0, terminated, 0, clear.Length);
                    pinned = GCHandle.Alloc(terminated, GCHandleType.Pinned);
                    CallerNative.Require(LogonUser(policy.OperatorAccount, ".", pinned.AddrOfPinnedObject(), 2, 0, out token));
                    CallerEndpointNative.RequireNonInherited(token);
                    CallerNative.Require(CallerIdentity.Observe(token).InstalledOperator(policy.OperatorSid));
                    held.Recheck(false); policy.CheckCurrent(); SafeFileHandle result = token; token = null; return result;
                }
                finally
                {
                    if (token != null) token.Dispose();
                    if (pinned.IsAllocated) pinned.Free();
                    Array.Clear(blob, 0, blob.Length); if (clear != null) Array.Clear(clear, 0, clear.Length);
                    if (terminated != null) Array.Clear(terminated, 0, terminated.Length);
                }
            }
        }
        internal static bool Trusted(string sid) { return sid == "S-1-5-18" || sid == "S-1-5-32-544"; }
    }
}
