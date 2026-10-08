using System;
using System.Collections.Generic;
using System.Diagnostics;

// Fixed lab-only secondary-logon discriminator. No new object rights or project code.
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
    internal static bool Settled(Dictionary<string, object> value, string expectedSid, bool detached)
    {
        object sid, kind, owner, child;
        if (value == null || !value.TryGetValue("sid", out sid) || !(sid is string) || (string)sid != expectedSid ||
            !value.TryGetValue("loaderProbe", out kind) || !(kind is string) || (string)kind != (detached ? "detached" : "original-no-window")) return false;
        foreach (string field in new string[] { "loaderProbeResumed", "heldIdentityBeforeRelease", "processCreated", "jobAssignedBeforeAdmission", "tokenOpened", "privateDesktopCreated", "privateDesktopParentRestored", "jobClosureConfirmed", "cleanupRootExitObserved", "privateDesktopHandlesClosedAfterJobClosure" })
            if (!Bool(value, field, true)) return false;
        foreach (string field in new string[] { "elevated", "administratorEnabled", "administratorGroupPresent", "taskReleased", "runtimeResumed", "acceptancePassed", "launchAllowed" })
            if (!Bool(value, field, false)) return false;
        if (!Number(value, "tokenRequestedAccess", 8, 8) || !Number(value, "pid", 1, uint.MaxValue) ||
            !Number(value, "birthFileTime", 1, long.MaxValue) || !Number(value, "initialJobMembers", 1, 64) ||
            !Number(value, "creationFlags", detached ? 0x40C : 0x08000404, detached ? 0x40C : 0x08000404) ||
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
    public static Dictionary<string, object> CompareOriginalThenDetached(string password, string expectedSid)
    { return Run(password, expectedSid, true); }
    // A separate Claude owner repeats only its own positive, after the host's first-phase closure gate.
    public static Dictionary<string, object> QualifyDetachedForNewOwner(string password, string expectedSid)
    { return Run(password, expectedSid, false); }
    private static Dictionary<string, object> Run(string password, string expectedSid, bool original)
    {
        CloudGuestProcess.ClearLoaderQualification();
        var result = new Dictionary<string, object>(); var watch = Stopwatch.StartNew();
        result["original"] = null; result["detached"] = null; result["passed"] = false;
        result["originalProbeRequested"] = original; result["originalProbeClosedBeforeDetached"] = false;
        result["detachedClosedBeforeRuntime"] = false; result["failure"] = null;
        result["acceptancePassed"] = false; result["launchAllowed"] = false;
        string stage = "original-probe";
        try {
            if (original) {
                var prior = CloudGuestProcess.RunLoaderProbe(password, expectedSid, false); result["original"] = prior;
                if (!Settled(prior, expectedSid, false)) throw new InvalidOperationException("loader-probe-refused");
                result["originalProbeClosedBeforeDetached"] = true;
            }
            stage = "detached-probe";
            var candidate = CloudGuestProcess.RunLoaderProbe(password, expectedSid, true); result["detached"] = candidate;
            if (!Positive(candidate, expectedSid)) throw new InvalidOperationException("loader-probe-refused");
            result["detachedClosedBeforeRuntime"] = true;
            CloudGuestProcess.QualifyDetachedLoader(expectedSid); result["passed"] = true;
        } catch (Exception error) {
            CloudGuestProcess.ClearLoaderQualification(); result["failure"] = stage; result["failureHResult"] = error.HResult;
        }
        watch.Stop(); result["elapsedMilliseconds"] = watch.ElapsedMilliseconds;
        return result;
    }
}