namespace Aegis.EtwLifecycle;

internal static class ConsentTests
{
    private static readonly TraceStats Absent = new(4201, null, null, null, null, null);

    private static ConsentScenarioResult Evidence(string scenario)
    {
        bool late = scenario == "late";
        var result = new ConsentResult(true, scenario, late ? "late-consent" : "uac-denied",
            true, late, true, late, late, late ? 2 : null, late ? null : 1223, false, false, late ? 5000 : 3000, null);
        return new(true, scenario, false, true, true, 0, true, 0, result, Absent, Absent, null);
    }

    internal static Task NativeEvidence()
    {
        foreach (string scenario in new[] { "refusal", "late" })
        {
            var valid = Evidence(scenario);
            Check(ConsentScenarios.Accepts(valid));
            foreach (var evidence in new[] {
                valid with { WitnessAuthenticated = false }, valid with { RestrictedAcl = false },
                valid with { WitnessExitCode = null }, valid with { WitnessExitCode = 2 },
                valid with { BrokerExited = false }, valid with { BrokerExitCode = null },
                valid with { BrokerExitCode = 2 }, valid with { Before = null }, valid with { After = null },
                valid with { Before = Absent with { QueryStatus = 5 } },
                valid with { After = Absent with { QueryStatus = 0 } },
                valid with { After = Absent with { EventsLost = 0 } },
                valid with { Result = null }, valid with { Error = "timeout" }, valid with { Live = false }
            }) Check(!ConsentScenarios.Accepts(evidence));
            foreach (var result in new[] {
                valid.Result! with { Live = false }, valid.Result! with { Scenario = "unknown" },
                valid.Result! with { RestrictedAcl = false }, valid.Result! with { LaunchReturned = false },
                valid.Result! with { AuthorizationSent = true }, valid.Result! with { Error = "timeout" },
                valid.Result! with { Outcome = "early-consent" }
            }) Check(!ConsentScenarios.Accepts(valid with { Result = result }));
        }
        return Task.CompletedTask;
    }

    internal static Task LaunchOutcomes()
    {
        var refusal = Evidence("refusal");
        foreach (var result in new[] {
            refusal.Result! with { InjectedDenial = true }, refusal.Result! with { NativeError = 5 },
            refusal.Result! with { ChildLaunched = true }, refusal.Result! with { ChildExitCode = 2 },
            refusal.Result! with { ChildIdentityVerified = true }
        }) Check(!ConsentScenarios.Accepts(refusal with { Result = result }));
        var simulated = refusal with
        {
            Live = false,
            Before = null,
            After = null,
            Result = refusal.Result! with { Live = false, InjectedDenial = true }
        };
        Check(ConsentScenarios.Accepts(simulated));
        Check(!ConsentScenarios.Accepts(simulated with { Result = simulated.Result! with { InjectedDenial = false } }));
        var late = Evidence("late");
        foreach (var result in new[] {
            late.Result! with { ExpiredBeforeReturn = false }, late.Result! with { LaunchElapsedMilliseconds = 4999 },
            late.Result! with { ChildIdentityVerified = false }, late.Result! with { ChildLaunched = false },
            late.Result! with { ChildExitCode = null }, late.Result! with { ChildExitCode = 0 },
            late.Result! with { NativeError = 1223 }, late.Result! with { InjectedDenial = true }
        }) Check(!ConsentScenarios.Accepts(late with { Result = result }));
        return Task.CompletedTask;
    }

    internal static async Task Cancelled()
    {
        using var abort = new CancellationTokenSource(); abort.Cancel();
        foreach (bool live in new[] { false, true })
        {
            var result = await ConsentScenarios.Run(live, "late", abort.Token);
            Check(!result.Passed && !result.WitnessAuthenticated && !result.BrokerExited &&
                result.Result == null && result.Before == null && result.After == null && result.Error == "cancelled");
        }
    }

    private static void Check(bool value) { if (!value) throw new InvalidOperationException("consent-assertion-failed"); }
}
