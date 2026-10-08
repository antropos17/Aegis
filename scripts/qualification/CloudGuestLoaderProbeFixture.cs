using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;

// Pure native receipt models only. Real secondary logon remains a hosted guest observation.
internal static class CloudGuestLoaderProbeFixture
{
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool ConvertStringSecurityDescriptorToSecurityDescriptorW(string value, uint revision, out IntPtr descriptor, out uint bytes);
    [DllImport("advapi32.dll")] private static extern uint GetSecurityDescriptorLength(IntPtr descriptor);
    [DllImport("kernel32.dll")] private static extern IntPtr LocalFree(IntPtr descriptor);
    private static bool NativeMask(bool station, bool documented, int expected)
    {
        IntPtr pointer = IntPtr.Zero; uint size;
        try {
            if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(CloudGuestDesktop.Descriptor(Sid, station, documented), 1, out pointer, out size)) return false;
            uint length = GetSecurityDescriptorLength(pointer); if (length < 20 || length > 4096) return false;
            var bytes = new byte[length]; Marshal.Copy(pointer, bytes, 0, bytes.Length);
            var descriptor = new RawSecurityDescriptor(bytes, 0); int matches = 0;
            if ((descriptor.ControlFlags & ControlFlags.DiscretionaryAclProtected) == 0 || descriptor.DiscretionaryAcl == null || descriptor.DiscretionaryAcl.Count != 3) return false;
            foreach (GenericAce entry in descriptor.DiscretionaryAcl) { var ace = entry as CommonAce; if (ace == null) return false; if (ace.SecurityIdentifier.Value == Sid) { if (ace.AceQualifier != AceQualifier.AccessAllowed || ace.AccessMask != expected || ace.AceFlags != AceFlags.None) return false; matches++; } }
            return matches == 1;
        } finally { if (pointer != IntPtr.Zero) LocalFree(pointer); }
    }
    private const string Sid = "S-1-5-21-1-2-3-1001";
    private static Dictionary<string, object> Model(bool documented)
    {
        var value = new Dictionary<string, object>();
        foreach (string key in new string[] { "heldIdentityBeforeRelease", "processCreated", "jobAssignedBeforeAdmission", "tokenOpened", "privateDesktopCreated", "privateDesktopParentRestored", "privateDesktopParentThreadPreserved", "jobClosureConfirmed", "cleanupRootExitObserved", "privateDesktopHandlesClosedAfterJobClosure", "loaderProbeResumed", "exitCodeObserved", "naturalExitObservedBeforeJobTermination" }) value[key] = true;
        foreach (string key in new string[] { "elevated", "administratorEnabled", "administratorGroupPresent", "taskReleased", "runtimeResumed", "acceptancePassed", "launchAllowed" }) value[key] = false;
        value["loaderProbe"] = documented ? "documented" : "minimal-private-user"; value["sid"] = Sid;
        value["tokenRequestedAccess"] = 8; value["pid"] = (uint)42; value["birthFileTime"] = (long)43; value["initialJobMembers"] = 1;
        value["desktopAclProfile"] = documented ? "documented-noninteractive-user" : "minimal-task";
        value["privateStationTaskRequestedAccessMask"] = documented ? 0xf006eu : 0x22u;
        value["privateDesktopTaskRequestedAccessMask"] = documented ? 0xf00cfu : 0x83u;
        value["creationFlags"] = 0x08000404u; value["ownerProcessSessionId"] = 0; value["heldTokenSessionId"] = 0;
        value["failureStage"] = null; value["exitCode"] = (uint)0; return value;
    }
    private static void Need(bool value) { if (!value) throw new InvalidOperationException("loader-model-refused"); }
    private static int Main()
    {
        int count = 0;
        try {
            var prior = Model(false); prior["exitCode"] = 0xC0000142u;
            Need(CloudGuestLoaderProbe.Settled(prior, Sid, false)); count++;
            Need(CloudGuestLoaderProbe.Positive(Model(true), Sid)); count++;
            foreach (string key in new string[] { "jobClosureConfirmed", "cleanupRootExitObserved", "privateDesktopHandlesClosedAfterJobClosure", "heldIdentityBeforeRelease", "privateDesktopParentRestored", "loaderProbeResumed" }) {
                var value = Model(false); value[key] = false; Need(!CloudGuestLoaderProbe.Settled(value, Sid, false)); count++;
            }
            foreach (string key in new string[] { "exitCodeObserved", "naturalExitObservedBeforeJobTermination", "loaderProbeResumed" }) {
                var value = Model(true); value[key] = false; Need(!CloudGuestLoaderProbe.Positive(value, Sid)); count++;
            }
            foreach (string key in new string[] { "administratorGroupPresent", "elevated", "taskReleased", "runtimeResumed" }) {
                var value = Model(true); value[key] = true; Need(!CloudGuestLoaderProbe.Positive(value, Sid)); count++;
            }
            var exit = Model(true); exit["exitCode"] = (uint)137; Need(!CloudGuestLoaderProbe.Positive(exit, Sid)); count++;
            var session = Model(true); session["heldTokenSessionId"] = 1; Need(!CloudGuestLoaderProbe.Positive(session, Sid)); count++;
            var flags = Model(true); flags["creationFlags"] = 0x40Cu; Need(!CloudGuestLoaderProbe.Positive(flags, Sid)); count++;
            Need(!CloudGuestLoaderProbe.Positive(Model(true), "S-1-5-21-1-2-3-1002")); count++;
            var missing = Model(true); missing.Remove("failureStage"); Need(!CloudGuestLoaderProbe.Positive(missing, Sid)); count++;
            var profile = Model(true); profile["desktopAclProfile"] = "minimal-task"; Need(!CloudGuestLoaderProbe.Positive(profile, Sid)); count++;
            var originalProfile = Model(false); originalProfile["desktopAclProfile"] = "documented-noninteractive-user"; Need(!CloudGuestLoaderProbe.Settled(originalProfile, Sid, false)); count++;
            foreach (string key in new string[] { "privateStationTaskRequestedAccessMask", "privateDesktopTaskRequestedAccessMask" }) { var mask = Model(true); mask[key] = 0; Need(!CloudGuestLoaderProbe.Positive(mask, Sid)); count++; }
            var thread = Model(true); thread["privateDesktopParentThreadPreserved"] = false; Need(!CloudGuestLoaderProbe.Positive(thread, Sid)); count++;
            Need(NativeMask(true, false, 0x22)); count++; Need(NativeMask(false, false, 0x83)); count++;
            Need(NativeMask(true, true, 0xf006e)); count++; Need(NativeMask(false, true, 0xf00cf)); count++;
            Console.WriteLine("loader-pure-controls:" + count); return count == 29 ? 0 : 1;
        } catch { Console.WriteLine("loader-pure-controls:refused"); return 1; }
    }
}