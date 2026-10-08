using System;
using System.Collections.Generic;
using System.Diagnostics;

// Fixed lab-only secondary-logon profile discriminator. No project code or inherited-object ACL edits.
public static class CloudGuestLoaderProbe
{
    private static bool Bool(Dictionary<string, object> value, string key, bool expected)
    { object actual; return value != null && value.TryGetValue(key, out actual) && actual is bool && (bool)actual == expected; }
    private static bool Number(Dictionary<string, object> value, string key, long minimum, long maximum)
    {
        object actual;
        if (value == null || !value.TryGetValue(key, out actual) || !(actual is int || actual is uint || actual is long)) return false;
        long number = Convert.ToInt64(actual); return number >= minimum && number <= maximum;
    }
    internal static bool Settled(Dictionary<string, object> value, string expectedSid, bool documented)
    {
        object sid, kind, owner, child, profile;
        if (value == null || !value.TryGetValue("sid", out sid) || !(sid is string) || (string)sid != expectedSid ||
            !value.TryGetValue("loaderProbe", out kind) || !(kind is string) || (string)kind != (documented ? "documented" : "minimal-private-user") ||
            !value.TryGetValue("desktopAclProfile", out profile) || !(profile is string) ||
            (string)profile != (documented ? "documented-noninteractive-user" : "minimal-task")) return false;
        foreach (string field in new string[] { "loaderProbeResumed", "heldIdentityBeforeRelease", "processCreated", "jobAssignedBeforeAdmission", "tokenOpened", "privateDesktopCreated", "privateDesktopParentRestored", "privateDesktopParentThreadPreserved", "jobClosureConfirmed", "cleanupRootExitObserved", "privateDesktopHandlesClosedAfterJobClosure" })
            if (!Bool(value, field, true)) return false;
        foreach (string field in new string[] { "elevated", "administratorEnabled", "administratorGroupPresent", "taskReleased", "runtimeResumed", "acceptancePassed", "launchAllowed" })
            if (!Bool(value, field, false)) return false;
        if (!Number(value, "tokenRequestedAccess", 8, 8) || !Number(value, "pid", 1, uint.MaxValue) ||
            !Number(value, "birthFileTime", 1, long.MaxValue) || !Number(value, "initialJobMembers", 1, 64) ||
            !Number(value, "creationFlags", 0x08000404, 0x08000404) ||
            !Number(value, "privateStationTaskRequestedAccessMask", documented ? 0xf006e : 0x22, documented ? 0xf006e : 0x22) ||
            !Number(value, "privateDesktopTaskRequestedAccessMask", documented ? 0xf00cf : 0x83, documented ? 0xf00cf : 0x83) ||
            !Number(value, "ownerProcessSessionId", 0, int.MaxValue) || !Number(value, "heldTokenSessionId", 0, int.MaxValue)) return false;
        value.TryGetValue("ownerProcessSessionId", out owner); value.TryGetValue("heldTokenSessionId", out child);
        return Convert.ToInt64(owner) == Convert.ToInt64(child);
    }
    internal static bool Positive(Dictionary<string, object> value, string expectedSid)
    {
        object stage;
        return Settled(value, expectedSid, true) && Bool(value, "loaderProbeResumed", true) &&
            Bool(value, "exitCodeObserved", true) && Bool(value, "naturalExitObservedBeforeJobTermination", true) &&
            Number(value, "exitCode", 0, 0) && value.TryGetValue("failureStage", out stage) && stage == null;
    }
    public static Dictionary<string, object> CompareOriginalThenDocumented(string password, string expectedSid)
    { return Run(password, expectedSid, true); }
    // A separate Claude owner repeats only its own positive, after the host's first-phase closure gate.
    public static Dictionary<string, object> QualifyDocumentedForNewOwner(string password, string expectedSid)
    { return Run(password, expectedSid, false); }
    private static Dictionary<string, object> Run(string password, string expectedSid, bool original)
    {
        CloudGuestProcess.ClearLoaderQualification();
        var result = new Dictionary<string, object>(); var watch = Stopwatch.StartNew();
        result["original"] = null; result["documented"] = null; result["passed"] = false;
        result["originalProbeRequested"] = original; result["originalProbeClosedBeforeDocumented"] = false;
        result["documentedClosedBeforeRuntime"] = false; result["failure"] = null;
        result["acceptancePassed"] = false; result["launchAllowed"] = false;
        string stage = "original-probe";
        try {
            if (original) {
                var prior = CloudGuestProcess.RunLoaderProbe(password, expectedSid, false); result["original"] = prior;
                if (!Settled(prior, expectedSid, false)) throw new InvalidOperationException("loader-probe-refused");
                result["originalProbeClosedBeforeDocumented"] = true;
            }
            stage = "documented-probe";
            var candidate = CloudGuestProcess.RunLoaderProbe(password, expectedSid, true); result["documented"] = candidate;
            if (!Positive(candidate, expectedSid)) throw new InvalidOperationException("loader-probe-refused");
            result["documentedClosedBeforeRuntime"] = true;
            CloudGuestProcess.QualifyDocumentedLoader(expectedSid); result["passed"] = true;
        } catch (Exception error) {
            CloudGuestProcess.ClearLoaderQualification(); result["failure"] = stage; result["failureHResult"] = error.HResult;
        }
        watch.Stop(); result["elapsedMilliseconds"] = watch.ElapsedMilliseconds;
        return result;
    }
}