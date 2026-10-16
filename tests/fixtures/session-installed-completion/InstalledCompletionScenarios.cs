using System;
using System.IO;
using System.Threading;
using Aegis.ProtectedSession;

internal sealed class CompletionObservation
{
    internal bool Admitted, Refused, RetryRefused, Completed, Retained, MainJobEmpty, BorrowedUsable, RecordsUnchanged;
    internal int Effects;
    internal bool AuthorizationIssued, PolicyGuardAttempted, MutationApplied, ByteSharingAndMetadataModeled;
    internal string PreAdmissionRefusal = "";
    internal long DeadlineRetryAge = -1;
    private static string B(bool value) { return value.ToString().ToLowerInvariant(); }
    internal string Json()
    {
        return "{\"admitted\":" + B(Admitted) + ",\"refused\":" + B(Refused) + ",\"retryRefused\":" + B(RetryRefused) +
            ",\"completed\":" + B(Completed) + ",\"retained\":" + B(Retained) + ",\"effects\":" + Effects +
            ",\"mainJobEmpty\":" + B(MainJobEmpty) + ",\"borrowedUsable\":" + B(BorrowedUsable) +
            ",\"recordsUnchanged\":" + B(RecordsUnchanged) + ",\"deadlineRetryAgeMilliseconds\":" + DeadlineRetryAge +
            ",\"authorizationIssued\":" + B(AuthorizationIssued) + ",\"policyGuardAttempted\":" + B(PolicyGuardAttempted) + ",\"mutationApplied\":" + B(MutationApplied) +
            ",\"preAdmissionRefusal\":\"" + PreAdmissionRefusal.Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", "\\r").Replace("\n", "\\n") + "\"" +
            ",\"byteSharingAndMetadataModeled\":" + B(ByteSharingAndMetadataModeled) +
            ",\"protectedDescriptorsModeled\":true,\"installedAuthorityModeled\":true}";
    }
}

internal static class InstalledCompletionScenarios
{
    private static bool Refused(Action action)
    {
        try { action(); return false; }
        catch (InvalidDataException) { return true; }
        catch (InvalidOperationException) { return true; }
    }
    internal static void Run(string mode, CallerMainOperation.Context context, InstalledOwnerRegistration installed, InstalledOwnerRegistration alternate,
        CallerMainOperation operation, string control, CompletionObservation observed, Action<bool> authority, Action stopMain, Func<long> admissionAge)
    {
        var deadline = new InstalledOwnerDeadline(6000);
        if (mode.StartsWith("policy-", StringComparison.Ordinal))
        {
            observed.Refused = Refused(delegate { context.InspectInstalledOwned(installed, deadline); });
            observed.RetryRefused = Refused(delegate { context.InspectOwned(); });
            return;
        }
        if (mode == "initial-deadline")
        {
            var expired = new InstalledOwnerDeadline(1); Thread.Sleep(20);
            observed.Refused = Refused(delegate { context.InspectInstalledOwned(installed, expired); });
            observed.RetryRefused = Refused(delegate { Publish(context.InspectInstalledOwned(installed, deadline), control, observed); });
            return;
        }
        if (mode == "ordinary-first")
        {
            observed.Refused = Refused(delegate { context.InspectOwned(); });
            observed.RetryRefused = Refused(delegate { context.InspectInstalledOwned(installed, deadline); });
            return;
        }
        var completion = context.InspectInstalledOwned(installed, mode == "completion-deadline" ? new InstalledOwnerDeadline(500) : deadline);
        observed.Completed = true;
        if (mode == "positive") { Publish(completion, control, observed); return; }
        if (mode == "retained")
        { Thread.Sleep(2150); completion.CheckCurrent(); observed.Retained = true; Publish(completion, control, observed); return; }
        if (mode == "duplicate-issue")
            observed.Refused = Refused(delegate { context.InspectInstalledOwned(installed, deadline); });
        else if (mode == "duplicate-inspection")
            observed.Refused = Refused(delegate { context.InspectOwned(); });
        else if (mode == "foreign-owner")
        {
            observed.Refused = Refused(delegate { completion.CheckInstalledOwner(alternate); });
            alternate.CheckCurrent();
        }
        else
        {
            if (mode == "completion-deadline") Thread.Sleep(550);
            else if (mode == "peer-closed")
            {
                File.WriteAllText(Path.Combine(control, "close-pipe.txt"), "close");
                MainFixtureTransport.Until(() => File.Exists(Path.Combine(control, "client-pipe-closed.txt")));
            }
            else if (mode == "owner-loss") authority(false);
            else if (mode == "main-exit") stopMain();
            else if (mode == "owner-disposed") installed.Dispose();
            else if (mode == "operation-disposed") operation.Dispose();
            else throw new Exception("unknown-completion-scenario");
            observed.Refused = Refused(delegate { completion.CheckCurrent(); });
        }
        authority(true);
        // The original request is still younger than two seconds here. A
        // healthy context fence must fail because the deadline failure revoked
        // the operation, independently of the already-expired completion clock.
        if (mode == "completion-deadline")
        {
            observed.DeadlineRetryAge = admissionAge();
            CallerNative.Require(observed.DeadlineRetryAge < 1800);
        }
        observed.RetryRefused = mode == "completion-deadline" ? Refused(delegate { context.CheckCurrent(); }) :
            Refused(delegate { completion.CheckCurrent(); });
        CallerNative.Require(Refused(delegate { context.InspectInstalledOwned(installed, new InstalledOwnerDeadline(6000)); }));
    }
    private static void Publish(CallerMainOperation.InspectionCompletion completion, string control, CompletionObservation observed)
    {
        completion.CheckCurrent();
        File.WriteAllText(Path.Combine(control, "inspection.json"), completion.Result);
        observed.Effects++;
        File.WriteAllText(Path.Combine(control, "effect-counter.txt"), observed.Effects.ToString());
    }
}
