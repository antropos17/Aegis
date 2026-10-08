using System;
using System.Collections.Generic;

// Pure native receipt models only. Real secondary logon remains a hosted guest observation.
internal static class CloudGuestLoaderProbeFixture
{
    private const string Sid = "S-1-5-21-1-2-3-1001";
    private static Dictionary<string, object> Model(bool detached)
    {
        var value = new Dictionary<string, object>();
        foreach (string key in new string[] { "heldIdentityBeforeRelease", "processCreated", "jobAssignedBeforeAdmission", "tokenOpened", "privateDesktopCreated", "privateDesktopParentRestored", "jobClosureConfirmed", "cleanupRootExitObserved", "privateDesktopHandlesClosedAfterJobClosure", "loaderProbeResumed", "exitCodeObserved", "naturalExitObservedBeforeJobTermination" }) value[key] = true;
        foreach (string key in new string[] { "elevated", "administratorEnabled", "administratorGroupPresent", "taskReleased", "runtimeResumed", "acceptancePassed", "launchAllowed" }) value[key] = false;
        value["loaderProbe"] = detached ? "detached" : "original-no-window"; value["sid"] = Sid;
        value["tokenRequestedAccess"] = 8; value["pid"] = (uint)42; value["birthFileTime"] = (long)43; value["initialJobMembers"] = 1;
        value["creationFlags"] = detached ? 0x40Cu : 0x08000404u; value["ownerProcessSessionId"] = 0; value["heldTokenSessionId"] = 0;
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
            var flags = Model(true); flags["creationFlags"] = 0x08000404u; Need(!CloudGuestLoaderProbe.Positive(flags, Sid)); count++;
            Need(!CloudGuestLoaderProbe.Positive(Model(true), "S-1-5-21-1-2-3-1002")); count++;
            var missing = Model(true); missing.Remove("failureStage"); Need(!CloudGuestLoaderProbe.Positive(missing, Sid)); count++;
            Console.WriteLine("loader-pure-controls:" + count); return count == 20 ? 0 : 1;
        } catch { Console.WriteLine("loader-pure-controls:refused"); return 1; }
    }
}