using System;
using System.IO;
using Aegis.ProtectedSession;

internal static class FixedOperationScenarios
{
    private static bool Refused(Action action)
    {
        try { action(); return false; }
        catch (InvalidDataException) { return true; }
        catch (InvalidOperationException) { return true; }
    }
    internal static void Run(string mode, string root, CallerMainOperation.Context context, InstalledOwnerRegistration installed,
        string control, CompletionObservation observed, FixedOperationMutation mutation)
    {
        var deadline = new InstalledOwnerDeadline(6000);
        observed.ByteSharingAndMetadataModeled = mutation != null;
        if (mode == "fixed-prepare" || mode == "fixed-release" || mode == "fixed-changed-replay")
        {
            var permit = context.IssueInspectionAuthorizationForTest(installed, deadline);
            observed.AuthorizationIssued = true;
            if (mode == "fixed-changed-replay")
            {
                // Consume the real permit once, then change the operation in a
                // second dispatch on the original caller and issued permit.
                var completion = context.DispatchInstalledInspectionForTest(permit, "inspect-owned", installed, deadline);
                completion.CheckCurrent(); observed.Completed = true;
            }
            observed.PolicyGuardAttempted = mode != "fixed-changed-replay";
            observed.Refused = Refused(delegate
            {
                var unexpected = context.DispatchInstalledInspectionForTest(permit, mode == "fixed-release" ? "release-owned" : "prepare-owned", installed, deadline);
                Publish(unexpected, control, observed);
            });
            observed.RetryRefused = Refused(delegate { Publish(context.InspectInstalledOwned(installed, new InstalledOwnerDeadline(6000)), control, observed); });
            return;
        }
        var retained = context.InspectInstalledOwned(installed, deadline);
        observed.Completed = true;
        string selected = Path.Combine(root, mode.StartsWith("fixed-operation-", StringComparison.Ordinal) ? "registered-operation.json" : "fixed-fixture.json");
        string originalHash = CompositionFiles.Hash(selected);
        FileAttributes originalAttributes = File.GetAttributes(selected);
        try
        {
            if (mutation != null)
            { mutation.Change(); observed.MutationApplied = originalHash != CompositionFiles.Hash(selected); }
            else
            {
                File.SetAttributes(selected, originalAttributes ^ FileAttributes.Hidden);
                observed.MutationApplied = File.GetAttributes(selected) != originalAttributes;
            }
            CallerNative.Require(observed.MutationApplied);
            observed.Refused = Refused(delegate { retained.CheckCurrent(); });
        }
        finally
        {
            if (mutation != null) mutation.Restore();
            else File.SetAttributes(selected, originalAttributes);
        }
        CallerNative.Require(originalHash == CompositionFiles.Hash(selected) && File.GetAttributes(selected) == originalAttributes);
        observed.RetryRefused = Refused(delegate { retained.CheckCurrent(); });
        CallerNative.Require(Refused(delegate { context.InspectInstalledOwned(installed, new InstalledOwnerDeadline(6000)); }));
    }
    private static void Publish(CallerMainOperation.InspectionCompletion completion, string control, CompletionObservation observed)
    {
        completion.CheckCurrent(); observed.Effects++;
        File.WriteAllText(Path.Combine(control, "inspection.json"), completion.Result);
        File.WriteAllText(Path.Combine(control, "effect-counter.txt"), observed.Effects.ToString());
    }
}
